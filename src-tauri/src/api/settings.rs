use crate::scheduler::notify_cron_changed;
use crate::settings::{load_settings, save_settings};
use chrono::Utc;
use cron::Schedule;
use serde::Serialize;
use std::str::FromStr;

#[derive(Debug, Serialize)]
pub struct AppSettings {
    pub quality: String,
    pub orientation: String,
    pub wallpaper_cron: String,
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, String> {
    let s = load_settings()?;
    Ok(AppSettings {
        quality: s.quality,
        orientation: s.orientation,
        wallpaper_cron: s.wallpaper_cron,
        api_key: s.api_key,
    })
}

#[tauri::command]
pub async fn get_api_key() -> Result<Option<String>, String> {
    let s = load_settings()?;
    Ok(s.api_key)
}

/// Validate the key against the Unsplash API, then save it to settings.
#[tauri::command]
pub async fn verify_and_save_api_key(key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("API key cannot be empty.".to_string());
    }

    // Probe with a cheap public endpoint
    let resp = reqwest::Client::new()
        .get("https://api.unsplash.com/photos")
        .query(&[("per_page", "1")])
        .header("Authorization", format!("Client-ID {}", key))
        .send()
        .await
        .map_err(|e| format!("ERR_NETWORK: {}", e))?;

    match resp.status().as_u16() {
        200 => {}
        401 => return Err("Invalid API key. Please check and try again.".to_string()),
        403 => return Err("API key forbidden. You may have exceeded your rate limit.".to_string()),
        s => return Err(format!("Unexpected response from Unsplash: HTTP {}", s)),
    }

    let mut settings = load_settings()?;
    settings.api_key = Some(key);
    save_settings(&settings)
}

#[tauri::command]
pub async fn update_settings(
    quality: String,
    orientation: String,
    wallpaper_cron: String,
) -> Result<(), String> {
    let valid_qualities = ["raw", "full", "regular", "small", "thumb"];
    if !valid_qualities.contains(&quality.as_str()) {
        return Err(format!("Invalid quality: {}", quality));
    }
    let valid_orientations = ["landscape", "portrait", "squarish"];
    if !valid_orientations.contains(&orientation.as_str()) {
        return Err(format!("Invalid orientation: {}", orientation));
    }
    validate_cron(&wallpaper_cron)?;

    let mut s = load_settings()?;
    s.quality = quality;
    s.orientation = orientation;
    s.wallpaper_cron = wallpaper_cron.clone();
    save_settings(&s)?;

    notify_cron_changed(wallpaper_cron);
    Ok(())
}

pub fn validate_cron(expr: &str) -> Result<(), String> {
    if expr == "@startup" || expr.is_empty() {
        return Ok(());
    }
    let six_field = format!("0 {}", expr.trim());
    let schedule = Schedule::from_str(&six_field)
        .map_err(|e| format!("Invalid cron expression \"{}\": {}", expr, e))?;

    // Enforce minimum 30-minute interval by checking the actual gap between
    // the first two upcoming occurrences.
    let mut upcoming = schedule.upcoming(Utc);
    if let (Some(first), Some(second)) = (upcoming.next(), upcoming.next()) {
        let gap_mins = (second - first).num_minutes();
        if gap_mins < 30 {
            return Err(format!(
                "Minimum allowed interval is 30 minutes. \
                 This expression fires every ~{} minute(s).",
                gap_mins
            ));
        }
    }

    Ok(())
}
