use crate::fs::{dirs, files, images, paths};
use crate::getter::run_getter_cycle;
use crate::settings::{group_for_hour, load_settings};
use crate::unsplash::{ApiPhoto, UnsplashClient, WallpaperMeta};
use chrono::{Local, NaiveTime, Timelike, Utc};
use cron::Schedule;
use std::str::FromStr;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::sync::Mutex;

/// Serializes concurrent `change_wallpaper` calls so file rotation never races.
static CHANGE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn change_lock() -> &'static Mutex<()> {
    CHANGE_LOCK.get_or_init(|| Mutex::new(()))
}

/// Full wallpaper change cycle with rotation and prefetch.
///
/// Rotation:
///   current_wallpaper.jpg  →  previous_wallpaper.jpg
///   next_wallpaper.jpg     →  current_wallpaper.jpg  (if it exists)
///   (else run a fresh getter cycle for current)
///
/// After the new wallpaper is set a background task prefetches the next one.
pub async fn change_wallpaper() -> Result<String, String> {
    let _guard = change_lock().lock().await;
    log::info!("[wallpaper] Starting wallpaper change cycle");
    let settings = load_settings()?;

    let current_dir = paths::current_dir()?;
    dirs::ensure_dir(&current_dir)?;

    let current_img  = current_dir.join("current_wallpaper.jpg");
    let current_meta = current_dir.join("current_wallpaper_meta.json");
    let prev_img     = current_dir.join("previous_wallpaper.jpg");
    let prev_meta    = current_dir.join("previous_wallpaper_meta.json");
    let next_img     = current_dir.join("next_wallpaper.jpg");
    let next_meta    = current_dir.join("next_wallpaper_meta.json");

    // Rotate current → previous (ignore errors; first launch has no current yet)
    if current_img.exists()  { let _ = std::fs::rename(&current_img,  &prev_img); }
    if current_meta.exists() { let _ = std::fs::rename(&current_meta, &prev_meta); }

    let result_msg;

    if next_img.exists() {
        // Promote prefetched next → current
        std::fs::rename(&next_img, &current_img)
            .map_err(|e| format!("Failed to promote next wallpaper: {}", e))?;
        if next_meta.exists() {
            let _ = std::fs::rename(&next_meta, &current_meta);
        }

        set_wallpaper(&current_img, Some(&prev_img))?;

        result_msg = read_meta(&current_meta)
            .map(|m| format!("Wallpaper set!\nPhoto by {} — https://unsplash.com/photos/{}", m.author_name, m.photo_id))
            .unwrap_or_else(|| "Wallpaper set!".to_string());

        log::info!("[wallpaper] Used prefetched wallpaper");
    } else {
        // No prefetched next — fetch fresh
        let client = crate::unsplash::get_client()?;
        log::debug!(
            "[wallpaper] Fresh fetch: orientation={}, {} getter_target(s)",
            settings.orientation, settings.getter_targets.len()
        );

        let now_time = Local::now().naive_local().time();
        let time_group = group_for_hour(&settings.time_groups, now_time.hour())
            .map(|g| g.id.clone());
        let getter = run_getter_cycle(&client, &settings, Some(now_time)).await?;
        let photo  = getter.photo;
        log::info!("[wallpaper] Photo: id={} source={}:{} group={:?}", photo.id, getter.source_type, getter.source_value.as_deref().unwrap_or("random"), time_group);

        if let Some(ref dl) = photo.links.download_location {
            client.register_download(dl).await;
        }

        download_wallpaper_to_path(&client, &photo, &settings.quality, &current_img).await?;
        let dominant_color = images::dominant_color_hex(&current_img).ok();
        write_meta(&photo, getter.source_type, getter.source_value, time_group, dominant_color, &current_meta)?;

        set_wallpaper(&current_img, Some(&prev_img))?;
        log::info!("[wallpaper] Wallpaper set — photo by @{}", photo.user.username);
        result_msg = format!(
            "Wallpaper set!\nPhoto by {} — https://unsplash.com/photos/{}",
            photo.user.name, photo.id
        );
    }

    Ok(result_msg)
}

/// Run a getter cycle and save the result as `next_wallpaper.jpg/.json`.
/// Exposed publicly so callers can spawn it and emit an event on completion.
pub async fn prefetch_next_wallpaper() -> Result<(), String> {
    let settings    = load_settings()?;
    let client      = crate::unsplash::get_client()?;
    let current_dir = paths::current_dir()?;

    let next_time = compute_next_fire_time(&settings.wallpaper_cron);
    let time_group = next_time
        .and_then(|t| group_for_hour(&settings.time_groups, t.hour()))
        .map(|g| g.id.clone());
    let getter = run_getter_cycle(&client, &settings, next_time).await?;
    let photo  = getter.photo;

    if let Some(ref dl) = photo.links.download_location {
        client.register_download(dl).await;
    }

    let dest = current_dir.join("next_wallpaper.jpg");
    download_wallpaper_to_path(&client, &photo, &settings.quality, &dest).await?;
    let dominant_color = images::dominant_color_hex(&dest).ok();
    write_meta(&photo, getter.source_type, getter.source_value, time_group, dominant_color, &current_dir.join("next_wallpaper_meta.json"))?;

    Ok(())
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/// Download a photo at the requested quality to `dest` atomically.
pub async fn download_wallpaper_to_path(
    client: &UnsplashClient,
    photo: &ApiPhoto,
    quality: &str,
    dest: &Path,
) -> Result<(), String> {
    let image_url = match quality {
        "raw"   => photo.urls.raw.as_deref(),
        "full"  => photo.urls.full.as_deref(),
        "small" => photo.urls.small.as_deref(),
        "thumb" => photo.urls.thumb.as_deref(),
        _       => photo.urls.regular.as_deref(),
    }
    .ok_or_else(|| format!("No image URL for quality \"{}\"", quality))?;

    let (bytes, content_type) = client.download_image(image_url).await?;

    if let Some(parent) = dest.parent() {
        dirs::ensure_dir(parent)?;
    }
    if content_type.contains("jpeg") || content_type.contains("jpg") {
        files::write_atomic(dest, &bytes)?;
    } else {
        images::save_as_jpeg_atomic(dest, &bytes)?;
    }
    Ok(())
}

/// Backwards-compatible wrapper: download to `current/current_wallpaper.jpg`.
pub async fn download_wallpaper(
    client: &UnsplashClient,
    photo: &ApiPhoto,
    quality: &str,
) -> Result<PathBuf, String> {
    let current_dir = paths::current_dir()?;
    dirs::ensure_dir(&current_dir)?;
    let dest = current_dir.join("current_wallpaper.jpg");
    download_wallpaper_to_path(client, photo, quality, &dest).await?;
    Ok(dest)
}

/// Serialize and atomically write a `WallpaperMeta` JSON file.
fn write_meta(
    photo: &ApiPhoto,
    source_type: String,
    source_value: Option<String>,
    time_group: Option<String>,
    dominant_color: Option<String>,
    path: &Path,
) -> Result<(), String> {
    let meta = WallpaperMeta {
        photo_id:        photo.id.clone(),
        source_type,
        source_value,
        author_username: photo.user.username.clone(),
        author_name:     photo.user.name.clone(),
        unsplash_url:    format!("https://unsplash.com/photos/{}", photo.id),
        downloaded_iso:  Utc::now().to_rfc3339(),
        time_group,
        dominant_color,
    };
    let bytes = serde_json::to_vec_pretty(&meta)
        .map_err(|e| format!("Failed to serialize meta: {}", e))?;
    files::write_atomic(path, &bytes)
}

/// Try to deserialize a `WallpaperMeta` from a file; returns `None` on any error.
pub fn read_meta(path: &Path) -> Option<WallpaperMeta> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

/// Returns `true` if enabling a new source should trigger an immediate re-prefetch.
/// True when: no next wallpaper is queued, OR the queued one was from the "random" fallback.
pub fn should_reprefetch_on_enable() -> bool {
    let current_dir = match paths::current_dir() {
        Ok(d) => d,
        Err(_) => return false,
    };
    let img_path  = current_dir.join("next_wallpaper.jpg");
    let meta_path = current_dir.join("next_wallpaper_meta.json");

    if !img_path.exists() {
        return true;
    }
    match read_meta(&meta_path) {
        Some(m) => m.source_type == "random",
        None    => true,
    }
}

/// Check if the prefetched next wallpaper came from `source_type` + `source_value`.
/// If it matches, delete the next wallpaper files so the scheduler fetches a fresh one.
/// Returns `true` if the next wallpaper was invalidated.
pub fn invalidate_next_if_from_source(source_type: &str, source_value: &str) -> bool {
    let current_dir = match paths::current_dir() {
        Ok(d) => d,
        Err(_) => return false,
    };
    let meta_path = current_dir.join("next_wallpaper_meta.json");
    let img_path  = current_dir.join("next_wallpaper.jpg");

    let meta = match read_meta(&meta_path) {
        Some(m) => m,
        None => return false,
    };

    let matches = meta.source_type == source_type
        && meta.source_value.as_deref() == Some(source_value);

    if matches {
        let _ = std::fs::remove_file(&img_path);
        let _ = std::fs::remove_file(&meta_path);
        log::info!(
            "[wallpaper] Invalidated next wallpaper — source {}:{} was disabled",
            source_type, source_value
        );
        true
    } else {
        false
    }
}

/// Compute the local wall-clock time of the next scheduled wallpaper change.
/// Returns `None` for startup-only or invalid expressions.
fn compute_next_fire_time(cron_expr: &str) -> Option<NaiveTime> {
    if cron_expr == "@startup" || cron_expr.is_empty() {
        return None;
    }
    let six_field = format!("0 {}", cron_expr.trim());
    let schedule = Schedule::from_str(&six_field).ok()?;
    let next_utc = schedule.upcoming(Utc).next()?;
    let next_local = next_utc.with_timezone(&Local);
    Some(next_local.naive_local().time())
}

/// Set the desktop wallpaper to the file at `path`.
pub fn set_wallpaper(path: &PathBuf, prev_path: Option<&PathBuf>) -> Result<(), String> {
    let path_str = path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize path: {}", e))?
        .to_string_lossy()
        .to_string();
    let path_str = path_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&path_str)
        .to_string();

    #[cfg(target_os = "macos")]
    {
        let prev_str = prev_path
            .filter(|p| p.exists())
            .and_then(|p| p.canonicalize().ok())
            .map(|p| p.to_string_lossy().to_string());
        return set_wallpaper_macos(&path_str, prev_str.as_deref());
    }

    #[cfg(not(target_os = "macos"))]
    {
        wallpaper::set_from_path(&path_str)
            .map_err(|e| format!("Failed to set wallpaper: {}", e))?;
        wallpaper::set_mode(wallpaper::Mode::Crop)
            .map_err(|e| format!("Failed to set wallpaper mode: {}", e))?;
        Ok(())
    }
}

/// Sets the wallpaper on macOS using NSWorkspace with fill/crop scaling.
/// Each call writes the image to a unique timestamped filename so macOS
/// never hits its URL→bitmap cache (which causes stale content to be shown
/// when the same path is reused with different content across cycles).
#[cfg(target_os = "macos")]
fn set_wallpaper_macos(path_str: &str, _prev_str: Option<&str>) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSScreen, NSWorkspace, NSWorkspaceDesktopImageAllowClippingKey,
        NSWorkspaceDesktopImageScalingKey,
    };
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

    // macOS caches desktop wallpapers keyed by file URL. Reusing the same path
    // (current_wallpaper.jpg) with new content across cycles causes macOS to
    // show the stale cached bitmap instead of the updated file. Using a fresh
    // unique URL every call forces macOS to re-read from disk.
    let parent = std::path::Path::new(path_str)
        .parent()
        .unwrap_or(std::path::Path::new("/tmp"));

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let active_name = format!("wallpaper_active_{}.jpg", ts);
    let active_path = parent.join(&active_name);

    std::fs::copy(path_str, &active_path)
        .map_err(|e| format!("Failed to prepare wallpaper: {}", e))?;

    let active_str = active_path.to_string_lossy().to_string();

    unsafe {
        // SAFETY: setDesktopImageURL:forScreen:options:error: is documented as
        // thread-safe. MainThreadMarker is used only to satisfy NSScreen::screens.
        let mtm = MainThreadMarker::new_unchecked();

        let ns_path = NSString::from_str(&active_str);
        let url = NSURL::fileURLWithPath(&ns_path);
        let workspace = NSWorkspace::sharedWorkspace();

        // NSImageScaleProportionallyUpOrDown (3) + allowClipping = true → fill/crop
        let scaling_val = NSNumber::new_usize(3);
        let clipping_val = NSNumber::new_bool(true);
        let scaling_any = &*((&*scaling_val as *const NSNumber).cast::<AnyObject>());
        let clipping_any = &*((&*clipping_val as *const NSNumber).cast::<AnyObject>());

        let options = NSDictionary::<NSString, AnyObject>::from_slices(
            &[NSWorkspaceDesktopImageScalingKey, NSWorkspaceDesktopImageAllowClippingKey],
            &[scaling_any, clipping_any],
        );

        for screen in NSScreen::screens(mtm).iter() {
            workspace
                .setDesktopImageURL_forScreen_options_error(&url, &screen, &options)
                .map_err(|e| format!("Failed to set wallpaper: {}", e.localizedDescription()))?;
        }
    }

    // Clean up any previous unique-named copies, keeping only the one we just set.
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("wallpaper_active_")
                && name.ends_with(".jpg")
                && name != active_name
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    Ok(())
}
