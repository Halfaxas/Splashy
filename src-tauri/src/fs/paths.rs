use std::path::PathBuf;

/// %PICTURE_DIR%/unsplash-wallpapers
pub fn root_dir() -> Result<PathBuf, String> {
    let pictures = dirs::picture_dir()
        .ok_or("Could not locate Pictures directory")?;
    Ok(pictures.join("unsplash-wallpapers"))
}

pub fn collections_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("collections"))
}

pub fn users_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("users"))
}

pub fn topics_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("topics"))
}

pub fn current_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("current"))
}

pub fn saved_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("saved"))
}

pub fn logs_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("logs"))
}

pub fn settings_file() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("settings.json"))
}

pub fn related_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("related"))
}
