//! Mobile FFI Bridge for SPK Core (V23)
//!
//! Provides a C-compatible FFI interface for mobile apps (iOS + Android).
//! Designed to be called from Flutter, React Native, or Kotlin Multiplatform.
//!
//! Features:
//! - Simple compress/decompress operations
//! - Progress callbacks
//! - Energy-aware processing
//! - Mobile-optimized settings

use crate::utils::error::{SpkError, SpkResult};
use crate::realtime_media::MOBILE_CHUNK_SIZE;
use std::ffi::CStr;
use std::os::raw::{c_char, c_void};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

// ============================================================================
// CONSTANTS
// ============================================================================

/// Mobile FFI version
pub const MOBILE_FFI_VERSION: u32 = 1;

/// Minimum battery level for GPU usage (percentage)
pub const MIN_BATTERY_FOR_GPU: u32 = 20;

/// Minimum battery level before throttling
pub const MIN_BATTERY_BEFORE_THROTTLE: u32 = 10;

/// Mobile chunk size for low-memory devices
pub const MOBILE_LOW_MEM_CHUNK_SIZE: usize = 128 * 1024;

// ============================================================================
// STATUS CODES
// ============================================================================

/// FFI result codes
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MobileResult {
    /// Success
    Success = 0,
    /// Invalid input path
    InvalidInputPath = 1,
    /// Invalid output path
    InvalidOutputPath = 2,
    /// Compression failed
    CompressionFailed = 3,
    /// Decompression failed
    DecompressionFailed = 4,
    /// File not found
    FileNotFound = 5,
    /// Permission denied
    PermissionDenied = 6,
    /// Out of memory
    OutOfMemory = 7,
    /// Operation cancelled
    Cancelled = 8,
    /// Low battery
    LowBattery = 9,
    /// Device sleeping
    DeviceSleeping = 10,
    /// Unknown error
    UnknownError = 99,
}

// ============================================================================
// PROGRESS CALLBACK
// ============================================================================

/// Progress information for callbacks
#[repr(C)]
#[derive(Debug, Clone)]
pub struct MobileProgress {
    /// Total bytes to process
    pub total_bytes: u64,
    /// Bytes processed so far
    pub processed_bytes: u64,
    /// Current speed in bytes per second
    pub speed_bps: u64,
    /// Chunks completed
    pub chunks_completed: u32,
    /// Total chunks
    pub total_chunks: u32,
    /// Estimated time remaining in seconds
    pub eta_seconds: u32,
    /// Compression ratio (compressed/original)
    pub compression_ratio: f32,
    /// Is operation complete
    pub is_complete: bool,
}

impl Default for MobileProgress {
    fn default() -> Self {
        Self {
            total_bytes: 0,
            processed_bytes: 0,
            speed_bps: 0,
            chunks_completed: 0,
            total_chunks: 0,
            eta_seconds: 0,
            compression_ratio: 1.0,
            is_complete: false,
        }
    }
}

/// Progress callback function type
pub type ProgressCallback = extern "C" fn(*const MobileProgress, *mut c_void);

// ============================================================================
// MOBILE CONFIGURATION
// ============================================================================

/// Mobile-specific configuration
#[repr(C)]
#[derive(Debug, Clone)]
pub struct MobileConfig {
    /// Chunk size (0 = auto)
    pub chunk_size: u32,
    /// Number of threads (0 = auto)
    pub num_threads: u32,
    /// Use GPU acceleration
    pub use_gpu: bool,
    /// Energy-aware mode
    pub energy_aware: bool,
    /// Current battery percentage
    pub battery_percent: u32,
    /// Is device charging
    pub is_charging: bool,
    /// Low memory mode
    pub low_memory_mode: bool,
    /// Verify after compression
    pub verify_output: bool,
    /// Allow resume on interruption
    pub allow_resume: bool,
}

impl Default for MobileConfig {
    fn default() -> Self {
        Self {
            chunk_size: 0,
            num_threads: 0,
            use_gpu: false,
            energy_aware: true,
            battery_percent: 100,
            is_charging: false,
            low_memory_mode: false,
            verify_output: true,
            allow_resume: true,
        }
    }
}

impl MobileConfig {
    /// Get effective chunk size based on device state
    pub fn effective_chunk_size(&self) -> usize {
        if self.chunk_size > 0 {
            return self.chunk_size as usize;
        }

        if self.low_memory_mode {
            MOBILE_LOW_MEM_CHUNK_SIZE
        } else {
            MOBILE_CHUNK_SIZE
        }
    }

    /// Get effective thread count
    pub fn effective_threads(&self) -> usize {
        if self.num_threads > 0 {
            return self.num_threads as usize;
        }

        let cpu_count = num_cpus::get();
        
        if self.energy_aware && !self.is_charging && self.battery_percent < 50 {
            // Conserve energy with fewer threads
            (cpu_count / 2).max(1)
        } else {
            cpu_count.max(2)
        }
    }

    /// Check if GPU should be used
    pub fn should_use_gpu(&self) -> bool {
        if !self.use_gpu {
            return false;
        }

        if self.energy_aware {
            // Only use GPU when charging or battery is good
            self.is_charging || self.battery_percent >= MIN_BATTERY_FOR_GPU
        } else {
            true
        }
    }

    /// Check if we should throttle due to low battery
    pub fn should_throttle(&self) -> bool {
        self.energy_aware && !self.is_charging && self.battery_percent < MIN_BATTERY_BEFORE_THROTTLE
    }
}

// ============================================================================
// ARCHIVE INFO
// ============================================================================

/// Information about an SPK archive
#[repr(C)]
#[derive(Debug, Clone)]
pub struct ArchiveInfo {
    /// Total size of archive
    pub archive_size: u64,
    /// Original uncompressed size
    pub original_size: u64,
    /// Number of files in archive
    pub file_count: u32,
    /// Compression ratio
    pub compression_ratio: f32,
    /// Is archive encrypted
    pub is_encrypted: bool,
    /// SPK version
    pub spk_version: u16,
}

impl Default for ArchiveInfo {
    fn default() -> Self {
        Self {
            archive_size: 0,
            original_size: 0,
            file_count: 0,
            compression_ratio: 1.0,
            is_encrypted: false,
            spk_version: 1,
        }
    }
}

// ============================================================================
// MOBILE COMPRESSOR
// ============================================================================

/// Mobile compressor with progress tracking
pub struct MobileCompressor {
    config: MobileConfig,
    progress: Arc<std::sync::RwLock<MobileProgress>>,
    cancelled: Arc<AtomicBool>,
    bytes_written: Arc<AtomicU64>,
}

impl MobileCompressor {
    pub fn new(config: MobileConfig) -> Self {
        Self {
            config,
            progress: Arc::new(std::sync::RwLock::new(MobileProgress::default())),
            cancelled: Arc::new(AtomicBool::new(false)),
            bytes_written: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Cancel the current operation
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// Check if operation is cancelled
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Get current progress
    pub fn get_progress(&self) -> MobileProgress {
        self.progress.read()
            .map(|p| p.clone())
            .unwrap_or_default()
    }

    /// Compress a file
    pub fn compress_file(&self, input: &Path, output: &Path) -> SpkResult<MobileResult> {
        // Check battery throttle
        if self.config.should_throttle() {
            return Ok(MobileResult::LowBattery);
        }

        // Check if input exists
        if !input.exists() {
            return Ok(MobileResult::FileNotFound);
        }

        // Get input size
        let input_size = std::fs::metadata(input)
            .map_err(|e| SpkError::Io(e))?
            .len();

        // Initialize progress
        {
            let mut progress = self.progress.write()
                .map_err(|e| SpkError::CompressionError(format!("Lock error: {}", e)))?;
            progress.total_bytes = input_size;
            progress.processed_bytes = 0;
            progress.total_chunks = (input_size as usize / self.config.effective_chunk_size() + 1) as u32;
        }

        // Open input file
        let input_file = std::fs::File::open(input)
            .map_err(|e| SpkError::Io(e))?;

        // Create output file
        let output_file = std::fs::File::create(output)
            .map_err(|e| SpkError::Io(e))?;

        // Perform compression
        let result = self.compress_stream(input_file, output_file, input_size)?;

        // Mark complete
        {
            let mut progress = self.progress.write()
                .map_err(|e| SpkError::CompressionError(format!("Lock error: {}", e)))?;
            progress.is_complete = true;
        }

        Ok(result)
    }

    /// Compress from a stream
    fn compress_stream(
        &self,
        mut input: std::fs::File,
        mut output: std::fs::File,
        total_size: u64,
    ) -> SpkResult<MobileResult> {
        use std::io::{Read, Write};
        use std::time::Instant;

        let chunk_size = self.config.effective_chunk_size();
        let start_time = Instant::now();
        let mut buffer = vec![0u8; chunk_size];
        let mut chunks_processed = 0u32;
        let mut total_compressed = 0u64;

        // Write SPK header (simplified for mobile)
        let header = create_mobile_header(total_size);
        output.write_all(&header)
            .map_err(|e| SpkError::Io(e))?;

        loop {
            // Check cancellation
            if self.is_cancelled() {
                return Ok(MobileResult::Cancelled);
            }

            // Check battery (periodic check)
            if chunks_processed % 10 == 0 && self.config.should_throttle() {
                return Ok(MobileResult::LowBattery);
            }

            // Read chunk
            let bytes_read = input.read(&mut buffer)
                .map_err(|e| SpkError::Io(e))?;

            if bytes_read == 0 {
                break;
            }

            // Compress chunk
            let compressed = self.compress_chunk(&buffer[..bytes_read])?;
            
            // Write chunk header + data
            let chunk_header = create_chunk_header(bytes_read as u32, compressed.len() as u32);
            output.write_all(&chunk_header)
                .map_err(|e| SpkError::Io(e))?;
            output.write_all(&compressed)
                .map_err(|e| SpkError::Io(e))?;

            chunks_processed += 1;
            total_compressed += compressed.len() as u64;

            // Update progress
            let processed = self.bytes_written.fetch_add(bytes_read as u64, Ordering::SeqCst) + bytes_read as u64;
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 { (processed as f64 / elapsed) as u64 } else { 0 };
            let eta = if speed > 0 { ((total_size - processed) / speed) as u32 } else { 0 };

            {
                let mut progress = self.progress.write()
                    .map_err(|e| SpkError::CompressionError(format!("Lock error: {}", e)))?;
                progress.processed_bytes = processed;
                progress.speed_bps = speed;
                progress.chunks_completed = chunks_processed;
                progress.eta_seconds = eta;
                progress.compression_ratio = if processed > 0 {
                    total_compressed as f32 / processed as f32
                } else {
                    1.0
                };
            }
        }

        Ok(MobileResult::Success)
    }

    /// Compress a single chunk
    fn compress_chunk(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        // Use ZSTD level 1 for fast mobile compression
        zstd::encode_all(std::io::Cursor::new(data), 1)
            .map_err(|e| SpkError::CompressionError(format!("ZSTD error: {}", e)))
    }
}

/// Mobile decompressor with progress tracking
pub struct MobileDecompressor {
    config: MobileConfig,
    progress: Arc<std::sync::RwLock<MobileProgress>>,
    cancelled: Arc<AtomicBool>,
}

impl MobileDecompressor {
    pub fn new(config: MobileConfig) -> Self {
        Self {
            config,
            progress: Arc::new(std::sync::RwLock::new(MobileProgress::default())),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Cancel the current operation
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// Check if operation is cancelled
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Get current progress
    pub fn get_progress(&self) -> MobileProgress {
        self.progress.read()
            .map(|p| p.clone())
            .unwrap_or_default()
    }

    /// Get archive info without full decompression
    pub fn get_archive_info(&self, archive_path: &Path) -> SpkResult<ArchiveInfo> {
        use std::io::Read;

        let mut file = std::fs::File::open(archive_path)
            .map_err(|e| SpkError::Io(e))?;

        // Read header
        let mut header = [0u8; 64];
        file.read_exact(&mut header)
            .map_err(|e| SpkError::Io(e))?;

        // Parse header (simplified)
        let archive_size = std::fs::metadata(archive_path)
            .map_err(|e| SpkError::Io(e))?
            .len();

        let original_size = u64::from_le_bytes([
            header[8], header[9], header[10], header[11],
            header[12], header[13], header[14], header[15],
        ]);

        let file_count = u32::from_le_bytes([
            header[16], header[17], header[18], header[19],
        ]);

        Ok(ArchiveInfo {
            archive_size,
            original_size,
            file_count,
            compression_ratio: if original_size > 0 {
                archive_size as f32 / original_size as f32
            } else {
                1.0
            },
            is_encrypted: header[20] != 0,
            spk_version: u16::from_le_bytes([header[4], header[5]]),
        })
    }

    /// Decompress an archive
    pub fn decompress(&self, archive_path: &Path, output_path: &Path) -> SpkResult<MobileResult> {
        use std::io::{Read, Write};
        use std::time::Instant;

        // Check battery throttle
        if self.config.should_throttle() {
            return Ok(MobileResult::LowBattery);
        }

        let mut archive = std::fs::File::open(archive_path)
            .map_err(|e| SpkError::Io(e))?;

        let archive_size = std::fs::metadata(archive_path)
            .map_err(|e| SpkError::Io(e))?
            .len();

        // Read and skip header
        let mut header = [0u8; 64];
        archive.read_exact(&mut header)
            .map_err(|e| SpkError::Io(e))?;

        let mut output = std::fs::File::create(output_path)
            .map_err(|e| SpkError::Io(e))?;

        let start_time = Instant::now();
        let mut bytes_read = 64u64;
        let mut chunks_processed = 0u32;

        // Initialize progress
        {
            let mut progress = self.progress.write()
                .map_err(|e| SpkError::CompressionError(format!("Lock error: {}", e)))?;
            progress.total_bytes = archive_size;
            progress.processed_bytes = 64;
        }

        // Read chunks
        loop {
            if self.is_cancelled() {
                return Ok(MobileResult::Cancelled);
            }

            // Read chunk header (8 bytes: original_size, compressed_size)
            let mut chunk_header = [0u8; 8];
            match archive.read_exact(&mut chunk_header) {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(SpkError::Io(e)),
            }

            let original_size = u32::from_le_bytes([
                chunk_header[0], chunk_header[1], chunk_header[2], chunk_header[3],
            ]) as usize;
            let compressed_size = u32::from_le_bytes([
                chunk_header[4], chunk_header[5], chunk_header[6], chunk_header[7],
            ]) as usize;

            if compressed_size == 0 {
                break;
            }

            // Read compressed data
            let mut compressed = vec![0u8; compressed_size];
            archive.read_exact(&mut compressed)
                .map_err(|e| SpkError::Io(e))?;

            // Decompress
            let decompressed = self.decompress_chunk(&compressed, original_size)?;

            // Write output
            output.write_all(&decompressed)
                .map_err(|e| SpkError::Io(e))?;

            bytes_read += 8 + compressed_size as u64;
            chunks_processed += 1;

            // Update progress
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 { (bytes_read as f64 / elapsed) as u64 } else { 0 };
            let eta = if speed > 0 { ((archive_size - bytes_read) / speed) as u32 } else { 0 };

            {
                let mut progress = self.progress.write()
                    .map_err(|e| SpkError::CompressionError(format!("Lock error: {}", e)))?;
                progress.processed_bytes = bytes_read;
                progress.speed_bps = speed;
                progress.chunks_completed = chunks_processed;
                progress.eta_seconds = eta;
            }
        }

        // Mark complete
        {
            let mut progress = self.progress.write()
                .map_err(|e| SpkError::CompressionError(format!("Lock error: {}", e)))?;
            progress.is_complete = true;
        }

        Ok(MobileResult::Success)
    }

    /// Decompress a single chunk
    fn decompress_chunk(&self, compressed: &[u8], _original_size: usize) -> SpkResult<Vec<u8>> {
        zstd::decode_all(std::io::Cursor::new(compressed))
            .map_err(|e| SpkError::DecompressionError(format!("ZSTD error: {}", e)))
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Create a simplified mobile header
fn create_mobile_header(original_size: u64) -> Vec<u8> {
    let mut header = vec![0u8; 64];
    
    // Magic bytes "SPK1"
    header[0..4].copy_from_slice(b"SPK1");
    
    // Version
    header[4..6].copy_from_slice(&1u16.to_le_bytes());
    
    // Flags
    header[6..8].copy_from_slice(&0u16.to_le_bytes());
    
    // Original size
    header[8..16].copy_from_slice(&original_size.to_le_bytes());
    
    header
}

/// Create a chunk header
fn create_chunk_header(original_size: u32, compressed_size: u32) -> Vec<u8> {
    let mut header = vec![0u8; 8];
    header[0..4].copy_from_slice(&original_size.to_le_bytes());
    header[4..8].copy_from_slice(&compressed_size.to_le_bytes());
    header
}

// ============================================================================
// C FFI EXPORTS
// ============================================================================

/// Get FFI version
#[no_mangle]
pub extern "C" fn spk_mobile_version() -> u32 {
    MOBILE_FFI_VERSION
}

/// Create default mobile config
#[no_mangle]
pub extern "C" fn spk_mobile_config_default() -> MobileConfig {
    MobileConfig::default()
}

/// Compress a file (synchronous)
#[no_mangle]
pub extern "C" fn spk_mobile_compress(
    input_path: *const c_char,
    output_path: *const c_char,
    config: *const MobileConfig,
) -> MobileResult {
    // Safety checks
    if input_path.is_null() || output_path.is_null() {
        return MobileResult::InvalidInputPath;
    }

    let input = unsafe {
        match CStr::from_ptr(input_path).to_str() {
            Ok(s) => Path::new(s),
            Err(_) => return MobileResult::InvalidInputPath,
        }
    };

    let output = unsafe {
        match CStr::from_ptr(output_path).to_str() {
            Ok(s) => Path::new(s),
            Err(_) => return MobileResult::InvalidOutputPath,
        }
    };

    let cfg = if config.is_null() {
        MobileConfig::default()
    } else {
        unsafe { (*config).clone() }
    };

    let compressor = MobileCompressor::new(cfg);
    match compressor.compress_file(input, output) {
        Ok(result) => result,
        Err(_) => MobileResult::CompressionFailed,
    }
}

/// Decompress a file (synchronous)
#[no_mangle]
pub extern "C" fn spk_mobile_decompress(
    archive_path: *const c_char,
    output_path: *const c_char,
    config: *const MobileConfig,
) -> MobileResult {
    // Safety checks
    if archive_path.is_null() || output_path.is_null() {
        return MobileResult::InvalidInputPath;
    }

    let archive = unsafe {
        match CStr::from_ptr(archive_path).to_str() {
            Ok(s) => Path::new(s),
            Err(_) => return MobileResult::InvalidInputPath,
        }
    };

    let output = unsafe {
        match CStr::from_ptr(output_path).to_str() {
            Ok(s) => Path::new(s),
            Err(_) => return MobileResult::InvalidOutputPath,
        }
    };

    let cfg = if config.is_null() {
        MobileConfig::default()
    } else {
        unsafe { (*config).clone() }
    };

    let decompressor = MobileDecompressor::new(cfg);
    match decompressor.decompress(archive, output) {
        Ok(result) => result,
        Err(_) => MobileResult::DecompressionFailed,
    }
}

/// Get archive info
#[no_mangle]
pub extern "C" fn spk_mobile_get_info(
    archive_path: *const c_char,
    info_out: *mut ArchiveInfo,
) -> MobileResult {
    if archive_path.is_null() || info_out.is_null() {
        return MobileResult::InvalidInputPath;
    }

    let archive = unsafe {
        match CStr::from_ptr(archive_path).to_str() {
            Ok(s) => Path::new(s),
            Err(_) => return MobileResult::InvalidInputPath,
        }
    };

    let decompressor = MobileDecompressor::new(MobileConfig::default());
    match decompressor.get_archive_info(archive) {
        Ok(info) => {
            unsafe { *info_out = info; }
            MobileResult::Success
        }
        Err(_) => MobileResult::FileNotFound,
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mobile_config_default() {
        let config = MobileConfig::default();
        assert!(config.energy_aware);
        assert!(config.verify_output);
        assert!(!config.use_gpu);
    }

    #[test]
    fn test_mobile_config_effective_chunk_size() {
        let mut config = MobileConfig::default();
        
        // Auto chunk size
        assert_eq!(config.effective_chunk_size(), MOBILE_CHUNK_SIZE);
        
        // Low memory mode
        config.low_memory_mode = true;
        assert_eq!(config.effective_chunk_size(), MOBILE_LOW_MEM_CHUNK_SIZE);
        
        // Manual override
        config.chunk_size = 512 * 1024;
        assert_eq!(config.effective_chunk_size(), 512 * 1024);
    }

    #[test]
    fn test_mobile_config_gpu_decision() {
        let mut config = MobileConfig::default();
        config.use_gpu = true;
        config.energy_aware = true;
        
        // Not charging, high battery
        config.battery_percent = 50;
        config.is_charging = false;
        assert!(config.should_use_gpu());
        
        // Not charging, low battery
        config.battery_percent = 15;
        assert!(!config.should_use_gpu());
        
        // Charging, low battery
        config.is_charging = true;
        assert!(config.should_use_gpu());
    }

    #[test]
    fn test_mobile_config_throttle() {
        let mut config = MobileConfig::default();
        config.energy_aware = true;
        config.is_charging = false;
        
        config.battery_percent = 50;
        assert!(!config.should_throttle());
        
        config.battery_percent = 5;
        assert!(config.should_throttle());
        
        // Charging overrides
        config.is_charging = true;
        assert!(!config.should_throttle());
    }

    #[test]
    fn test_mobile_progress_default() {
        let progress = MobileProgress::default();
        assert_eq!(progress.total_bytes, 0);
        assert_eq!(progress.compression_ratio, 1.0);
        assert!(!progress.is_complete);
    }

    #[test]
    fn test_archive_info_default() {
        let info = ArchiveInfo::default();
        assert_eq!(info.archive_size, 0);
        assert_eq!(info.spk_version, 1);
        assert!(!info.is_encrypted);
    }

    #[test]
    fn test_ffi_version() {
        assert_eq!(spk_mobile_version(), MOBILE_FFI_VERSION);
    }

    #[test]
    fn test_create_mobile_header() {
        let header = create_mobile_header(1024);
        assert_eq!(&header[0..4], b"SPK1");
        assert_eq!(header.len(), 64);
    }

    #[test]
    fn test_create_chunk_header() {
        let header = create_chunk_header(1024, 512);
        assert_eq!(header.len(), 8);
        
        let original = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let compressed = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
        
        assert_eq!(original, 1024);
        assert_eq!(compressed, 512);
    }
}
