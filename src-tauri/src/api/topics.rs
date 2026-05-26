use crate::fs::{dirs, files, images, paths};
use crate::settings::{add_target_to_all_groups, load_settings, save_settings};
use crate::unsplash::{TopicMeta, TopicWithEnabled, UnsplashClient};

/// Returns true if the topic ID works with the `topics=` query param.
/// Returns false on 404. Non-404 errors are treated as transient (returns true to avoid discarding).
async fn probe_topic_works(client: &UnsplashClient, topic_id: &str) -> bool {
    match client.get_random_photo(&[("topics", topic_id)]).await {
        Ok(_) => true,
        Err(e) if e.contains("404") => {
            log::info!("[topics] probe: id={} got 404 with topics=, will discard", topic_id);
            false
        }
        Err(e) => {
            log::warn!("[topics] probe: id={} non-404 error ({}), keeping", topic_id, e);
            true
        }
    }
}

/// Discard a topic: remove its directory and getter_target entry.
fn discard_topic(topic_dir: &std::path::Path, topic_id: &str, settings: &mut crate::settings::Settings) {
    if topic_dir.exists() {
        let _ = std::fs::remove_dir_all(topic_dir);
    }
    settings.getter_targets.retain(|t| !(t.kind == "topic" && t.value == topic_id));
}

/// Fetch all topics from Unsplash, diff against disk, add new ones and remove obsolete ones.
/// Topics that return 404 with topics= are discarded. All others use topics= param.
/// New topics are stored on disk but NOT added to getter_targets (untoggled by default).
/// Returns the updated list of all topics with their enabled state.
pub async fn sync_topics() -> Result<Vec<TopicWithEnabled>, String> {
    log::info!("[topics] sync_topics: fetching from Unsplash");
    let client = crate::unsplash::get_client()?;

    // Fetch all topics from API (per_page=30 covers all Unsplash topics)
    let api_topics = client.list_topics_paged(1, 30, "featured").await?;
    log::info!("[topics] sync_topics: got {} topics from API", api_topics.len());

    let mut settings = load_settings()?;
    let topics_dir = paths::topics_dir()?;
    dirs::ensure_dir(&topics_dir)?;

    // Collect slugs currently on disk
    let disk_slugs: Vec<String> = std::fs::read_dir(&topics_dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();

    let api_slugs: std::collections::HashSet<&str> =
        api_topics.iter().map(|t| t.slug.as_str()).collect();

    // Remove topics that are no longer returned by the API
    for slug in &disk_slugs {
        if !api_slugs.contains(slug.as_str()) {
            log::info!("[topics] sync_topics: removing obsolete topic slug={}", slug);
            let topic_dir = topics_dir.join(slug);
            let meta_id: Option<String> = std::fs::read(topic_dir.join("meta.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<TopicMeta>(&b).ok())
                .map(|m| m.id);
            if topic_dir.exists() {
                let _ = std::fs::remove_dir_all(&topic_dir);
            }
            if let Some(id) = meta_id {
                settings.getter_targets.retain(|t| !(t.kind == "topic" && t.value == id));
            }
        }
    }

    let disk_slug_set: std::collections::HashSet<&str> =
        disk_slugs.iter().map(|s| s.as_str()).collect();

    let mut result = Vec::new();

    for topic in &api_topics {
        let topic_dir = topics_dir.join(&topic.slug);
        let is_new = !disk_slug_set.contains(topic.slug.as_str());

        // Probe if: new topic, or existing topic not yet probed (photo_param is None or not "topics").
        let already_probed = if !is_new {
            std::fs::read(topic_dir.join("meta.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<TopicMeta>(&b).ok())
                .map(|m| m.photo_param.as_deref() == Some("topics"))
                .unwrap_or(false)
        } else {
            false
        };

        if !already_probed {
            log::info!("[topics] sync_topics: probing slug={} id={}", topic.slug, topic.id);
            if !probe_topic_works(&client, &topic.id).await {
                log::warn!("[topics] sync_topics: discarding slug={} id={}", topic.slug, topic.id);
                discard_topic(&topic_dir, &topic.id, &mut settings);
                continue;
            }
        }

        dirs::ensure_dir(&topic_dir)?;

        let cover_photo_id = topic.cover_photo.as_ref().map(|p| p.id.clone());
        let cover_url = topic
            .cover_photo
            .as_ref()
            .and_then(|p| p.urls.regular.clone().or_else(|| p.urls.small.clone()));

        // Download cover locally as well (offline cache)
        if let (Some(ref photo_id), Some(ref url)) = (&cover_photo_id, &cover_url) {
            let cover_path = topic_dir.join(format!("cover_{}.jpg", photo_id));
            if !cover_path.exists() {
                log::debug!("[topics] downloading cover for slug={}", topic.slug);
                if let Ok((bytes, _)) = client.download_image(url).await {
                    let _ = images::save_as_jpeg_atomic(&cover_path, &bytes);
                }
            }
        }

        let meta = TopicMeta {
            id: topic.id.clone(),
            slug: topic.slug.clone(),
            title: topic.title.clone(),
            total_photos: topic.total_photos,
            cover_photo_id,
            cover_url: cover_url.clone(),
            photo_param: Some("topics".to_string()),
        };
        let meta_bytes = serde_json::to_vec_pretty(&meta)
            .map_err(|e| format!("Failed to serialize topic meta: {}", e))?;
        files::write_atomic(&topic_dir.join("meta.json"), &meta_bytes)?;

        let enabled = settings
            .getter_targets
            .iter()
            .any(|t| t.kind == "topic" && t.value == topic.id && t.enabled);

        result.push(TopicWithEnabled {
            id: topic.id.clone(),
            slug: topic.slug.clone(),
            title: topic.title.clone(),
            total_photos: topic.total_photos,
            cover_url,
            enabled,
        });
    }

    save_settings(&settings)?;
    result.sort_by(|a, b| a.title.cmp(&b.title));
    log::info!("[topics] sync_topics: done, {} topics", result.len());
    Ok(result)
}

#[tauri::command]
pub async fn list_topics() -> Result<Vec<TopicWithEnabled>, String> {
    let topics_dir = paths::topics_dir()?;
    let settings = load_settings()?;

    if !topics_dir.exists() {
        return Ok(vec![]);
    }

    let entries = std::fs::read_dir(&topics_dir)
        .map_err(|e| format!("Failed to read topics dir: {}", e))?;

    let mut result = Vec::new();

    for entry in entries.flatten() {
        let meta_path = entry.path().join("meta.json");
        if !meta_path.exists() {
            continue;
        }
        let bytes = match std::fs::read(&meta_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let meta: TopicMeta = match serde_json::from_slice(&bytes) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let enabled = settings
            .getter_targets
            .iter()
            .any(|t| t.kind == "topic" && t.value == meta.id && t.enabled);

        result.push(TopicWithEnabled {
            id: meta.id,
            slug: meta.slug,
            title: meta.title,
            total_photos: meta.total_photos,
            cover_url: meta.cover_url,
            enabled,
        });
    }

    result.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(result)
}

#[tauri::command]
pub async fn toggle_topic(topic_id: String, enabled: bool) -> Result<(), String> {
    log::info!("[topics] toggle_topic: id={} enabled={}", topic_id, enabled);
    let mut settings = load_settings()?;

    if let Some(target) = settings
        .getter_targets
        .iter_mut()
        .find(|t| t.kind == "topic" && t.value == topic_id)
    {
        target.enabled = enabled;
    } else if enabled {
        let target_id = format!("topic_{}", topic_id);
        settings.getter_targets.push(crate::settings::GetterTarget {
            id: target_id.clone(),
            kind: "topic".to_string(),
            value: topic_id.clone(),
            enabled: true,
            weight: 1,
        });
        add_target_to_all_groups(&mut settings, &target_id);
    }

    save_settings(&settings)?;

    if !enabled && crate::wallpaper::invalidate_next_if_from_source("topic", &topic_id) {
        crate::scheduler::notify_reprefetch();
    } else if enabled && crate::wallpaper::should_reprefetch_on_enable() {
        crate::scheduler::notify_reprefetch();
    }

    Ok(())
}
