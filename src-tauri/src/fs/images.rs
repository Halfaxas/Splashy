use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::ImageReader;
use std::collections::HashMap;
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

/// Compute a representative dominant colour from an image file, returned as
/// `"#rrggbb"`. The image is downscaled and its pixels are bucketed into a
/// coarse histogram that favours vivid (saturated) tones, so the result reads
/// as an accent colour rather than a muddy average.
pub fn dominant_color_hex(path: &Path) -> Result<String, String> {
    let img = ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to read image format: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    // Downscale for speed; colour fidelity is preserved well enough at 64px.
    let small = img.resize(64, 64, FilterType::Triangle).to_rgb8();

    // Bucket colours into a 4-bit-per-channel histogram, weighting vivid pixels.
    let mut buckets: HashMap<u16, (u64, u64, u64, u64)> = HashMap::new();
    for p in small.pixels() {
        let [r, g, b] = p.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let sat = max as i32 - min as i32;
        // Skip near-black / near-white pixels so the accent stays colourful.
        if max < 25 || min > 235 {
            continue;
        }
        let weight = 1 + (sat as u64) / 16; // vivid pixels count for more
        let key = ((r as u16 >> 4) << 8) | ((g as u16 >> 4) << 4) | (b as u16 >> 4);
        let e = buckets.entry(key).or_insert((0, 0, 0, 0));
        e.0 += r as u64 * weight;
        e.1 += g as u64 * weight;
        e.2 += b as u64 * weight;
        e.3 += weight;
    }

    // Fall back to a flat average for greyscale / very dull images.
    let (r, g, b) = match buckets.values().max_by_key(|v| v.3) {
        Some(&(sr, sg, sb, n)) if n > 0 => ((sr / n) as u8, (sg / n) as u8, (sb / n) as u8),
        _ => average_rgb(&small),
    };

    Ok(format!("#{:02x}{:02x}{:02x}", r, g, b))
}

fn average_rgb(img: &image::RgbImage) -> (u8, u8, u8) {
    let (mut sr, mut sg, mut sb, mut n) = (0u64, 0u64, 0u64, 0u64);
    for p in img.pixels() {
        sr += p.0[0] as u64;
        sg += p.0[1] as u64;
        sb += p.0[2] as u64;
        n += 1;
    }
    if n == 0 {
        return (128, 128, 128);
    }
    ((sr / n) as u8, (sg / n) as u8, (sb / n) as u8)
}
