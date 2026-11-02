//! Edge and Mobile Device Support (V8)
//!
//! Ultra-low memory pipeline for edge devices, mobile platforms,
//! and resource-constrained environments.

use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use crate::utils::error::{SpkError, SpkResult};
use crate::CodecType;

/// Device capability profile
#[derive(Debug, Clone)]
pub struct DeviceProfile {
    /// Device type
    pub device_type: DeviceType,
    /// Available memory in bytes
    pub available_memory: usize,
    /// CPU core count
    pub cpu_cores: usize,
    /// CPU frequency in MHz (if known)
    pub cpu_freq_mhz: Option<u32>,
    /// Battery powered
    pub battery_powered: bool,
    /// Current battery percentage (0-100)
    pub battery_percent: Option<u8>,
    /// Thermal state
    pub thermal_state: ThermalState,
    /// Storage type
    pub storage_type: StorageType,
    /// Network type
    pub network_type: NetworkType,
}

/// Device type classification
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceType {
    /// High-end desktop/server
    Desktop,
    /// Laptop
    Laptop,
    /// Tablet
    Tablet,
    /// Mobile phone
    Mobile,
    /// IoT/Embedded device
    Embedded,
    /// Edge server
    EdgeServer,
    /// Unknown
    Unknown,
}

/// Thermal state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThermalState {
    /// Cool - full performance
    Cool,
    /// Warm - slight throttling
    Warm,
    /// Hot - significant throttling
    Hot,
    /// Critical - minimal operation
    Critical,
}

/// Storage type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageType {
    /// NVMe SSD
    NVMe,
    /// SATA SSD
    Ssd,
    /// HDD
    Hdd,
    /// eMMC
    Emmc,
    /// SD Card
    SdCard,
    /// Network storage
    Network,
    /// Unknown
    Unknown,
}

/// Network type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkType {
    /// Ethernet
    Ethernet,
    /// WiFi
    Wifi,
    /// 5G
    Mobile5G,
    /// 4G/LTE
    Mobile4G,
    /// 3G or slower
    MobileSlow,
    /// No network
    None,
}

impl DeviceProfile {
    /// Create profile for desktop
    pub fn desktop() -> Self {
        Self {
            device_type: DeviceType::Desktop,
            available_memory: 16 * 1024 * 1024 * 1024, // 16GB
            cpu_cores: num_cpus::get(),
            cpu_freq_mhz: None,
            battery_powered: false,
            battery_percent: None,
            thermal_state: ThermalState::Cool,
            storage_type: StorageType::NVMe,
            network_type: NetworkType::Ethernet,
        }
    }

    /// Create profile for mobile device
    pub fn mobile() -> Self {
        Self {
            device_type: DeviceType::Mobile,
            available_memory: 2 * 1024 * 1024 * 1024, // 2GB
            cpu_cores: 4,
            cpu_freq_mhz: Some(2000),
            battery_powered: true,
            battery_percent: Some(100),
            thermal_state: ThermalState::Cool,
            storage_type: StorageType::Emmc,
            network_type: NetworkType::Wifi,
        }
    }

    /// Create profile for embedded device
    pub fn embedded() -> Self {
        Self {
            device_type: DeviceType::Embedded,
            available_memory: 512 * 1024 * 1024, // 512MB
            cpu_cores: 2,
            cpu_freq_mhz: Some(1000),
            battery_powered: true,
            battery_percent: Some(100),
            thermal_state: ThermalState::Cool,
            storage_type: StorageType::SdCard,
            network_type: NetworkType::Wifi,
        }
    }

    /// Detect current device profile
    pub fn detect() -> Self {
        let memory = Self::detect_memory();
        let cores = num_cpus::get();
        
        let device_type = if memory > 8 * 1024 * 1024 * 1024 && cores >= 4 {
            DeviceType::Desktop
        } else if memory > 2 * 1024 * 1024 * 1024 {
            DeviceType::Laptop
        } else if memory > 512 * 1024 * 1024 {
            DeviceType::Mobile
        } else {
            DeviceType::Embedded
        };

        Self {
            device_type,
            available_memory: memory,
            cpu_cores: cores,
            cpu_freq_mhz: None,
            battery_powered: false,
            battery_percent: None,
            thermal_state: ThermalState::Cool,
            storage_type: StorageType::Unknown,
            network_type: NetworkType::None,
        }
    }

    fn detect_memory() -> usize {
        // Platform-specific memory detection would go here
        // For now, return a reasonable default
        4 * 1024 * 1024 * 1024 // 4GB default
    }

    /// Get recommended chunk size
    pub fn recommended_chunk_size(&self) -> usize {
        match self.device_type {
            DeviceType::Desktop | DeviceType::EdgeServer => 4 * 1024 * 1024, // 4MB
            DeviceType::Laptop => 2 * 1024 * 1024, // 2MB
            DeviceType::Tablet => 1 * 1024 * 1024, // 1MB
            DeviceType::Mobile => 512 * 1024, // 512KB
            DeviceType::Embedded => 128 * 1024, // 128KB
            DeviceType::Unknown => 1 * 1024 * 1024,
        }
    }

    /// Get recommended buffer size
    pub fn recommended_buffer_size(&self) -> usize {
        // Use at most 1/8 of available memory for buffers
        (self.available_memory / 8).min(256 * 1024 * 1024)
    }

    /// Get recommended thread count
    pub fn recommended_threads(&self) -> usize {
        match self.thermal_state {
            ThermalState::Cool => self.cpu_cores,
            ThermalState::Warm => (self.cpu_cores * 3 / 4).max(1),
            ThermalState::Hot => (self.cpu_cores / 2).max(1),
            ThermalState::Critical => 1,
        }
    }

    /// Check if should conserve power
    pub fn should_conserve_power(&self) -> bool {
        self.battery_powered && self.battery_percent.map(|p| p < 20).unwrap_or(false)
    }
}

/// Edge pipeline configuration
#[derive(Debug, Clone)]
pub struct EdgeConfig {
    /// Maximum memory usage
    pub max_memory: usize,
    /// Chunk size
    pub chunk_size: usize,
    /// Buffer size
    pub buffer_size: usize,
    /// Thread count
    pub threads: usize,
    /// Codec to use
    pub codec: CodecType,
    /// Stream mode (minimize memory)
    pub stream_mode: bool,
    /// Power saving mode
    pub power_saving: bool,
}

impl EdgeConfig {
    /// Create config from device profile
    pub fn from_profile(profile: &DeviceProfile) -> Self {
        Self {
            max_memory: profile.available_memory / 4,
            chunk_size: profile.recommended_chunk_size(),
            buffer_size: profile.recommended_buffer_size(),
            threads: profile.recommended_threads(),
            codec: CodecType::Lz4, // Fast, low memory
            stream_mode: profile.available_memory < 1024 * 1024 * 1024,
            power_saving: profile.should_conserve_power(),
        }
    }

    /// Create minimal config for very constrained devices
    pub fn minimal() -> Self {
        Self {
            max_memory: 64 * 1024 * 1024, // 64MB
            chunk_size: 128 * 1024, // 128KB
            buffer_size: 256 * 1024, // 256KB
            threads: 1,
            codec: CodecType::Lz4,
            stream_mode: true,
            power_saving: true,
        }
    }
}

/// Edge-optimized compression pipeline
pub struct EdgePipeline {
    /// Configuration
    config: EdgeConfig,
    /// Device profile
    profile: DeviceProfile,
    /// Current memory usage
    memory_usage: Arc<std::sync::atomic::AtomicUsize>,
    /// Active operations
    active_ops: Arc<std::sync::atomic::AtomicUsize>,
    /// Statistics
    stats: Arc<RwLock<EdgeStats>>,
}

impl EdgePipeline {
    /// Create new edge pipeline
    pub fn new(profile: DeviceProfile) -> Self {
        let config = EdgeConfig::from_profile(&profile);
        Self {
            config,
            profile,
            memory_usage: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            active_ops: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            stats: Arc::new(RwLock::new(EdgeStats::default())),
        }
    }

    /// Create with custom config
    pub fn with_config(profile: DeviceProfile, config: EdgeConfig) -> Self {
        Self {
            config,
            profile,
            memory_usage: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            active_ops: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            stats: Arc::new(RwLock::new(EdgeStats::default())),
        }
    }

    /// Check if operation can proceed
    pub fn can_proceed(&self, required_memory: usize) -> bool {
        let current = self.memory_usage.load(std::sync::atomic::Ordering::Relaxed);
        current + required_memory <= self.config.max_memory
    }

    /// Acquire memory
    pub fn acquire_memory(&self, size: usize) -> SpkResult<MemoryGuard> {
        if !self.can_proceed(size) {
            return Err(SpkError::Internal("Insufficient memory for operation".into()));
        }

        self.memory_usage.fetch_add(size, std::sync::atomic::Ordering::SeqCst);
        self.active_ops.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        Ok(MemoryGuard {
            size,
            memory_usage: Arc::clone(&self.memory_usage),
            active_ops: Arc::clone(&self.active_ops),
        })
    }

    /// Compress data with edge optimizations
    pub fn compress(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        let _guard = self.acquire_memory(data.len() + self.config.buffer_size)?;
        
        let start = Instant::now();
        
        // Use streaming compression for large data in stream mode
        let result = if self.config.stream_mode && data.len() > self.config.chunk_size {
            self.compress_streaming(data)?
        } else {
            self.compress_direct(data)?
        };

        // Update stats
        if let Ok(mut stats) = self.stats.write() {
            stats.operations += 1;
            stats.bytes_processed += data.len() as u64;
            stats.bytes_output += result.len() as u64;
            stats.total_time_ms += start.elapsed().as_millis() as u64;
        }

        Ok(result)
    }

    /// 🚀 Direct compression (fits in memory) - REAL IMPLEMENTATION
    fn compress_direct(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        // 🔥 Actual compression using real codecs!
        match self.config.codec {
            CodecType::Lz4 => {
                // ⚡ LZ4 - Ultra-fast compression for edge devices
                let compressed = lz4_flex::compress_prepend_size(data);
                Ok(compressed)
            }
            CodecType::Zstd => {
                // 🎯 ZSTD - Best ratio, adaptive level based on device profile
                let level = self.adaptive_zstd_level();
                let compressed = zstd::encode_all(
                    std::io::Cursor::new(data),
                    level,
                ).map_err(|e| SpkError::Internal(format!("ZSTD compress failed: {}", e)))?;
                Ok(compressed)
            }
            CodecType::Brotli => {
                // 📦 Brotli - Great for text/web content on edge
                let mut output = Vec::new();
                let params = brotli::enc::BrotliEncoderParams {
                    quality: 4, // 🔋 Lower quality for battery savings
                    lgwin: 20,
                    ..Default::default()
                };
                brotli::enc::BrotliCompress(
                    &mut std::io::Cursor::new(data),
                    &mut output,
                    &params,
                ).map_err(|e| SpkError::Internal(format!("Brotli compress failed: {}", e)))?;
                Ok(output)
            }
            _ => {
                // 🔄 Default to LZ4 for unknown codecs
                Ok(lz4_flex::compress_prepend_size(data))
            }
        }
    }
    
    /// 🎚️ Adaptive ZSTD level based on device thermal/battery state
    fn adaptive_zstd_level(&self) -> i32 {
        let profile = &self.profile;
        
        // 🌡️ Thermal throttling
        let thermal_level = match profile.thermal_state {
            ThermalState::Cool => 5,     // Full power
            ThermalState::Warm => 3,     // Slight throttle
            ThermalState::Hot => 2,      // Significant throttle
            ThermalState::Critical => 1, // Minimal
        };
        
        // 🔋 Battery consideration
        let battery_level = if profile.battery_powered {
            match profile.battery_percent {
                Some(p) if p > 50 => thermal_level,
                Some(p) if p > 20 => thermal_level.min(3),
                _ => 1, // Low battery = minimum compression
            }
        } else {
            thermal_level
        };
        
        battery_level
    }

    /// Streaming compression (chunk by chunk)
    fn compress_streaming(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        let mut output = Vec::new();
        let chunk_size = self.config.chunk_size;

        for chunk in data.chunks(chunk_size) {
            let compressed = self.compress_direct(chunk)?;
            // Write chunk length then data
            let len = compressed.len() as u32;
            output.extend_from_slice(&len.to_le_bytes());
            output.extend_from_slice(&compressed);
        }

        Ok(output)
    }

    /// Decompress data
    pub fn decompress(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        let _guard = self.acquire_memory(data.len() * 4)?; // Estimate 4x expansion
        
        let start = Instant::now();

        let result = if self.config.stream_mode {
            self.decompress_streaming(data)?
        } else {
            self.decompress_direct(data)?
        };

        if let Ok(mut stats) = self.stats.write() {
            stats.operations += 1;
            stats.bytes_processed += data.len() as u64;
            stats.bytes_output += result.len() as u64;
            stats.total_time_ms += start.elapsed().as_millis() as u64;
        }

        Ok(result)
    }

    /// 🔓 Direct decompression - REAL IMPLEMENTATION
    fn decompress_direct(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        // 🔍 Auto-detect compression format from header
        if data.len() < 4 {
            return Ok(data.to_vec());
        }
        
        // ⚡ Try LZ4 first (has size prefix from lz4_flex)
        if let Ok(decompressed) = lz4_flex::decompress_size_prepended(data) {
            return Ok(decompressed);
        }
        
        // 🎯 Try ZSTD (magic number: 0xFD2FB528)
        if data.len() >= 4 && data[0] == 0x28 && data[1] == 0xB5 && data[2] == 0x2F && data[3] == 0xFD {
            let decompressed = zstd::decode_all(std::io::Cursor::new(data))
                .map_err(|e| SpkError::Internal(format!("ZSTD decompress failed: {}", e)))?;
            return Ok(decompressed);
        }
        
        // 📦 Try Brotli
        let mut output = Vec::new();
        if brotli::BrotliDecompress(&mut std::io::Cursor::new(data), &mut output).is_ok() {
            return Ok(output);
        }
        
        // 🔄 Return as-is if no compression detected
        Ok(data.to_vec())
    }

    /// Streaming decompression
    fn decompress_streaming(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        let mut output = Vec::new();
        let mut offset = 0;

        while offset + 4 <= data.len() {
            let len = u32::from_le_bytes([
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ]) as usize;
            offset += 4;

            if offset + len > data.len() {
                return Err(SpkError::Internal("Invalid stream format".into()));
            }

            let chunk = &data[offset..offset + len];
            let decompressed = self.decompress_direct(chunk)?;
            output.extend_from_slice(&decompressed);
            offset += len;
        }

        Ok(output)
    }

    /// Get current memory usage
    pub fn memory_usage(&self) -> usize {
        self.memory_usage.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Get active operation count
    pub fn active_operations(&self) -> usize {
        self.active_ops.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Get statistics
    pub fn stats(&self) -> EdgeStats {
        self.stats.read().map(|s| s.clone()).unwrap_or_default()
    }

    /// Get config
    pub fn config(&self) -> &EdgeConfig {
        &self.config
    }

    /// Get profile
    pub fn profile(&self) -> &DeviceProfile {
        &self.profile
    }

    /// Update thermal state
    pub fn update_thermal(&mut self, state: ThermalState) {
        self.profile.thermal_state = state;
        self.config.threads = self.profile.recommended_threads();
    }

    /// Update battery level
    pub fn update_battery(&mut self, percent: u8) {
        self.profile.battery_percent = Some(percent);
        self.config.power_saving = self.profile.should_conserve_power();
    }
}

/// Memory guard for RAII-style memory tracking
pub struct MemoryGuard {
    size: usize,
    memory_usage: Arc<std::sync::atomic::AtomicUsize>,
    active_ops: Arc<std::sync::atomic::AtomicUsize>,
}

impl Drop for MemoryGuard {
    fn drop(&mut self) {
        self.memory_usage.fetch_sub(self.size, std::sync::atomic::Ordering::SeqCst);
        self.active_ops.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Edge pipeline statistics
#[derive(Debug, Clone, Default)]
pub struct EdgeStats {
    pub operations: u64,
    pub bytes_processed: u64,
    pub bytes_output: u64,
    pub total_time_ms: u64,
}

impl EdgeStats {
    /// Get compression ratio
    pub fn compression_ratio(&self) -> f64 {
        if self.bytes_output == 0 {
            0.0
        } else {
            self.bytes_processed as f64 / self.bytes_output as f64
        }
    }

    /// Get throughput in bytes/sec
    pub fn throughput(&self) -> f64 {
        if self.total_time_ms == 0 {
            0.0
        } else {
            (self.bytes_processed as f64 / self.total_time_ms as f64) * 1000.0
        }
    }
}

/// Thermal monitor for mobile devices
pub struct ThermalMonitor {
    /// Current state
    state: Arc<RwLock<ThermalState>>,
    /// Temperature thresholds (Celsius)
    thresholds: ThermalThresholds,
    /// Last check time
    last_check: Arc<RwLock<Instant>>,
    /// Check interval
    check_interval: Duration,
}

/// Temperature thresholds
#[derive(Debug, Clone)]
pub struct ThermalThresholds {
    pub warm: f32,
    pub hot: f32,
    pub critical: f32,
}

impl Default for ThermalThresholds {
    fn default() -> Self {
        Self {
            warm: 45.0,
            hot: 60.0,
            critical: 75.0,
        }
    }
}

impl ThermalMonitor {
    /// Create new thermal monitor
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(ThermalState::Cool)),
            thresholds: ThermalThresholds::default(),
            last_check: Arc::new(RwLock::new(Instant::now())),
            check_interval: Duration::from_secs(5),
        }
    }

    /// Update temperature
    pub fn update_temperature(&self, temp_celsius: f32) {
        let state = if temp_celsius >= self.thresholds.critical {
            ThermalState::Critical
        } else if temp_celsius >= self.thresholds.hot {
            ThermalState::Hot
        } else if temp_celsius >= self.thresholds.warm {
            ThermalState::Warm
        } else {
            ThermalState::Cool
        };

        if let Ok(mut s) = self.state.write() {
            *s = state;
        }
    }

    /// Get current state
    pub fn current_state(&self) -> ThermalState {
        self.state.read().map(|s| *s).unwrap_or(ThermalState::Cool)
    }

    /// Check if should throttle
    pub fn should_throttle(&self) -> bool {
        matches!(self.current_state(), ThermalState::Hot | ThermalState::Critical)
    }

    /// Get throttle factor (1.0 = no throttle, 0.0 = full throttle)
    pub fn throttle_factor(&self) -> f32 {
        match self.current_state() {
            ThermalState::Cool => 1.0,
            ThermalState::Warm => 0.8,
            ThermalState::Hot => 0.5,
            ThermalState::Critical => 0.2,
        }
    }
}

impl Default for ThermalMonitor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_profile_detection() {
        let profile = DeviceProfile::detect();
        assert!(profile.available_memory > 0);
        assert!(profile.cpu_cores > 0);
    }

    #[test]
    fn test_edge_config_from_profile() {
        let profile = DeviceProfile::mobile();
        let config = EdgeConfig::from_profile(&profile);
        
        assert!(config.chunk_size <= 1024 * 1024);
        assert!(config.threads <= profile.cpu_cores);
    }

    #[test]
    fn test_edge_pipeline() {
        let profile = DeviceProfile::mobile();
        let pipeline = EdgePipeline::new(profile);

        let data = b"Hello, edge world!";
        let compressed = pipeline.compress(data).unwrap();
        assert!(!compressed.is_empty());
    }

    #[test]
    fn test_thermal_monitor() {
        let monitor = ThermalMonitor::new();
        
        monitor.update_temperature(40.0);
        assert_eq!(monitor.current_state(), ThermalState::Cool);
        
        monitor.update_temperature(50.0);
        assert_eq!(monitor.current_state(), ThermalState::Warm);
        
        monitor.update_temperature(70.0);
        assert_eq!(monitor.current_state(), ThermalState::Hot);
    }
}
