use std::fs;
use std::path::Path;

/// Create directory and parents if missing (idempotent)
pub fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create dir {:?}: {}", path, e))
}

/// Delete directory recursively if it exists
pub fn remove_dir(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path)
            .map_err(|e| format!("Failed to remove dir {:?}: {}", path, e))?;
    }
    Ok(())
}

/// Ensure entire base layout exists
pub fn ensure_base_layout() -> Result<(), String> {
    use crate::fs::paths::*;

    ensure_dir(&root_dir()?)?;
    ensure_dir(&collections_dir()?)?;
    ensure_dir(&users_dir()?)?;
    ensure_dir(&topics_dir()?)?;
    ensure_dir(&current_dir()?)?;
    ensure_dir(&saved_dir()?)?;
    ensure_dir(&logs_dir()?)?;

    Ok(())
}
