use crate::fs::{dirs, files, images, paths};
use crate::settings::{add_target_to_all_groups, load_settings, remove_target_from_all_groups, save_settings, GetterTarget};
use crate::unsplash::{UserProfile, UserSummary};
use chrono::Utc;
use regex::Regex;
use std::sync::OnceLock;

static USER_URL_RE: OnceLock<Regex> = OnceLock::new();

fn user_url_re() -> &'static Regex {
    USER_URL_RE.get_or_init(|| {
        Regex::new(r"(?i)^https?://(?:www\.)?unsplash\.com/@([^/?#\s]+)(?:[/?#].*)?$").unwrap()
    })
}

/// Extract a bare Unsplash username from either a profile URL or a raw username.
/// Accepts:
///   https://unsplash.com/@lishakov
///   https://www.unsplash.com/@lishakov/collections
///   lishakov
///   @lishakov
fn extract_username(input: &str) -> Result<String, String> {
    let input = input.trim();

    if input.is_empty() {
        return Err("Please enter a username or Unsplash profile URL.".to_string());
    }

    // Full URL — capture the username after /@
    if let Some(caps) = user_url_re().captures(input) {
        return Ok(caps[1].to_string());
    }

    // URL-looking but didn't match expected format
    if input.contains("unsplash.com") {
        return Err(
            "Invalid Unsplash URL. Expected: https://unsplash.com/@username".to_string(),
        );
    }

    // Strip leading @ if present (e.g. "@lishakov")
    let username = input.trim_start_matches('@');

    if username.is_empty() {
        return Err("Please enter a username or Unsplash profile URL.".to_string());
    }

    Ok(username.to_string())
}

#[tauri::command]
pub async fn list_users() -> Result<Vec<UserSummary>, String> {
    let settings = load_settings()?;
    let mut result = Vec::new();

    for target in settings.getter_targets.iter().filter(|t| t.kind == "user") {
        let user_dir = paths::users_dir()?.join(&target.value);
        let profile_path = user_dir.join("profile.json");

        if profile_path.exists() {
            let bytes = std::fs::read(&profile_path)
                .map_err(|e| format!("Failed to read user profile: {}", e))?;
            if let Ok(profile) = serde_json::from_slice::<UserProfile>(&bytes) {
                let avatar_path = {
                    let p = user_dir.join("avatar_small.jpg");
                    if p.exists() { p.to_str().map(|s| s.to_string()) } else { None }
                };
                result.push(UserSummary {
                    username: profile.username,
                    name: profile.name,
                    bio: profile.bio,
                    total_photos: profile.total_photos,
                    avatar_path,
                    enabled: target.enabled,
                });
                continue;
            }
        }

        // Profile file missing — return minimal placeholder
        result.push(UserSummary {
            username: target.value.clone(),
            name: target.value.clone(),
            bio: None,
            total_photos: 0,
            avatar_path: None,
            enabled: target.enabled,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn follow_user(username: String) -> Result<UserSummary, String> {
    log::info!("[users] follow_user: raw input={:?}", username);
    let username = extract_username(&username)?;
    log::info!("[users] follow_user: resolved username={}", username);
    let client = crate::unsplash::get_client()?;
    let api_user = client.get_user_profile(&username).await?;

    let user_dir = paths::users_dir()?.join(&username);
    dirs::ensure_dir(&user_dir)?;

    let avatar_url = api_user
        .profile_image
        .as_ref()
        .and_then(|pi| pi.small.clone());

    // Download avatar
    if let Some(ref url) = avatar_url {
        if let Ok((bytes, _)) = client.download_image(url).await {
            let avatar_path = user_dir.join("avatar_small.jpg");
            let _ = images::save_as_jpeg_atomic(&avatar_path, &bytes);
        }
    }

    // Fetch initial 10 photo previews
    let now = Utc::now().to_rfc3339();
    let preview_ids = match client
        .get_user_photos(&username, 1, 10, "latest", None)
        .await
    {
        Ok(photos) => {
            for photo in &photos {
                if let Some(ref url) = photo.urls.small {
                    let dest = user_dir.join(format!("photo_preview_{}.jpg", photo.id));
                    if !dest.exists() {
                        if let Ok((bytes, _)) = client.download_image(url).await {
                            let _ = images::save_as_jpeg_atomic(&dest, &bytes);
                        }
                    }
                }
            }
            photos.into_iter().map(|p| p.id).collect()
        }
        Err(e) => {
            log::warn!("[users] could not fetch initial previews for {}: {}", username, e);
            vec![]
        }
    };

    let profile = UserProfile {
        username: api_user.username.clone(),
        name: api_user.name.clone(),
        bio: api_user.bio.clone(),
        total_photos: api_user.total_photos,
        avatar_url,
        photo_preview_ids: preview_ids,
        last_checked_iso: Some(now.clone()),
        avatar_last_refreshed_iso: Some(now),
    };
    let profile_bytes = serde_json::to_vec_pretty(&profile)
        .map_err(|e| format!("Failed to serialize user profile: {}", e))?;
    files::write_atomic(&user_dir.join("profile.json"), &profile_bytes)?;

    // Add to settings.getter_targets if not already tracked
    let mut settings = load_settings()?;
    if !settings
        .getter_targets
        .iter()
        .any(|t| t.kind == "user" && t.value == username)
    {
        let target_id = format!("user_{}", username);
        settings.getter_targets.push(GetterTarget {
            id: target_id.clone(),
            kind: "user".to_string(),
            value: username,
            enabled: true,
            weight: 1,
        });
        add_target_to_all_groups(&mut settings, &target_id);
        save_settings(&settings)?;
        if crate::wallpaper::should_reprefetch_on_enable() {
            crate::scheduler::notify_reprefetch();
        }
    }

    let avatar_path = {
        let p = user_dir.join("avatar_small.jpg");
        if p.exists() { p.to_str().map(|s| s.to_string()) } else { None }
    };
    Ok(UserSummary {
        username: api_user.username,
        name: api_user.name,
        bio: api_user.bio,
        total_photos: api_user.total_photos,
        avatar_path,
        enabled: true,
    })
}

#[tauri::command]
pub async fn delete_user(username: String) -> Result<(), String> {
    log::info!("[users] delete_user: username={}", username);
    let mut settings = load_settings()?;
    remove_target_from_all_groups(&mut settings, &format!("user_{}", username));
    settings
        .getter_targets
        .retain(|t| !(t.kind == "user" && t.value == username));
    save_settings(&settings)?;

    // Delete the user directory
    let user_dir = paths::users_dir()?.join(&username);
    if user_dir.exists() {
        std::fs::remove_dir_all(&user_dir)
            .map_err(|e| format!("Failed to delete user folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_user(username: String, enabled: bool) -> Result<(), String> {
    log::info!("[users] toggle_user: username={} enabled={}", username, enabled);
    let mut settings = load_settings()?;

    if let Some(target) = settings
        .getter_targets
        .iter_mut()
        .find(|t| t.kind == "user" && t.value == username)
    {
        target.enabled = enabled;
    } else if enabled {
        settings.getter_targets.push(GetterTarget {
            id: format!("user_{}", username),
            kind: "user".to_string(),
            value: username.clone(),
            enabled: true,
            weight: 1,
        });
    }

    save_settings(&settings)?;

    if !enabled && crate::wallpaper::invalidate_next_if_from_source("user", &username) {
        crate::scheduler::notify_reprefetch();
    } else if enabled && crate::wallpaper::should_reprefetch_on_enable() {
        crate::scheduler::notify_reprefetch();
    }

    Ok(())
}
