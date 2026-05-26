use crate::fs::{dirs, files, paths};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetterTarget {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // "collection" | "user" | "topic" | "related"
    pub value: String,
    pub enabled: bool,
    pub weight: u32,
}

/// One of the 4 predefined time-of-day groups.
/// `start_hour` is inclusive, `end_hour` is exclusive (both 0-23).
/// When `start_hour > end_hour` the range wraps around midnight (e.g. night: 22-06).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeGroup {
    pub id: String,
    pub label: String,
    pub start_hour: u32,
    pub end_hour: u32,
    /// IDs of GetterTargets that should fire during this group.
    pub target_ids: Vec<String>,
}

fn default_time_groups() -> Vec<TimeGroup> {
    vec![
        TimeGroup { id: "morning".into(),   label: "Morning".into(),   start_hour: 6,  end_hour: 12, target_ids: vec![] },
        TimeGroup { id: "day".into(),       label: "Day".into(),       start_hour: 12, end_hour: 17, target_ids: vec![] },
        TimeGroup { id: "afternoon".into(), label: "Afternoon".into(), start_hour: 17, end_hour: 22, target_ids: vec![] },
        TimeGroup { id: "night".into(),     label: "Night".into(),     start_hour: 22, end_hour: 6,  target_ids: vec![] },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// 5-field cron expression: "min hour dom month dow"
    /// e.g. "0 * * * *" = every hour, "*/30 * * * *" = every 30 minutes
    #[serde(default = "default_wallpaper_cron")]
    pub wallpaper_cron: String,
    #[serde(default = "default_storage_limit")]
    pub storage_limit_mb: u64,
    #[serde(default = "default_orientation")]
    pub orientation: String,
    #[serde(default = "default_quality")]
    pub quality: String,
    #[serde(default)]
    pub getter_targets: Vec<GetterTarget>,
    #[serde(default = "default_time_groups")]
    pub time_groups: Vec<TimeGroup>,
    #[serde(default)]
    pub api_key: Option<String>,
}

fn default_wallpaper_cron() -> String { "0 * * * *".to_string() }
fn default_storage_limit() -> u64 { 500 }
fn default_orientation() -> String { "landscape".to_string() }
fn default_quality() -> String { "regular".to_string() }

impl Default for Settings {
    fn default() -> Self {
        Self {
            wallpaper_cron: default_wallpaper_cron(),
            storage_limit_mb: 500,
            orientation: "landscape".to_string(),
            quality: "regular".to_string(),
            getter_targets: vec![],
            time_groups: default_time_groups(),
            api_key: option_env!("UNSPLASH_ACCESS_KEY").map(|s| s.to_string()),
        }
    }
}

pub fn load_settings() -> Result<Settings, String> {
    let path = paths::settings_file()?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read settings.json: {}", e))?;
    let mut settings: Settings = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Failed to parse settings.json: {}", e))?;

    // One-time migration: if all groups are empty but targets exist, populate all groups.
    if settings.time_groups.iter().all(|g| g.target_ids.is_empty())
        && !settings.getter_targets.is_empty()
    {
        let all_ids: Vec<String> = settings.getter_targets.iter().map(|t| t.id.clone()).collect();
        for group in &mut settings.time_groups {
            group.target_ids = all_ids.clone();
        }
        let _ = save_settings(&settings);
    }

    Ok(settings)
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = paths::settings_file()?;
    if let Some(parent) = path.parent() {
        dirs::ensure_dir(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    files::write_atomic(&path, &bytes)
}

/// Add a target ID to every time group (called when a new source is added).
pub fn add_target_to_all_groups(settings: &mut Settings, target_id: &str) {
    for group in &mut settings.time_groups {
        if !group.target_ids.iter().any(|id| id == target_id) {
            group.target_ids.push(target_id.to_string());
        }
    }
}

/// Remove a target ID from every time group (called when a source is deleted).
pub fn remove_target_from_all_groups(settings: &mut Settings, target_id: &str) {
    for group in &mut settings.time_groups {
        group.target_ids.retain(|id| id != target_id);
    }
}

/// Find which time group the given hour belongs to.
pub fn group_for_hour(time_groups: &[TimeGroup], hour: u32) -> Option<&TimeGroup> {
    time_groups.iter().find(|g| {
        if g.start_hour < g.end_hour {
            hour >= g.start_hour && hour < g.end_hour
        } else {
            // Wraps around midnight (e.g. night 22-06)
            hour >= g.start_hour || hour < g.end_hour
        }
    })
}
