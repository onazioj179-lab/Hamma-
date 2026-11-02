//! SPK Compression Codecs
//!
//! Supported codecs:
//! - None (0x00): Pass-through, no compression
//! - Zstd (0x01): Default, excellent ratio/speed balance
//! - Lz4 (0x02): Fast compression for large files
//! - Brotli (0x03): Best ratio for text/JSON (V4 smart codec)

use std::io::{Read, Write};

use crate::utils::error::{SpkError, SpkResult};

/// Compression level for codecs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompressionLevel {
    /// Fastest compression
    Fast,
    /// Balanced (default)
    Normal,
    /// Best compression ratio
    Best,
    /// Custom level (codec-specific)
    Custom(i32),
}

impl Default for CompressionLevel {
    fn default() -> Self {
        Self::Normal
    }
}

impl CompressionLevel {
    /// Get zstd compression level
    pub fn zstd_level(&self) -> i32 {
        match self {
            Self::Fast => 1,
            Self::Normal => 3,
            Self::Best => 19,
            Self::Custom(level) => *level,
        }
    }

    /// Get LZ4 compression level
    pub fn lz4_level(&self) -> u32 {
        match self {
            Self::Fast => 1,
            Self::Normal => 4,
            Self::Best => 12,
            Self::Custom(level) => *level as u32,
        }
    }

    /// Get Brotli quality level
    pub fn brotli_level(&self) -> u32 {
        match self {
            Self::Fast => 1,
            Self::Normal => 6,
            Self::Best => 11,
            Self::Custom(level) => *level as u32,
        }
    }
}

/// Compression profile for tiered resource usage
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CompressionProfile {
    /// Ultra-low resource: LZ4 only, 256KB chunks, no delta/dictionary
    /// For devices with <512MB RAM, 1-2 cores
    UltraLow,
    /// Low resource: LZ4 or ZSTD-1, 512KB chunks, limited features
    /// For devices with 512MB-2GB RAM, 2-4 cores
    Low,
    /// Balanced: ZSTD-3, 1MB chunks, optional delta
    /// For normal workstations
    #[default]
    Balanced,
    /// Maximum: ZSTD-19, 4MB chunks, full delta/dictionary
    /// For high-end systems prioritizing ratio
    Maximum,
}

impl CompressionProfile {
    /// Get codec for this profile
    pub fn codec(&self) -> Codec {
        match self {
            CompressionProfile::UltraLow => Codec::Lz4,
            CompressionProfile::Low => Codec::Lz4,
            CompressionProfile::Balanced => Codec::Zstd,
            CompressionProfile::Maximum => Codec::Zstd,
        }
    }

    /// Get compression level for this profile
    pub fn level(&self) -> CompressionLevel {
        match self {
            CompressionProfile::UltraLow => CompressionLevel::Fast,
            CompressionProfile::Low => CompressionLevel::Fast,
            CompressionProfile::Balanced => CompressionLevel::Custom(3),
            CompressionProfile::Maximum => CompressionLevel::Custom(19),
        }
    }

    /// Get recommended chunk size
    pub fn chunk_size(&self) -> usize {
        match self {
            CompressionProfile::UltraLow => 256 * 1024,      // 256KB
            CompressionProfile::Low => 512 * 1024,           // 512KB
            CompressionProfile::Balanced => 1024 * 1024,     // 1MB
            CompressionProfile::Maximum => 4 * 1024 * 1024,  // 4MB
        }
    }

    /// Check if delta compression is enabled
    pub fn enable_delta(&self) -> bool {
        matches!(self, CompressionProfile::Balanced | CompressionProfile::Maximum)
    }

    /// Check if dictionary compression is enabled
    pub fn enable_dictionary(&self) -> bool {
        matches!(self, CompressionProfile::Maximum)
    }

    /// Get max parallel threads
    pub fn max_threads(&self, available: usize) -> usize {
        match self {
            CompressionProfile::UltraLow => 1,
            CompressionProfile::Low => available.min(2),
            CompressionProfile::Balanced => available.min(4),
            CompressionProfile::Maximum => available.min(8),
        }
    }

    /// Get memory budget in bytes
    pub fn memory_budget(&self) -> usize {
        match self {
            CompressionProfile::UltraLow => 32 * 1024 * 1024,   // 32MB
            CompressionProfile::Low => 128 * 1024 * 1024,      // 128MB
            CompressionProfile::Balanced => 512 * 1024 * 1024, // 512MB
            CompressionProfile::Maximum => 2 * 1024 * 1024 * 1024, // 2GB
        }
    }

    /// Detect best profile for current system
    pub fn detect() -> Self {
        let cpus = num_cpus::get();
        match cpus {
            0..=2 => CompressionProfile::UltraLow,
            3..=4 => CompressionProfile::Low,
            5..=8 => CompressionProfile::Balanced,
            _ => CompressionProfile::Balanced, // Don't auto-select Maximum
        }
    }
}

/// Compression codec identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[repr(u8)]
pub enum Codec {
    /// No compression (pass-through)
    None = 0x00,
    /// Zstd compression (default)
    #[default]
    Zstd = 0x01,
    /// LZ4 compression (fast)
    Lz4 = 0x02,
    /// Brotli compression (best for text)
    Brotli = 0x03,
}

impl Codec {
    /// Convert codec to u8
    pub fn as_u8(&self) -> u8 {
        *self as u8
    }

    /// Parse codec from u8
    pub fn from_u8(value: u8) -> SpkResult<Self> {
        match value {
            0x00 => Ok(Self::None),
            0x01 => Ok(Self::Zstd),
            0x02 => Ok(Self::Lz4),
            0x03 => Ok(Self::Brotli),
            _ => Err(SpkError::InvalidFormat(format!("Unknown codec: 0x{:02X}", value))),
        }
    }

    /// Get codec name
    pub fn name(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Zstd => "zstd",
            Self::Lz4 => "lz4",
            Self::Brotli => "brotli",
        }
    }

    /// Check if this codec actually compresses
    pub fn compresses(&self) -> bool {
        !matches!(self, Self::None)
    }
}

/// Compress data using the specified codec
pub fn compress(data: &[u8], codec: Codec, level: CompressionLevel) -> SpkResult<Vec<u8>> {
    match codec {
        Codec::None => Ok(data.to_vec()),
        Codec::Zstd => compress_zstd(data, level),
        Codec::Lz4 => compress_lz4(data, level),
        Codec::Brotli => compress_brotli(data, level),
    }
}

/// Decompress data using the specified codec
pub fn decompress(data: &[u8], codec: Codec, uncompressed_size: Option<usize>) -> SpkResult<Vec<u8>> {
    match codec {
        Codec::None => Ok(data.to_vec()),
        Codec::Zstd => decompress_zstd(data),
        Codec::Lz4 => decompress_lz4(data, uncompressed_size),
        Codec::Brotli => decompress_brotli(data),
    }
}

/// Compress with zstd
fn compress_zstd(data: &[u8], level: CompressionLevel) -> SpkResult<Vec<u8>> {
    let mut encoder = zstd::Encoder::new(Vec::new(), level.zstd_level())?;
    encoder.write_all(data)?;
    encoder.finish().map_err(SpkError::from)
}

/// Decompress with zstd
fn decompress_zstd(data: &[u8]) -> SpkResult<Vec<u8>> {
    let mut decoder = zstd::Decoder::new(data)?;
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)?;
    Ok(decompressed)
}

/// Compress with LZ4
fn compress_lz4(data: &[u8], _level: CompressionLevel) -> SpkResult<Vec<u8>> {
    // lz4_flex doesn't support compression levels in the simple API
    Ok(lz4_flex::compress_prepend_size(data))
}

/// Decompress with LZ4
fn decompress_lz4(data: &[u8], _uncompressed_size: Option<usize>) -> SpkResult<Vec<u8>> {
    lz4_flex::decompress_size_prepended(data)
        .map_err(|e| SpkError::DecompressionError(format!("LZ4 decompression failed: {}", e)))
}

/// Compress with Brotli
fn compress_brotli(data: &[u8], level: CompressionLevel) -> SpkResult<Vec<u8>> {
    let mut output = Vec::new();
    let mut params = brotli::enc::BrotliEncoderParams::default();
    params.quality = level.brotli_level() as i32;
    
    let mut encoder = brotli::CompressorWriter::with_params(&mut output, 4096, &params);
    encoder.write_all(data)?;
    drop(encoder);
    
    Ok(output)
}

/// Decompress with Brotli
fn decompress_brotli(data: &[u8]) -> SpkResult<Vec<u8>> {
    let mut output = Vec::new();
    let mut decoder = brotli::Decompressor::new(data, 4096);
    decoder.read_to_end(&mut output)?;
    Ok(output)
}

/// Streaming compressor for large data
pub struct StreamingCompressor<W: Write> {
    codec: Codec,
    inner: Box<dyn Write>,
    _marker: std::marker::PhantomData<W>,
}

impl<W: Write + 'static> StreamingCompressor<W> {
    pub fn new(writer: W, codec: Codec, level: CompressionLevel) -> SpkResult<Self> {
        let inner: Box<dyn Write> = match codec {
            Codec::None => Box::new(writer),
            Codec::Zstd => Box::new(zstd::Encoder::new(writer, level.zstd_level())?),
            Codec::Lz4 => {
                // LZ4 streaming is more complex, fall back to buffered
                Box::new(writer)
            }
            Codec::Brotli => {
                let params = brotli::enc::BrotliEncoderParams::default();
                Box::new(brotli::CompressorWriter::with_params(writer, 4096, &params))
            }
        };

        Ok(Self {
            codec,
            inner,
            _marker: std::marker::PhantomData,
        })
    }

    pub fn write_data(&mut self, data: &[u8]) -> SpkResult<()> {
        self.inner.write_all(data)?;
        Ok(())
    }

    pub fn codec(&self) -> Codec {
        self.codec
    }
}

/// Smart codec selection based on content type (V4)
#[derive(Debug, Clone)]
pub struct SmartCodecSelector {
    /// Minimum size to consider compression
    pub min_size: usize,
    /// Sample size for content detection
    pub sample_size: usize,
}

impl Default for SmartCodecSelector {
    fn default() -> Self {
        Self {
            min_size: 1024,
            sample_size: 4096,
        }
    }
}

impl SmartCodecSelector {
    /// Select optimal codec based on content
    pub fn select(&self, data: &[u8], file_extension: Option<&str>) -> CodecSelection {
        // Too small to compress
        if data.len() < self.min_size {
            return CodecSelection {
                codec: Codec::None,
                level: CompressionLevel::Normal,
                reason: "File too small".to_string(),
            };
        }

        // Check extension-based hints
        if let Some(ext) = file_extension {
            match ext.to_lowercase().as_str() {
                // Already compressed formats
                "jpg" | "jpeg" | "png" | "gif" | "webp" | "mp3" | "mp4" | "mkv" |
                "zip" | "gz" | "bz2" | "xz" | "7z" | "rar" => {
                    return CodecSelection {
                        codec: Codec::None,
                        level: CompressionLevel::Normal,
                        reason: "Already compressed format".to_string(),
                    };
                }
                // Text/code - brotli excels
                "txt" | "md" | "json" | "xml" | "html" | "css" | "js" | "ts" |
                "rs" | "py" | "java" | "c" | "cpp" | "h" | "hpp" => {
                    return CodecSelection {
                        codec: Codec::Brotli,
                        level: CompressionLevel::Normal,
                        reason: "Text content - brotli optimal".to_string(),
                    };
                }
                // Binary data - zstd is best
                "exe" | "dll" | "so" | "bin" | "dat" => {
                    return CodecSelection {
                        codec: Codec::Zstd,
                        level: CompressionLevel::Normal,
                        reason: "Binary data - zstd optimal".to_string(),
                    };
                }
                _ => {}
            }
        }

        // Content-based detection using sample
        let sample = &data[..data.len().min(self.sample_size)];
        
        // Check if it looks like text
        let text_ratio = sample.iter()
            .filter(|&&b| b.is_ascii_alphanumeric() || b.is_ascii_whitespace() || b.is_ascii_punctuation())
            .count() as f64 / sample.len() as f64;

        if text_ratio > 0.9 {
            return CodecSelection {
                codec: Codec::Brotli,
                level: CompressionLevel::Normal,
                reason: format!("Detected text content ({:.1}% ASCII)", text_ratio * 100.0),
            };
        }

        // Check entropy (random data doesn't compress well)
        let entropy = calculate_entropy(sample);
        if entropy > 7.9 {
            return CodecSelection {
                codec: Codec::None,
                level: CompressionLevel::Normal,
                reason: format!("High entropy ({:.2}) - likely incompressible", entropy),
            };
        }

        // Default to zstd
        CodecSelection {
            codec: Codec::Zstd,
            level: CompressionLevel::Normal,
            reason: "Default codec".to_string(),
        }
    }
}

/// Result of smart codec selection
#[derive(Debug, Clone)]
pub struct CodecSelection {
    pub codec: Codec,
    pub level: CompressionLevel,
    pub reason: String,
}

/// Calculate Shannon entropy of data (0-8 for bytes)
fn calculate_entropy(data: &[u8]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }

    let mut counts = [0u64; 256];
    for &byte in data {
        counts[byte as usize] += 1;
    }

    let len = data.len() as f64;
    let mut entropy = 0.0;

    for &count in &counts {
        if count > 0 {
            let p = count as f64 / len;
            entropy -= p * p.log2();
        }
    }

    entropy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codec_roundtrip() {
        let data = b"Hello, World! This is test data for compression.";
        
        for codec in [Codec::None, Codec::Zstd, Codec::Lz4, Codec::Brotli] {
            let compressed = compress(data, codec, CompressionLevel::Normal).unwrap();
            let decompressed = decompress(&compressed, codec, Some(data.len())).unwrap();
            assert_eq!(data.as_slice(), decompressed.as_slice(), "Failed for {:?}", codec);
        }
    }

    #[test]
    fn test_compression_actually_compresses() {
        // Highly compressible data
        let data: Vec<u8> = vec![0u8; 10000];
        
        let compressed = compress(&data, Codec::Zstd, CompressionLevel::Normal).unwrap();
        assert!(compressed.len() < data.len());
    }

    #[test]
    fn test_codec_conversion() {
        assert_eq!(Codec::from_u8(0x00).unwrap(), Codec::None);
        assert_eq!(Codec::from_u8(0x01).unwrap(), Codec::Zstd);
        assert_eq!(Codec::from_u8(0x02).unwrap(), Codec::Lz4);
        assert_eq!(Codec::from_u8(0x03).unwrap(), Codec::Brotli);
        assert!(Codec::from_u8(0xFF).is_err());
    }

    #[test]
    fn test_smart_codec_selector() {
        let selector = SmartCodecSelector::default();
        
        // Small file
        let small = vec![0u8; 100];
        assert_eq!(selector.select(&small, None).codec, Codec::None);
        
        // Text file
        let text = b"This is a text file with lots of repeated words and content that should compress well with brotli.".repeat(100);
        let selection = selector.select(&text, Some("txt"));
        assert_eq!(selection.codec, Codec::Brotli);
        
        // Already compressed
        let jpg = vec![0xFFu8, 0xD8, 0xFF]; // JPG magic
        let selection = selector.select(&jpg, Some("jpg"));
        assert_eq!(selection.codec, Codec::None);
    }

    #[test]
    fn test_entropy() {
        // All zeros - minimum entropy
        let zeros = vec![0u8; 1000];
        assert!(calculate_entropy(&zeros) < 0.01);
        
        // Random-ish data - high entropy
        let random: Vec<u8> = (0..1000).map(|i| (i * 17 + i / 3) as u8).collect();
        assert!(calculate_entropy(&random) > 5.0);
    }
}
