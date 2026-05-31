use crate::settings::{load_settings, save_settings};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ToggleChange {
    pub kind: String,
    pub id: String,
    pub enabled: bool,
}

/// Apply multiple source toggles in one go, then check once whether a re-prefetch is needed.
#[tauri::command]
pub async fn batch_toggle_sources(changes: Vec<ToggleChange>) -> Result<(), String> {
    if changes.is_empty() {
        return Ok(());
    }

    log::info!(
        "[batch] batch_toggle_sources: {} changes",
        changes.len()
    );

    let mut settings = load_settings()?;
    let mut needs_reprefetch = false;

    for change in &changes {
        let (find_kind, find_field) = match change.kind.as_str() {
            "collection" => ("collection", FindBy::Value),
            "user" => ("user", FindBy::Value),
            "topic" => ("topic", FindBy::Value),
            "query" => ("search", FindBy::Id),
            "color" => ("color", FindBy::Value),
            "related" => ("related", FindBy::Value),
            _ => continue,
        };

        let target = match find_field {
            FindBy::Value => settings
                .getter_targets
                .iter_mut()
                .find(|t| t.kind == find_kind && t.value == change.id),
            FindBy::Id => settings
                .getter_targets
                .iter_mut()
                .find(|t| t.kind == find_kind && t.id == change.id),
        };

        if let Some(t) = target {
            t.enabled = change.enabled;

            if !change.enabled {
                // For queries, the source_value used in wallpaper meta is the query text (t.value)
                let source_value = t.value.clone();
                let source_type = if find_kind == "search" { "search" } else { find_kind };
                if crate::wallpaper::invalidate_next_if_from_source(source_type, &source_value) {
                    needs_reprefetch = true;
                }
            }
        }
    }

    save_settings(&settings)?;

    // Check if enabling any source warrants a reprefetch (only need to check once)
    let any_enabled = changes.iter().any(|c| c.enabled);
    if !needs_reprefetch && any_enabled && crate::wallpaper::should_reprefetch_on_enable() {
        needs_reprefetch = true;
    }

    if needs_reprefetch {
        crate::scheduler::notify_reprefetch();
    }

    Ok(())
}

#[derive(Clone, Copy)]
enum FindBy {
    Value,
    Id,
}
