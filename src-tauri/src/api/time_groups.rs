use crate::settings::{load_settings, save_settings, TimeGroup};

#[tauri::command]
pub async fn get_time_groups() -> Result<Vec<TimeGroup>, String> {
    let settings = load_settings()?;
    Ok(settings.time_groups)
}

/// Set exactly which groups a target belongs to.
/// `group_ids` contains the IDs of groups the target should be IN.
#[tauri::command]
pub async fn set_target_groups(target_id: String, group_ids: Vec<String>) -> Result<(), String> {
    let mut settings = load_settings()?;
    for group in &mut settings.time_groups {
        let should_include = group_ids.contains(&group.id);
        let already_included = group.target_ids.contains(&target_id);
        if should_include && !already_included {
            group.target_ids.push(target_id.clone());
        } else if !should_include && already_included {
            group.target_ids.retain(|id| id != &target_id);
        }
    }
    save_settings(&settings)
}
