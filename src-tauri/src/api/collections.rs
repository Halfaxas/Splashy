use crate::fs::{dirs, files, images, paths};
use crate::settings::{add_target_to_all_groups, load_settings, remove_target_from_all_groups, save_settings, GetterTarget};
use crate::unsplash::{CollectionMeta, CollectionSummary};
use regex::Regex;
use std::sync::OnceLock;

static URL_RE: OnceLock<Regex> = OnceLock::new();

fn url_re() -> &'static Regex {
    URL_RE.get_or_init(|| {
        Regex::new(
            r"(?i)^https?://(?:www\.)?unsplash\.com/collections/([^/?#]+)(?:[/?#].*)?$",
        )
        .unwrap()
    })
}

/// Extract a bare collection ID from either a full Unsplash URL or a raw ID.
/// Accepts:
///   https://unsplash.com/collections/7uTR2-cmywI/some-slug
///   https://unsplash.com/collections/tXdKZoWLsLk
///   tXdKZoWLsLk
///   7uTR2-cmywI
fn extract_collection_id(input: &str) -> Result<String, String> {
    let input = input.trim();

    if input.is_empty() {
        return Err("Please enter a collection ID or Unsplash URL.".to_string());
    }

    // Full URL — capture whatever sits between /collections/ and the next / ? #
    if let Some(caps) = url_re().captures(input) {
        return Ok(caps[1].trim().to_string());
    }

    // URL-looking but didn't match
    if input.contains("unsplash.com") {
        return Err(
            "Invalid Unsplash URL. Expected: https://unsplash.com/collections/{id}".to_string(),
        );
    }

    // Bare ID — length 11, no spaces or slashes
    if !input.contains('/') && !input.contains(' ') {
        return Ok(input.to_string());
    }

    Err(format!(
        "\"{}\" is not a valid collection ID or Unsplash URL.",
        input
    ))
}

#[tauri::command]
pub async fn list_collections() -> Result<Vec<CollectionSummary>, String> {
    let settings = load_settings()?;
    let mut result = Vec::new();

    for target in settings
        .getter_targets
        .iter()
        .filter(|t| t.kind == "collection")
    {
        let col_dir = paths::collections_dir()?.join(&target.value);
        let meta_path = col_dir.join("meta.json");

        if meta_path.exists() {
            let bytes = std::fs::read(&meta_path)
                .map_err(|e| format!("Failed to read collection meta: {}", e))?;
            if let Ok(meta) = serde_json::from_slice::<CollectionMeta>(&bytes) {
                result.push(CollectionSummary {
                    id: meta.id,
                    title: meta.title,
                    description: meta.description,
                    count: meta.total_photos,
                    cover_url: meta.cover_url,
                    author_name: meta.author_name,
                    author_username: meta.author_username,
                    enabled: target.enabled,
                });
                continue;
            }
        }

        // Meta file missing — return minimal placeholder
        result.push(CollectionSummary {
            id: target.value.clone(),
            title: target.value.clone(),
            description: None,
            count: 0,
            cover_url: None,
            author_name: None,
            author_username: None,
            enabled: target.enabled,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn import_collection(id: String) -> Result<CollectionSummary, String> {
    log::info!("[collections] import_collection: raw input={:?}", id);
    let id = extract_collection_id(&id)?;
    log::info!("[collections] import_collection: resolved id={}", id);
    let client = crate::unsplash::get_client()?;

    // Probe: verify photos can actually be fetched from this collection
    match client.get_random_photo(&[("collections", id.as_str())]).await {
        Ok(_) => {}
        Err(e) if e.contains("404") => {
            return Err("Sorry, we could not get photos from this collection :(".to_string());
        }
        Err(_) => {} // transient error — allow import anyway
    }

    let collection = client.get_collection(&id).await?;

    let col_dir = paths::collections_dir()?.join(&id);
    dirs::ensure_dir(&col_dir)?;

    let cover_photo_id = collection.cover_photo.as_ref().map(|p| p.id.clone());
    let cover_url = collection
        .cover_photo
        .as_ref()
        .and_then(|p| p.urls.regular.clone().or_else(|| p.urls.small.clone()));

    let author_name = collection.user.as_ref().map(|u| u.name.clone());
    let author_username = collection.user.as_ref().map(|u| u.username.clone());

    let meta = CollectionMeta {
        id: collection.id.clone(),
        title: collection.title.clone(),
        description: collection.description.clone(),
        total_photos: collection.total_photos,
        cover_photo_id: cover_photo_id.clone(),
        cover_url: cover_url.clone(),
        etag: None,
        last_checked_iso: None,
        author_name: author_name.clone(),
        author_username: author_username.clone(),
    };
    let meta_bytes = serde_json::to_vec_pretty(&meta)
        .map_err(|e| format!("Failed to serialize collection meta: {}", e))?;
    files::write_atomic(&col_dir.join("meta.json"), &meta_bytes)?;

    // Download cover photo to disk as well
    if let (Some(photo), Some(ref photo_id)) = (&collection.cover_photo, &cover_photo_id) {
        if let Some(ref url) = photo.urls.regular.as_ref().or(photo.urls.small.as_ref()) {
            let (bytes, _) = client.download_image(url).await?;
            let cover_path = col_dir.join(format!("cover_{}.jpg", photo_id));
            images::save_as_jpeg_atomic(&cover_path, &bytes)?;
        }
    }

    // Add to settings.getter_targets if not already tracked
    let mut settings = load_settings()?;
    let already_tracked = settings
        .getter_targets
        .iter()
        .any(|t| t.kind == "collection" && t.value == id);

    if !already_tracked {
        let target_id = format!("collection_{}", id);
        settings.getter_targets.push(GetterTarget {
            id: target_id.clone(),
            kind: "collection".to_string(),
            value: id,
            enabled: true,
            weight: 1,
        });
        add_target_to_all_groups(&mut settings, &target_id);
        save_settings(&settings)?;
        if crate::wallpaper::should_reprefetch_on_enable() {
            crate::scheduler::notify_reprefetch();
        }
    }

    Ok(CollectionSummary {
        id: collection.id,
        title: collection.title,
        description: collection.description,
        count: collection.total_photos,
        cover_url,
        author_name,
        author_username,
        enabled: true,
    })
}

#[tauri::command]
pub async fn delete_collection(id: String) -> Result<(), String> {
    log::info!("[collections] delete_collection: id={}", id);
    let mut settings = load_settings()?;
    remove_target_from_all_groups(&mut settings, &format!("collection_{}", id));
    settings
        .getter_targets
        .retain(|t| !(t.kind == "collection" && t.value == id));
    save_settings(&settings)?;

    // Delete the collection directory
    let col_dir = paths::collections_dir()?.join(&id);
    if col_dir.exists() {
        std::fs::remove_dir_all(&col_dir)
            .map_err(|e| format!("Failed to delete collection folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_collection(id: String, enabled: bool) -> Result<(), String> {
    log::info!("[collections] toggle_collection: id={} enabled={}", id, enabled);
    let mut settings = load_settings()?;

    if let Some(target) = settings
        .getter_targets
        .iter_mut()
        .find(|t| t.kind == "collection" && t.value == id)
    {
        target.enabled = enabled;
    } else if enabled {
        settings.getter_targets.push(GetterTarget {
            id: format!("collection_{}", id),
            kind: "collection".to_string(),
            value: id.clone(),
            enabled: true,
            weight: 1,
        });
    }

    save_settings(&settings)?;

    if !enabled && crate::wallpaper::invalidate_next_if_from_source("collection", &id) {
        crate::scheduler::notify_reprefetch();
    } else if enabled && crate::wallpaper::should_reprefetch_on_enable() {
        crate::scheduler::notify_reprefetch();
    }

    Ok(())
}
