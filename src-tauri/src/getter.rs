use crate::settings::{group_for_hour, GetterTarget, Settings};
use crate::unsplash::{ApiPhoto, UnsplashClient};
use chrono::{NaiveTime, Timelike};
use rand::prelude::IndexedRandom;
use rand::Rng;
use tokio::time::{sleep, Duration};

const MAX_TARGET_ATTEMPTS: usize = 3;
const MAX_RETRIES: usize = 3;
const BASE_BACKOFF_MS: u64 = 500;
const BACKOFF_MULTIPLIER: u64 = 3;
const MAX_BACKOFF_MS: u64 = 30_000;

/// Result of a successful getter cycle: photo + where it came from.
pub struct GetterResult {
    pub photo: ApiPhoto,
    pub source_type: String,
    pub source_value: Option<String>,
}

/// Select a random photo according to the getter_targets in settings.
/// `at` — when provided, restricts candidates to those in the matching time group.
///         Falls back to all enabled targets if the group is empty or no group matches.
/// Falls back to a random photo only when no targets are configured/enabled.
/// If targets are configured but all fail, returns an error.
pub async fn run_getter_cycle(
    client: &UnsplashClient,
    settings: &Settings,
    at: Option<NaiveTime>,
) -> Result<GetterResult, String> {
    let all_enabled: Vec<&GetterTarget> = settings
        .getter_targets
        .iter()
        .filter(|t| t.enabled && t.weight > 0)
        .collect();

    let enabled: Vec<&GetterTarget> = if let Some(time) = at {
        let hour = time.hour();
        if let Some(group) = group_for_hour(&settings.time_groups, hour) {
            let ids: std::collections::HashSet<&str> =
                group.target_ids.iter().map(|s| s.as_str()).collect();
            let filtered: Vec<&GetterTarget> = all_enabled
                .iter()
                .filter(|t| ids.contains(t.id.as_str()))
                .copied()
                .collect();
            if !filtered.is_empty() {
                log::info!(
                    "[getter] Time group \"{}\" — {} candidate(s)",
                    group.id,
                    filtered.len()
                );
                filtered
            } else {
                log::info!("[getter] Time group \"{}\" has no enabled targets — using all", group.id);
                all_enabled
            }
        } else {
            all_enabled
        }
    } else {
        all_enabled
    };

    if enabled.is_empty() {
        log::info!("[getter] No enabled targets — fetching random photo");
        let photo = fetch_with_retry(client, None, &settings.orientation).await?;
        log::info!("[getter] Random photo fetched: id={}", photo.id);
        return Ok(GetterResult {
            photo,
            source_type: "random".to_string(),
            source_value: None,
        });
    }

    log::info!(
        "[getter] {} enabled target(s), orientation={}",
        enabled.len(),
        settings.orientation
    );
    for t in &enabled {
        log::debug!("[getter]   target: kind={} value={} weight={}", t.kind, t.value, t.weight);
    }

    // Build weighted pool: each target appears `weight` times
    let pool: Vec<usize> = enabled
        .iter()
        .enumerate()
        .flat_map(|(i, t)| std::iter::repeat(i).take(t.weight as usize))
        .collect();

    let mut last_err = String::new();

    for attempt in 0..MAX_TARGET_ATTEMPTS {
        // Scope rng so it's dropped before any await point (ThreadRng is not Send)
        let idx = {
            let mut rng = rand::rng();
            match pool.choose(&mut rng).copied() {
                Some(i) => i,
                None => break,
            }
        };
        let target = enabled[idx];

        log::info!(
            "[getter] Attempt {}/{}: kind={} value={}",
            attempt + 1,
            MAX_TARGET_ATTEMPTS,
            target.kind,
            target.value
        );

        match fetch_with_retry(client, Some(target), &settings.orientation).await {
            Ok(photo) => {
                log::info!(
                    "[getter] Success — photo id={} by @{}",
                    photo.id,
                    photo.user.username
                );
                return Ok(GetterResult {
                    photo,
                    source_type: target.kind.clone(),
                    source_value: Some(target.value.clone()),
                });
            }
            Err(e) => {
                log::warn!("[getter] Attempt {}/{} failed: {}", attempt + 1, MAX_TARGET_ATTEMPTS, e);
                last_err = e;
            }
        }
    }

    // All target attempts failed — return error, do not silently fall back to random
    // (falling back to random only happens when no targets are configured at all)
    log::error!("[getter] All configured sources failed. Last error: {}", last_err);
    Err(format!("All configured sources failed. Last error: {}", last_err))
}

/// Returns orientations to try in order: selected first, portrait last (unless selected is portrait).
fn orientations_to_try(selected: &str) -> Vec<&'static str> {
    match selected {
        "portrait" => vec!["portrait", "landscape", "squarish"],
        "squarish"  => vec!["squarish", "landscape", "portrait"],
        _           => vec!["landscape", "squarish", "portrait"],
    }
}

/// Attempt to fetch a photo for `target`, trying each orientation in order.
/// On 404 for a given orientation, moves to the next one.
/// Rate-limit errors stop immediately. Transient errors are retried with backoff per orientation.
async fn fetch_with_retry(
    client: &UnsplashClient,
    target: Option<&GetterTarget>,
    orientation: &str,
) -> Result<ApiPhoto, String> {
    let orientations = orientations_to_try(orientation);
    let mut last_err = String::new();

    'orientation: for orient in &orientations {
        let mut backoff_ms = BASE_BACKOFF_MS;

        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                log::debug!(
                    "[getter] Retry {}/{} after {}ms (orientation={})",
                    attempt, MAX_RETRIES, backoff_ms, orient
                );
                sleep(Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * BACKOFF_MULTIPLIER).min(MAX_BACKOFF_MS);
            }

            match fetch_for_target(client, target, orient).await {
                Ok(photo) => return Ok(photo),
                Err(e) if e.contains("ERR_RATE_LIMITED") => {
                    log::warn!("[getter] Rate limited, stopping");
                    return Err(e);
                }
                Err(e) if e.contains("404") => {
                    log::info!("[getter] 404 for orientation={}, trying next orientation", orient);
                    last_err = e;
                    continue 'orientation;
                }
                Err(e) => {
                    log::debug!(
                        "[getter] Transient error on attempt {} (orientation={}): {}",
                        attempt, orient, e
                    );
                    last_err = e;
                }
            }
        }

        // Exhausted retries on a transient error for this orientation — give up
        log::warn!("[getter] Exhausted retries for orientation={}", orient);
        break;
    }

    Err(last_err)
}

/// Fetch a random related photo for the given source photo ID.
/// Picks a random starting page (1..=30), halves on 400, retries up to 3 times.
async fn fetch_related_photo(client: &UnsplashClient, photo_id: &str) -> Result<ApiPhoto, String> {
    let mut page: u32 = { rand::rng().random_range(1u32..=30) };

    for attempt in 0..3usize {
        log::debug!(
            "[getter] related: photo_id={} page={} attempt={}",
            photo_id, page, attempt
        );
        match client.get_related_photos(photo_id, page).await {
            Ok(result) if !result.results.is_empty() => {
                let idx = { rand::rng().random_range(0..result.results.len()) };
                return Ok(result.results[idx].clone());
            }
            Ok(_) => {
                return Err(format!("No related photos found for photo_id={}", photo_id));
            }
            Err(e) if e.contains("ERR_BAD_PAGE") => {
                log::warn!(
                    "[getter] related: 400 on page={}, halving (attempt {})",
                    page, attempt + 1
                );
                page = (page / 2).max(1);
                if attempt == 2 {
                    return Err(e);
                }
            }
            Err(e) => return Err(e),
        }
    }
    Err("Failed to fetch related photos after 3 attempts".to_string())
}

async fn fetch_for_target(
    client: &UnsplashClient,
    target: Option<&GetterTarget>,
    orientation: &str,
) -> Result<ApiPhoto, String> {
    match target {
        None => client.get_random_photo(&[("orientation", orientation)]).await,
        Some(t) => match t.kind.as_str() {
            "collection" => {
                client
                    .get_random_photo(&[("collections", &t.value), ("orientation", orientation)])
                    .await
            }
            "user" => {
                client
                    .get_random_photo(&[("username", &t.value), ("orientation", orientation)])
                    .await
            }
            "topic" => {
                client
                    .get_random_photo(&[("topics", &t.value), ("orientation", orientation)])
                    .await
            }
            "search" => {
                client
                    .get_random_photo(&[("query", &t.value), ("orientation", orientation)])
                    .await
            }
            "color" => {
                client
                    .get_random_photo(&[("query", &t.value), ("orientation", orientation)])
                    .await
            }
            "related" => fetch_related_photo(client, &t.value).await,
            _ => Err(format!("Unknown target type: {}", t.kind)),
        },
    }
}
