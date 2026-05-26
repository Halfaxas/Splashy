use crate::fs::images::save_as_jpeg_atomic;
use crate::fs::paths::related_dir;
use crate::settings::{add_target_to_all_groups, load_settings, remove_target_from_all_groups, save_settings, GetterTarget};
use crate::unsplash::models::{RelatedSourceMeta, RelatedSourceSummary};
use regex::Regex;
use std::sync::OnceLock;

static PHOTO_URL_RE: OnceLock<Regex> = OnceLock::new();

fn photo_url_re() -> &'static Regex {
    PHOTO_URL_RE.get_or_init(|| {
        Regex::new(r"(?i)unsplash\.com/(?:photos|illustrations|collections/[^/]+/photos)/([A-Za-z0-9_-]+)").unwrap()
    })
}

/// Extract a photo ID from a full Unsplash URL or a bare ID.
/// URL format: https://unsplash.com/photos/<slug>-<id>
/// The photo ID is the last hyphen-separated segment of the path component.
fn extract_photo_id(input: &str) -> Option<String> {
    let input = input.trim();
    if input.is_empty() {
        return None;
    }

    if let Some(caps) = photo_url_re().captures(input) {
        let path_part = caps[1].to_string();
        // ID is the last segment after the last hyphen
        return path_part.split('-').last().map(|s| s.to_string());
    }

    // Bare ID: alphanumeric + underscore + hyphen, reasonable length
    if !input.contains('/') && !input.contains(' ') && !input.contains('.')
        && input.len() >= 4 && input.len() <= 30
        && input.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return Some(input.to_string());
    }

    None
}

#[tauri::command]
pub async fn import_related_source(input: String) -> Result<RelatedSourceSummary, String> {
    let photo_id = extract_photo_id(input.trim()).ok_or_else(|| {
        "Could not parse a photo ID. Paste a full Unsplash photo URL or a bare photo ID.".to_string()
    })?;

    let settings = load_settings()?;
    if settings
        .getter_targets
        .iter()
        .any(|t| t.kind == "related" && t.value == photo_id)
    {
        return Err(format!("Photo {} is already a source.", photo_id));
    }

    let client = crate::unsplash::get_client()?;
    let photo = client.get_photo(&photo_id).await.map_err(|e| {
        if e.contains("not found") || e.contains("404") {
            "Photo not found. Double-check the URL or ID.".to_string()
        } else {
            e
        }
    })?;

    let slug = photo
        .slug
        .clone()
        .unwrap_or_else(|| photo_id.clone());

    let dir = related_dir()?.join(&photo_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create related dir: {}", e))?;

    // Download preview
    let preview_path = dir.join("preview.jpg");
    let cover_url = if let Some(small_url) = &photo.urls.small {
        let (bytes, ct) = client.download_image(small_url).await?;
        if ct.contains("jpeg") || ct.contains("jpg") {
            let tmp = preview_path.with_extension("tmp");
            std::fs::write(&tmp, &bytes)
                .map_err(|e| format!("Failed to write preview tmp: {}", e))?;
            std::fs::rename(&tmp, &preview_path)
                .map_err(|e| format!("Failed to rename preview: {}", e))?;
        } else {
            save_as_jpeg_atomic(&preview_path, &bytes)?;
        }
        Some(preview_path.to_string_lossy().to_string())
    } else {
        None
    };

    let added_iso = chrono::Utc::now().to_rfc3339();
    let unsplash_url = format!("https://unsplash.com/photos/{}", slug);

    let meta = RelatedSourceMeta {
        photo_id: photo_id.clone(),
        slug: slug.clone(),
        author_name: photo.user.name.clone(),
        author_username: photo.user.username.clone(),
        unsplash_url: unsplash_url.clone(),
        added_iso,
    };
    let meta_path = dir.join("meta.json");
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(&meta_path, meta_json).map_err(|e| e.to_string())?;

    let mut settings = load_settings()?;
    let target_id = format!("related_{}", photo_id);
    settings.getter_targets.push(GetterTarget {
        id: target_id.clone(),
        kind: "related".to_string(),
        value: photo_id.clone(),
        enabled: true,
        weight: 1,
    });
    add_target_to_all_groups(&mut settings, &target_id);
    save_settings(&settings)?;

    Ok(RelatedSourceSummary {
        photo_id,
        slug,
        author_name: photo.user.name,
        author_username: photo.user.username,
        unsplash_url,
        cover_url,
        enabled: true,
    })
}

#[tauri::command]
pub async fn list_related_sources() -> Result<Vec<RelatedSourceSummary>, String> {
    let settings = load_settings()?;
    let mut results = Vec::new();

    for target in settings.getter_targets.iter().filter(|t| t.kind == "related") {
        let photo_id = &target.value;
        let dir = related_dir()?.join(photo_id);
        let meta_path = dir.join("meta.json");

        if let Ok(bytes) = std::fs::read(&meta_path) {
            if let Ok(meta) = serde_json::from_slice::<RelatedSourceMeta>(&bytes) {
                let preview_path = dir.join("preview.jpg");
                let cover_url = if preview_path.exists() {
                    Some(preview_path.to_string_lossy().to_string())
                } else {
                    None
                };
                results.push(RelatedSourceSummary {
                    photo_id: meta.photo_id,
                    slug: meta.slug,
                    author_name: meta.author_name,
                    author_username: meta.author_username,
                    unsplash_url: meta.unsplash_url,
                    cover_url,
                    enabled: target.enabled,
                });
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn delete_related_source(photo_id: String) -> Result<(), String> {
    let mut settings = load_settings()?;
    remove_target_from_all_groups(&mut settings, &format!("related_{}", photo_id));
    settings
        .getter_targets
        .retain(|t| !(t.kind == "related" && t.value == photo_id));
    save_settings(&settings)?;

    let dir = related_dir()?.join(&photo_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("Failed to delete related dir: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_related_source(photo_id: String, enabled: bool) -> Result<(), String> {
    let mut settings = load_settings()?;
    if let Some(t) = settings
        .getter_targets
        .iter_mut()
        .find(|t| t.kind == "related" && t.value == photo_id)
    {
        t.enabled = enabled;
    }
    save_settings(&settings)?;

    if !enabled && crate::wallpaper::invalidate_next_if_from_source("related", &photo_id) {
        crate::scheduler::notify_reprefetch();
    } else if enabled && crate::wallpaper::should_reprefetch_on_enable() {
        crate::scheduler::notify_reprefetch();
    }

    Ok(())
}
