use crate::fs::paths;
use crate::unsplash::{AdjacentWallpapers, CurrentWallpaperInfo, WallpaperMeta};
use crate::wallpaper::{change_wallpaper, prefetch_next_wallpaper, read_meta};
use tauri::Emitter;

#[tauri::command]
pub async fn refresh_wallpaper(app: tauri::AppHandle) -> Result<String, String> {
    let result = change_wallpaper().await?;
    let _ = app.emit("wallpaper-changed", ());

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("[wallpaper] Prefetching next wallpaper");
        match prefetch_next_wallpaper().await {
            Ok(()) => {
                log::info!("[wallpaper] Next wallpaper ready");
                let _ = app2.emit("next-wallpaper-ready", ());
            }
            Err(e) => log::warn!("[wallpaper] Prefetch failed: {}", e),
        }
    });

    Ok(result)
}

#[tauri::command]
pub async fn get_current_wallpaper() -> Result<Option<CurrentWallpaperInfo>, String> {
    let current_dir = paths::current_dir()?;
    let wallpaper_path = current_dir.join("current_wallpaper.jpg");
    let meta_path = current_dir.join("current_wallpaper_meta.json");

    if !wallpaper_path.exists() || !meta_path.exists() {
        return Ok(None);
    }

    let bytes = std::fs::read(&meta_path)
        .map_err(|e| format!("Failed to read wallpaper meta: {}", e))?;
    let meta: WallpaperMeta = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Failed to parse wallpaper meta: {}", e))?;

    let path_str = wallpaper_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize wallpaper path: {}", e))?
        .to_string_lossy()
        .to_string();
    let path_str = path_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&path_str)
        .to_string();

    Ok(Some(CurrentWallpaperInfo {
        path: path_str,
        author_name: meta.author_name,
        author_username: meta.author_username,
        unsplash_url: meta.unsplash_url,
        photo_id: meta.photo_id,
    }))
}

#[tauri::command]
pub async fn get_adjacent_wallpapers() -> Result<AdjacentWallpapers, String> {
    let current_dir = paths::current_dir()?;
    Ok(AdjacentWallpapers {
        previous: wallpaper_info_from(&current_dir, "previous"),
        next:     wallpaper_info_from(&current_dir, "next"),
    })
}

/// Extract a representative accent colour ("#rrggbb") from the current
/// wallpaper. Uses the colour cached in the meta JSON when available (written
/// at download time) and only decodes the image as a fallback for older
/// wallpapers. Returns `None` when no wallpaper is set yet.
#[tauri::command]
pub async fn get_wallpaper_dominant_color() -> Result<Option<String>, String> {
    let current_dir = paths::current_dir()?;
    let wallpaper_path = current_dir.join("current_wallpaper.jpg");
    if !wallpaper_path.exists() {
        return Ok(None);
    }

    // Fast path: return the colour cached in the meta JSON.
    let meta_path = current_dir.join("current_wallpaper_meta.json");
    if let Some(meta) = read_meta(&meta_path) {
        if let Some(color) = meta.dominant_color {
            return Ok(Some(color));
        }
    }

    // Fallback: decode the image, then backfill the cached colour.
    let path = wallpaper_path.clone();
    let hex = tauri::async_runtime::spawn_blocking(move || {
        crate::fs::images::dominant_color_hex(&path)
    })
    .await
    .map_err(|e| format!("Failed to run colour task: {}", e))??;

    if let Some(mut meta) = read_meta(&meta_path) {
        meta.dominant_color = Some(hex.clone());
        if let Ok(bytes) = serde_json::to_vec_pretty(&meta) {
            let _ = crate::fs::files::write_atomic(&meta_path, &bytes);
        }
    }

    Ok(Some(hex))
}

/// Read a named wallpaper (prefix = "previous" or "next") into `CurrentWallpaperInfo`.
fn wallpaper_info_from(current_dir: &std::path::Path, prefix: &str) -> Option<CurrentWallpaperInfo> {
    let img_path  = current_dir.join(format!("{}_wallpaper.jpg", prefix));
    let meta_path = current_dir.join(format!("{}_wallpaper_meta.json", prefix));
    if !img_path.exists() { return None; }

    let meta = read_meta(&meta_path)?;

    let path_str = img_path.canonicalize().ok()?.to_string_lossy().to_string();
    let path_str = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str).to_string();

    Some(CurrentWallpaperInfo {
        path: path_str,
        author_name: meta.author_name,
        author_username: meta.author_username,
        unsplash_url: meta.unsplash_url,
        photo_id: meta.photo_id,
    })
}

#[tauri::command]
pub async fn save_wallpaper_to_folder(folder: String) -> Result<String, String> {
    let current_dir = paths::current_dir()?;
    let wallpaper_path = current_dir.join("current_wallpaper.jpg");
    let meta_path = current_dir.join("current_wallpaper_meta.json");

    if !wallpaper_path.exists() {
        return Err("No current wallpaper to save".to_string());
    }

    let filename = std::fs::read(&meta_path)
        .ok()
        .and_then(|b| serde_json::from_slice::<WallpaperMeta>(&b).ok())
        .map(|m| format!("unsplash_{}.jpg", m.photo_id))
        .unwrap_or_else(|| "unsplash_wallpaper.jpg".to_string());

    let dest = std::path::Path::new(&folder).join(&filename);
    std::fs::copy(&wallpaper_path, &dest)
        .map_err(|e| format!("Failed to save wallpaper: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}
