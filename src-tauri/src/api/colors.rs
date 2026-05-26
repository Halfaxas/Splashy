use crate::settings::{add_target_to_all_groups, load_settings, save_settings, GetterTarget};
use serde::Serialize;

pub const VALID_COLORS: &[&str] = &[
    "black", "white", "yellow", "orange", "red",
    "purple", "magenta", "green", "teal", "blue",
];

#[derive(Debug, Serialize)]
pub struct ColorSource {
    pub color: String,
    pub enabled: bool,
}

#[tauri::command]
pub async fn list_colors() -> Result<Vec<ColorSource>, String> {
    let settings = load_settings()?;
    let result = VALID_COLORS
        .iter()
        .map(|&c| {
            let enabled = settings
                .getter_targets
                .iter()
                .any(|t| t.kind == "color" && t.value == c && t.enabled);
            ColorSource { color: c.to_string(), enabled }
        })
        .collect();
    Ok(result)
}

#[tauri::command]
pub async fn toggle_color(color: String, enabled: bool) -> Result<(), String> {
    if !VALID_COLORS.contains(&color.as_str()) {
        return Err(format!("ERR_INVALID_COLOR: \"{}\" is not a supported color.", color));
    }
    log::info!("[colors] toggle_color: color={} enabled={}", color, enabled);
    let mut settings = load_settings()?;

    if let Some(target) = settings
        .getter_targets
        .iter_mut()
        .find(|t| t.kind == "color" && t.value == color)
    {
        target.enabled = enabled;
    } else if enabled {
        let target_id = format!("color_{}", color);
        settings.getter_targets.push(GetterTarget {
            id: target_id.clone(),
            kind: "color".to_string(),
            value: color.clone(),
            enabled: true,
            weight: 1,
        });
        add_target_to_all_groups(&mut settings, &target_id);
    }

    save_settings(&settings)?;

    if !enabled && crate::wallpaper::invalidate_next_if_from_source("color", &color) {
        crate::scheduler::notify_reprefetch();
    } else if enabled && crate::wallpaper::should_reprefetch_on_enable() {
        crate::scheduler::notify_reprefetch();
    }

    Ok(())
}
