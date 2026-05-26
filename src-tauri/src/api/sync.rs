use crate::api::topics::sync_topics;
use crate::fs::{files, images, paths};
use crate::settings::load_settings;
use crate::unsplash::{CollectionMeta, UnsplashClient, UserProfile};
use chrono::Utc;

/// Refresh the 10 latest photo previews and avatar for every followed user.
pub async fn sync_users() -> Result<(), String> {
    log::info!("[sync] sync_users: starting");
    let settings = load_settings()?;
    let usernames: Vec<String> = settings
        .getter_targets
        .iter()
        .filter(|t| t.kind == "user")
        .map(|t| t.value.clone())
        .collect();

    let client = crate::unsplash::get_client()?;
    let now = Utc::now().to_rfc3339();

    for username in &usernames {
        if let Err(e) = refresh_one_user(&client, username, &now).await {
            log::error!("[sync] user {} failed: {}", username, e);
        }
    }

    log::info!("[sync] sync_users: done ({} users)", usernames.len());
    Ok(())
}

async fn refresh_one_user(client: &UnsplashClient, username: &str, now: &str) -> Result<(), String> {
    log::info!("[sync] refreshing user: {}", username);

    let user_dir = paths::users_dir()?.join(username);
    if !user_dir.exists() {
        return Err(format!("user dir missing for {}", username));
    }

    let profile_path = user_dir.join("profile.json");
    let mut profile: UserProfile = std::fs::read(&profile_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| format!("no profile.json for {}", username))?;

    // --- Avatar refresh (every 24 h) ---
    let needs_avatar = profile
        .avatar_last_refreshed_iso
        .as_ref()
        .and_then(|iso| chrono::DateTime::parse_from_rfc3339(iso).ok())
        .map(|t| {
            Utc::now()
                .signed_duration_since(t.with_timezone(&Utc))
                .num_hours()
                >= 24
        })
        .unwrap_or(true);

    if needs_avatar {
        // Use the cached URL if we have it; otherwise fetch the profile first
        let avatar_url = if let Some(ref url) = profile.avatar_url {
            Some(url.clone())
        } else {
            match client.get_user_profile(username).await {
                Ok(api) => api
                    .profile_image
                    .as_ref()
                    .and_then(|pi| pi.small.clone())
                    .inspect(|url| {
                        profile.avatar_url = Some(url.clone());
                    }),
                Err(e) => {
                    log::warn!("[sync] could not fetch profile for {}: {}", username, e);
                    None
                }
            }
        };

        if let Some(url) = avatar_url {
            log::debug!("[sync] refreshing avatar for {}", username);
            if let Ok((bytes, _)) = client.download_image(&url).await {
                let _ = images::save_as_jpeg_atomic(&user_dir.join("avatar_small.jpg"), &bytes);
            }
        }
        profile.avatar_last_refreshed_iso = Some(now.to_string());
    }

    // --- Photo previews (every call) ---
    let photos = client
        .get_user_photos(username, 1, 10, "latest", None)
        .await?;

    let new_ids: Vec<String> = photos.iter().map(|p| p.id.clone()).collect();
    let old_ids = profile.photo_preview_ids.clone();

    // Download previews we don't have yet
    for photo in &photos {
        if !old_ids.contains(&photo.id) {
            if let Some(ref url) = photo.urls.small {
                let dest = user_dir.join(format!("photo_preview_{}.jpg", photo.id));
                if !dest.exists() {
                    if let Ok((bytes, _)) = client.download_image(url).await {
                        let _ = images::save_as_jpeg_atomic(&dest, &bytes);
                    }
                }
            }
        }
    }

    // Delete previews no longer in the top 10
    for old_id in &old_ids {
        if !new_ids.contains(old_id) {
            let path = user_dir.join(format!("photo_preview_{}.jpg", old_id));
            if path.exists() {
                let _ = std::fs::remove_file(&path);
                log::debug!("[sync] deleted old preview {} for {}", old_id, username);
            }
        }
    }

    profile.photo_preview_ids = new_ids;
    profile.last_checked_iso = Some(now.to_string());

    let bytes = serde_json::to_vec_pretty(&profile)
        .map_err(|e| format!("serialize profile: {}", e))?;
    files::write_atomic(&profile_path, &bytes)?;

    log::info!("[sync] user {} refreshed OK", username);
    Ok(())
}

/// Poll every tracked collection for updates using ETag-based conditional requests.
pub async fn sync_collections() -> Result<(), String> {
    log::info!("[sync] sync_collections: starting");
    let settings = load_settings()?;
    let ids: Vec<String> = settings
        .getter_targets
        .iter()
        .filter(|t| t.kind == "collection")
        .map(|t| t.value.clone())
        .collect();

    let client = crate::unsplash::get_client()?;
    let now = Utc::now().to_rfc3339();

    for id in &ids {
        if let Err(e) = poll_one_collection(&client, id, &now).await {
            log::error!("[sync] collection {} failed: {}", id, e);
        }
    }

    log::info!("[sync] sync_collections: done ({} collections)", ids.len());
    Ok(())
}

async fn poll_one_collection(client: &UnsplashClient, id: &str, now: &str) -> Result<(), String> {
    log::info!("[sync] polling collection: {}", id);

    let col_dir = paths::collections_dir()?.join(id);
    if !col_dir.exists() {
        return Err(format!("collection dir missing for {}", id));
    }

    let meta_path = col_dir.join("meta.json");
    let mut meta: CollectionMeta = std::fs::read(&meta_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| format!("no meta.json for collection {}", id))?;

    match client.poll_collection(id, meta.etag.as_deref()).await? {
        None => {
            // 304 — just update the timestamp
            log::info!("[sync] collection {} not modified (304)", id);
            meta.last_checked_iso = Some(now.to_string());
        }
        Some((collection, new_etag)) => {
            log::info!("[sync] collection {} updated (200)", id);

            let new_cover_id = collection.cover_photo.as_ref().map(|p| p.id.clone());
            let cover_changed = new_cover_id != meta.cover_photo_id;

            let new_cover_url = if cover_changed {
                if let Some(ref photo) = collection.cover_photo {
                    if let Some(ref url) = photo.urls.small {
                        // Download new cover
                        let cover_path = col_dir.join(format!("cover_{}.jpg", photo.id));
                        if !cover_path.exists() {
                            if let Ok((bytes, _)) = client.download_image(url).await {
                                let _ = images::save_as_jpeg_atomic(&cover_path, &bytes);
                            }
                        }
                        // Remove old cover
                        if let Some(ref old_id) = meta.cover_photo_id {
                            let old = col_dir.join(format!("cover_{}.jpg", old_id));
                            if old.exists() {
                                let _ = std::fs::remove_file(&old);
                            }
                        }
                        Some(url.clone())
                    } else {
                        meta.cover_url.clone()
                    }
                } else {
                    None
                }
            } else {
                meta.cover_url.clone()
            };

            meta.title = collection.title;
            meta.description = collection.description;
            meta.total_photos = collection.total_photos;
            meta.cover_photo_id = new_cover_id;
            meta.cover_url = new_cover_url;
            meta.etag = new_etag;
            if let Some(ref user) = collection.user {
                meta.author_name = Some(user.name.clone());
                meta.author_username = Some(user.username.clone());
            }
            meta.last_checked_iso = Some(now.to_string());
        }
    }

    let bytes = serde_json::to_vec_pretty(&meta)
        .map_err(|e| format!("serialize meta: {}", e))?;
    files::write_atomic(&meta_path, &bytes)?;

    Ok(())
}

/// Refresh everything: users, collections, topics.
pub async fn refresh_all() -> Result<String, String> {
    log::info!("[sync] refresh_all: starting");
    let mut errors: Vec<String> = Vec::new();

    if let Err(e) = sync_users().await {
        errors.push(format!("Users: {}", e));
    }
    if let Err(e) = sync_collections().await {
        errors.push(format!("Collections: {}", e));
    }
    if let Err(e) = sync_topics().await {
        errors.push(format!("Topics: {}", e));
    }

    if errors.is_empty() {
        log::info!("[sync] refresh_all: done OK");
        Ok("All sources refreshed successfully.".to_string())
    } else {
        let msg = errors.join("\n");
        log::error!("[sync] refresh_all: done with errors:\n{}", msg);
        Err(msg)
    }
}

