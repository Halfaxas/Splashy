use std::path::Path;
use crate::fs::{dirs, files};

/// Remove a collection completely (folder + previews + meta)
pub fn remove_collection(collection_id: &str) -> Result<(), String> {
    let path = crate::fs::paths::collections_dir()?.join(collection_id);
    dirs::remove_dir(&path)
}

/// Remove a user completely (profile + avatar + previews)
pub fn remove_user(username: &str) -> Result<(), String> {
    let path = crate::fs::paths::users_dir()?.join(username);
    dirs::remove_dir(&path)
}

/// Clear current wallpaper (unless saved)
pub fn clear_current_wallpaper() -> Result<(), String> {
    let dir = crate::fs::paths::current_dir()?;
    files::delete_file(&dir.join("current_wallpaper.jpg"))?;
    files::delete_file(&dir.join("current_wallpaper_meta.json"))?;
    Ok(())
}

/// Delete a saved wallpaper by id
pub fn remove_saved(photo_id: &str) -> Result<(), String> {
    let dir = crate::fs::paths::saved_dir()?;
    files::delete_file(&dir.join(format!("saved_{}.jpg", photo_id)))?;
    files::delete_file(&dir.join(format!("saved_{}.json", photo_id)))?;
    Ok(())
}
