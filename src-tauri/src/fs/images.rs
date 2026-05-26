use image::codecs::jpeg::JpegEncoder;
use image::ImageReader;
use std::io::{BufWriter, Cursor};
use std::path::Path;

/// Decode image bytes and save as JPEG at quality 85, atomically.
pub fn save_as_jpeg_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let img = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("Failed to read image format: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let tmp = path.with_extension("tmp");
    let file = std::fs::File::create(&tmp)
        .map_err(|e| format!("Failed to create tmp file: {}", e))?;
    let mut writer = BufWriter::new(file);
    let encoder = JpegEncoder::new_with_quality(&mut writer, 85);
    img.write_with_encoder(encoder)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
    drop(writer);

    std::fs::rename(&tmp, path)
        .map_err(|e| format!("Failed to rename tmp to final: {}", e))?;

    Ok(())
}
