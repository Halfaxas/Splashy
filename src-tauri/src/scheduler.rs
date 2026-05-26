use crate::api::sync::{sync_collections, sync_users};
use crate::api::topics::sync_topics;
use crate::settings::load_settings;
use crate::wallpaper::{change_wallpaper, prefetch_next_wallpaper};
use chrono::Utc;
use cron::Schedule;
use rand::Rng;
use std::str::FromStr;
use std::sync::OnceLock;
use tauri::Emitter;
use tokio::sync::watch;
use tokio::time::sleep;

static CRON_TX: OnceLock<watch::Sender<String>> = OnceLock::new();
static REPREFETCH_TX: OnceLock<watch::Sender<u64>> = OnceLock::new();

/// Call this whenever the cron expression changes in settings.
/// The wallpaper scheduler will pick it up immediately and reschedule.
pub fn notify_cron_changed(new_cron: String) {
    if let Some(tx) = CRON_TX.get() {
        let _ = tx.send(new_cron);
    }
}

/// Call this when a getter source is disabled and the prefetched next wallpaper came from it.
/// Triggers an immediate re-prefetch so the next wallpaper is always from an active source.
pub fn notify_reprefetch() {
    if let Some(tx) = REPREFETCH_TX.get() {
        let next = tx.borrow().wrapping_add(1);
        let _ = tx.send(next);
    }
}

/// Parse a standard 5-field cron expression ("min hour dom month dow").
/// The `cron` crate expects 6 fields, so we prepend a "0" seconds field.
fn parse_cron(expr: &str) -> Result<Schedule, String> {
    let six_field = format!("0 {}", expr.trim());
    Schedule::from_str(&six_field)
        .map_err(|e| format!("Invalid cron expression \"{}\": {}", expr, e))
}

/// Run users, collections, and topics sync once at startup — no periodic scheduling.
pub fn run_startup_sync() {
    tauri::async_runtime::spawn(async {
        log::info!("[scheduler] Running startup sync");
        match sync_users().await {
            Ok(()) => log::info!("[scheduler] Users synced"),
            Err(e) => log::error!("[scheduler] Users sync failed: {}", e),
        }
        match sync_collections().await {
            Ok(()) => log::info!("[scheduler] Collections synced"),
            Err(e) => log::error!("[scheduler] Collections sync failed: {}", e),
        }
        match sync_topics().await {
            Ok(topics) => log::info!("[scheduler] Topics synced: {} topics", topics.len()),
            Err(e) => log::error!("[scheduler] Topics sync failed: {}", e),
        }
    });
}

/// Spawn the wallpaper scheduler.
/// Uses a watch channel so changing the cron expression in settings
/// immediately cancels the current sleep and reschedules.
pub fn start_wallpaper_scheduler(app_handle: tauri::AppHandle) {
    let initial_cron = load_settings()
        .map(|s| s.wallpaper_cron)
        .unwrap_or_else(|_| "0 * * * *".to_string());

    let (tx, mut rx) = watch::channel(initial_cron);
    CRON_TX.set(tx).ok();

    // Spawn a separate task that listens for re-prefetch requests (source disabled mid-cycle)
    let reprefetch_app = app_handle.clone();
    let (reprefetch_tx, mut reprefetch_rx) = watch::channel(0u64);
    REPREFETCH_TX.set(reprefetch_tx).ok();
    tauri::async_runtime::spawn(async move {
        loop {
            reprefetch_rx.changed().await.ok();
            log::info!("[scheduler] Re-prefetching next wallpaper (source disabled)");
            let app = reprefetch_app.clone();
            tauri::async_runtime::spawn(async move {
                match prefetch_next_wallpaper().await {
                    Ok(()) => {
                        log::info!("[scheduler] Re-prefetch complete");
                        let _ = app.emit("next-wallpaper-ready", ());
                    }
                    Err(e) => log::warn!("[scheduler] Re-prefetch failed: {}", e),
                }
            });
        }
    });

    tauri::async_runtime::spawn(async move {
        log::info!("[scheduler] Starting wallpaper scheduler");

        // Run once immediately on launch
        run_wallpaper_cycle(&app_handle).await;

        loop {
            let cron_expr = rx.borrow().clone();

            // Startup-only mode: wallpaper was already changed above; just wait for settings to change.
            if cron_expr == "@startup" || cron_expr.is_empty() {
                log::info!("[scheduler] Startup-only mode — no recurring schedule");
                rx.changed().await.ok();
                continue;
            }

            let schedule = match parse_cron(&cron_expr) {
                Ok(s) => s,
                Err(e) => {
                    log::error!("[scheduler] {e} — waiting for a valid expression");
                    rx.changed().await.ok();
                    continue;
                }
            };

            let next = match schedule.upcoming(Utc).next() {
                Some(t) => t,
                None => {
                    log::error!("[scheduler] Cron expression has no upcoming occurrences");
                    rx.changed().await.ok();
                    continue;
                }
            };

            let base_delay = (next - Utc::now())
                .to_std()
                .unwrap_or(std::time::Duration::ZERO);

            // Add ±120s jitter to spread API load across the user base.
            let jitter_secs: i64 = rand::rng().random_range(-120..=120);
            let jittered_secs = (base_delay.as_secs() as i64 + jitter_secs).max(0) as u64;
            let delay = std::time::Duration::from_secs(jittered_secs);

            log::info!(
                "[scheduler] Next wallpaper change in {:.0?} (cron: {}, jitter: {:+}s)",
                delay,
                cron_expr,
                jitter_secs
            );

            tokio::select! {
                _ = sleep(delay) => {
                    run_wallpaper_cycle(&app_handle).await;
                }
                _ = rx.changed() => {
                    log::info!("[scheduler] Cron expression changed, rescheduling");
                }
            }
        }
    });
}

async fn run_wallpaper_cycle(app_handle: &tauri::AppHandle) {
    log::info!("[scheduler] Running wallpaper change");
    match change_wallpaper().await {
        Ok(msg) => {
            log::info!("[scheduler] {}", msg);
            let _ = app_handle.emit("wallpaper-changed", ());

            let app2 = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                log::info!("[scheduler] Prefetching next wallpaper");
                match prefetch_next_wallpaper().await {
                    Ok(()) => {
                        log::info!("[scheduler] Next wallpaper ready");
                        let _ = app2.emit("next-wallpaper-ready", ());
                    }
                    Err(e) => log::warn!("[scheduler] Prefetch failed: {}", e),
                }
            });
        }
        Err(e) => log::error!("[scheduler] Wallpaper change failed: {}", e),
    }
}
