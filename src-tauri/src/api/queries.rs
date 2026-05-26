use crate::settings::{add_target_to_all_groups, load_settings, remove_target_from_all_groups, save_settings, GetterTarget};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct QuerySummary {
    pub id: String,
    pub value: String,
    pub enabled: bool,
    pub weight: u32,
}

fn validate_query(q: &str) -> Result<(), String> {
    if q.is_empty() || q.len() > 64 {
        return Err("ERR_INVALID_SEARCH_QUERY: Query must be 1–64 characters.".to_string());
    }
    if q.chars().any(|c| c.is_control()) {
        return Err("ERR_INVALID_SEARCH_QUERY: Query contains invalid characters.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_queries() -> Result<Vec<QuerySummary>, String> {
    let settings = load_settings()?;
    let queries = settings
        .getter_targets
        .iter()
        .filter(|t| t.kind == "search")
        .map(|t| QuerySummary {
            id: t.id.clone(),
            value: t.value.clone(),
            enabled: t.enabled,
            weight: t.weight,
        })
        .collect();
    Ok(queries)
}

#[tauri::command]
pub async fn add_query(query: String) -> Result<QuerySummary, String> {
    let query = query.trim().to_string();
    validate_query(&query)?;

    let mut settings = load_settings()?;

    if settings
        .getter_targets
        .iter()
        .any(|t| t.kind == "search" && t.value.to_lowercase() == query.to_lowercase())
    {
        return Err(format!("Query \"{}\" already exists.", query));
    }

    // Probe: make sure this query actually returns photos
    let client = crate::unsplash::get_client()?;
    match client.get_random_photo(&[("query", query.as_str())]).await {
        Ok(_) => {}
        Err(e) if e.contains("404") => {
            return Err(format!(
                "Hmm, \"{}\" doesn't seem to bring back any photos. Try something a little more Unsplash-friendly — like \"mountains\" or \"neon city\" 🙃",
                query
            ));
        }
        Err(_) => {} // transient — allow through
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("search_{}", ts);

    settings.getter_targets.push(GetterTarget {
        id: id.clone(),
        kind: "search".to_string(),
        value: query.clone(),
        enabled: true,
        weight: 1,
    });
    add_target_to_all_groups(&mut settings, &id);
    save_settings(&settings)?;
    if crate::wallpaper::should_reprefetch_on_enable() {
        crate::scheduler::notify_reprefetch();
    }

    Ok(QuerySummary { id, value: query, enabled: true, weight: 1 })
}

#[tauri::command]
pub async fn delete_query(id: String) -> Result<(), String> {
    let mut settings = load_settings()?;
    remove_target_from_all_groups(&mut settings, &id);
    settings.getter_targets.retain(|t| !(t.kind == "search" && t.id == id));
    save_settings(&settings)
}

#[tauri::command]
pub async fn toggle_query(id: String, enabled: bool) -> Result<(), String> {
    let mut settings = load_settings()?;
    let query_value = settings
        .getter_targets
        .iter()
        .find(|t| t.kind == "search" && t.id == id)
        .map(|t| t.value.clone());
    if let Some(target) = settings
        .getter_targets
        .iter_mut()
        .find(|t| t.kind == "search" && t.id == id)
    {
        target.enabled = enabled;
    }
    save_settings(&settings)?;

    if !enabled {
        if let Some(value) = query_value {
            if crate::wallpaper::invalidate_next_if_from_source("search", &value) {
                crate::scheduler::notify_reprefetch();
            }
        }
    } else if crate::wallpaper::should_reprefetch_on_enable() {
        crate::scheduler::notify_reprefetch();
    }

    Ok(())
}
