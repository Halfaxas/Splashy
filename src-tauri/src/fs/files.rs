use std::fs;
use std::io::Write;
use std::path::Path;

/// Atomic write: write to *.tmp then rename
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");

    {
        let mut file = fs::File::create(&tmp)
            .map_err(|e| format!("Create tmp file {:?}: {}", tmp, e))?;
        file.write_all(bytes)
            .map_err(|e| format!("Write tmp file {:?}: {}", tmp, e))?;
        file.sync_all()
            .map_err(|e| format!("Sync tmp file {:?}: {}", tmp, e))?;
    }

    fs::rename(&tmp, path)
        .map_err(|e| format!("Rename {:?} → {:?}: {}", tmp, path, e))?;

    Ok(())
}

/// Delete file if it exists
pub fn delete_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("Failed to delete file {:?}: {}", path, e))?;
    }
    Ok(())
}

/// Copy file atomically
pub fn copy_atomic(src: &Path, dst: &Path) -> Result<(), String> {
    let tmp = dst.with_extension("tmp");

    fs::copy(src, &tmp)
        .map_err(|e| format!("Copy {:?} → {:?}: {}", src, tmp, e))?;

    fs::rename(&tmp, dst)
        .map_err(|e| format!("Rename {:?} → {:?}: {}", tmp, dst, e))?;

    Ok(())
}
