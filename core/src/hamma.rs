//! HAMMA v2: stateful, speed/benefit-aware controller (metadata-only)
//!
//! Maintains per-context strategy stats (raw/compressed/delta/dict) and
//! uses observed outcomes to gate future strategy choices. No payload
//! inspection, metadata-only, append-safe persistence.
//!
//! Speed Modes:
//! - Fastest: LZ4 only, minimal overhead, 500+ MB/s target
//! - Balanced: ZSTD level 3, good ratio/speed, 150+ MB/s target
//! - Maximum: Full HAMMA decision engine, best ratio

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::codec::{Codec, CompressionLevel};

/// Speed mode for HAMMA - determines compression strategy priority
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum SpeedMode {
    /// Fastest compression - LZ4 only, minimal CPU usage
    /// Target: 500+ MB/s, suitable for real-time or low-power devices
    Fastest,
    /// Balanced compression - ZSTD level 3, good ratio with decent speed
    /// Target: 150+ MB/s, suitable for most workloads
    #[default]
    Balanced,
    /// Maximum compression - full HAMMA decision engine
    /// Target: best ratio, uses delta/dictionary when beneficial
    Maximum,
    /// Auto mode - HAMMA selects based on device capabilities
    Auto,
}

impl SpeedMode {
    /// Get recommended codec for this speed mode
    pub fn recommended_codec(&self) -> Codec {
        match self {
            SpeedMode::Fastest => Codec::Lz4,
            SpeedMode::Balanced => Codec::Zstd,
            SpeedMode::Maximum => Codec::Zstd,
            SpeedMode::Auto => Codec::Zstd, // HAMMA will override
        }
    }

    /// Get recommended compression level for this speed mode
    pub fn recommended_level(&self) -> CompressionLevel {
        match self {
            SpeedMode::Fastest => CompressionLevel::Fast,
            SpeedMode::Balanced => CompressionLevel::Custom(3),
            SpeedMode::Maximum => CompressionLevel::Custom(19),
            SpeedMode::Auto => CompressionLevel::Normal,
        }
    }

    /// Get target throughput in MB/s
    pub fn target_throughput_mb_s(&self) -> f64 {
        match self {
            SpeedMode::Fastest => 500.0,
            SpeedMode::Balanced => 150.0,
            SpeedMode::Maximum => 50.0,
            SpeedMode::Auto => 100.0,
        }
    }

    /// Check if delta compression should be attempted
    pub fn allow_delta(&self) -> bool {
        matches!(self, SpeedMode::Maximum | SpeedMode::Auto)
    }

    /// Check if dictionary compression should be attempted
    pub fn allow_dictionary(&self) -> bool {
        matches!(self, SpeedMode::Maximum | SpeedMode::Auto)
    }

    /// Get recommended chunk size for this mode
    pub fn recommended_chunk_size(&self) -> usize {
        match self {
            SpeedMode::Fastest => 256 * 1024,      // 256KB - smaller for speed
            SpeedMode::Balanced => 1024 * 1024,    // 1MB - balanced
            SpeedMode::Maximum => 4 * 1024 * 1024, // 4MB - larger for ratio
            SpeedMode::Auto => 1024 * 1024,        // 1MB default
        }
    }

    /// Get recommended thread count based on mode and available CPUs
    pub fn recommended_threads(&self, available_cpus: usize) -> usize {
        match self {
            SpeedMode::Fastest => available_cpus.min(8), // Use all for speed
            SpeedMode::Balanced => (available_cpus / 2).max(2).min(6),
            SpeedMode::Maximum => (available_cpus / 4).max(1).min(4), // Less parallel for better ratio
            SpeedMode::Auto => (available_cpus / 2).max(2).min(8),
        }
    }
}

/// Device profile for adaptive compression
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeviceProfile {
    /// Ultra low resource: <512MB RAM, 1-2 cores
    UltraLow,
    /// Low resource: 512MB-2GB RAM, 2-4 cores
    Low,
    /// Normal: 2GB-8GB RAM, 4-8 cores
    Normal,
    /// High performance: 8GB+ RAM, 8+ cores
    High,
}

impl DeviceProfile {
    /// Detect device profile from system
    pub fn detect() -> Self {
        let cpus = num_cpus::get();
        
        // Simple heuristic based on CPU count
        // In production, would also check available memory
        match cpus {
            0..=2 => DeviceProfile::UltraLow,
            3..=4 => DeviceProfile::Low,
            5..=8 => DeviceProfile::Normal,
            _ => DeviceProfile::High,
        }
    }

    /// Get recommended speed mode for this device
    pub fn recommended_speed_mode(&self) -> SpeedMode {
        match self {
            DeviceProfile::UltraLow => SpeedMode::Fastest,
            DeviceProfile::Low => SpeedMode::Fastest,
            DeviceProfile::Normal => SpeedMode::Balanced,
            DeviceProfile::High => SpeedMode::Balanced, // Still balanced by default
        }
    }

    /// Get max memory budget for compression buffers
    pub fn memory_budget_bytes(&self) -> usize {
        match self {
            DeviceProfile::UltraLow => 64 * 1024 * 1024,   // 64MB
            DeviceProfile::Low => 256 * 1024 * 1024,      // 256MB
            DeviceProfile::Normal => 1024 * 1024 * 1024,  // 1GB
            DeviceProfile::High => 4 * 1024 * 1024 * 1024, // 4GB
        }
    }

    /// Get recommended parallel chunk count
    pub fn parallel_chunks(&self) -> usize {
        match self {
            DeviceProfile::UltraLow => 1,
            DeviceProfile::Low => 2,
            DeviceProfile::Normal => 4,
            DeviceProfile::High => 8,
        }
    }
}

/// Strategies HAMMA can score and gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HammaStrategy {
    Raw,
    Compressed,
    Delta,
    DictionaryCompressed,
}

/// Persistent context key capturing coarse, non-sensitive properties.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct HammaContextKey {
    pub file_type: String,
    pub entropy_bucket: u8,
    pub chunk_size_bucket: u32,
    pub shard_id: u16,
    pub dict_id: u32,
}

impl HammaContextKey {
    /// Convert to a string key for JSON serialization
    pub fn to_string_key(&self) -> String {
        format!(
            "{}|{}|{}|{}|{}",
            self.file_type, self.entropy_bucket, self.chunk_size_bucket, self.shard_id, self.dict_id
        )
    }

    /// Parse from a string key
    pub fn from_string_key(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.split('|').collect();
        if parts.len() != 5 {
            return None;
        }
        Some(Self {
            file_type: parts[0].to_string(),
            entropy_bucket: parts[1].parse().ok()?,
            chunk_size_bucket: parts[2].parse().ok()?,
            shard_id: parts[3].parse().ok()?,
            dict_id: parts[4].parse().ok()?,
        })
    }
}

/// Observation supplied by the pipeline after executing a strategy.
#[derive(Debug, Clone)]
pub struct StrategyObservation {
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub wall_time: Duration,
    pub cpu_time: Duration,
    pub success: bool,
    pub fallback: bool,
}

/// Aggregated stats per strategy per context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyStats {
    pub samples: u64,
    pub failures: u64,
    pub fallbacks: u64,
    pub total_input_bytes: u128,
    pub total_output_bytes: u128,
    pub total_wall_ns: u128,
    pub total_cpu_ns: u128,
    pub mean_speed_mb_s: f64,
    pub mean_gain: f64,
    pub var_speed: f64,
    pub var_gain: f64,
    pub hard_blacklist: bool,
}

impl Default for StrategyStats {
    fn default() -> Self {
        Self {
            samples: 0,
            failures: 0,
            fallbacks: 0,
            total_input_bytes: 0,
            total_output_bytes: 0,
            total_wall_ns: 0,
            total_cpu_ns: 0,
            mean_speed_mb_s: 0.0,
            mean_gain: 0.0,
            var_speed: 0.0,
            var_gain: 0.0,
            hard_blacklist: false,
        }
    }
}

/// HAMMA configuration knobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HammaConfig {
    /// Minimum useful speed (MB/s). Strategies slower with marginal gain get gated.
    pub min_speed_mb_s: f64,
    /// Minimum gain ratio (input_bytes / output_bytes) to be considered beneficial.
    pub min_gain_ratio: f64,
    /// Samples required before enforcing gates.
    pub min_samples_for_gating: u32,
    /// Output path for state file.
    pub state_file: String,
}

impl Default for HammaConfig {
    fn default() -> Self {
        Self {
            min_speed_mb_s: 50.0,
            min_gain_ratio: 1.05,
            min_samples_for_gating: 8,
            state_file: "hamma_state.json".to_string(),
        }
    }
}

/// Serializable context map (string keys for JSON compatibility)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SerializableContexts {
    entries: Vec<(HammaContextKey, HashMap<HammaStrategy, StrategyStats>)>,
}

impl From<&HashMap<HammaContextKey, HashMap<HammaStrategy, StrategyStats>>> for SerializableContexts {
    fn from(map: &HashMap<HammaContextKey, HashMap<HammaStrategy, StrategyStats>>) -> Self {
        Self {
            entries: map.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        }
    }
}

impl From<SerializableContexts> for HashMap<HammaContextKey, HashMap<HammaStrategy, StrategyStats>> {
    fn from(sc: SerializableContexts) -> Self {
        sc.entries.into_iter().collect()
    }
}

/// Persistent HAMMA state (metadata-only).
#[derive(Debug, Clone)]
pub struct HammaState {
    pub version: u32,
    pub contexts: HashMap<HammaContextKey, HashMap<HammaStrategy, StrategyStats>>,
    dirty: bool,
    path: PathBuf,
    pub config: HammaConfig,
}

/// Helper for serialization
#[derive(Serialize, Deserialize)]
struct HammaStateSerde {
    version: u32,
    contexts: SerializableContexts,
    config: HammaConfig,
}

impl HammaState {
    pub fn load_or_default<P: AsRef<Path>>(root: P, config: HammaConfig) -> Self {
        let path = root.as_ref().join(&config.state_file);
        let mut state = if path.exists() {
            match Self::load(&path, config.clone()) {
                Ok(s) => s,
                Err(_) => Self::new(path.clone(), config.clone()),
            }
        } else {
            Self::new(path.clone(), config.clone())
        };

        state.path = path;
        state
    }

    pub fn new(path: PathBuf, config: HammaConfig) -> Self {
        Self {
            version: 1,
            contexts: HashMap::new(),
            dirty: false,
            path,
            config,
        }
    }

    fn load(path: &Path, config: HammaConfig) -> std::io::Result<Self> {
        let mut buf = Vec::new();
        File::open(path)?.read_to_end(&mut buf)?;
        let serde_state: HammaStateSerde = serde_json::from_slice(&buf)?;
        Ok(Self {
            version: serde_state.version,
            contexts: serde_state.contexts.into(),
            dirty: false,
            path: path.to_path_buf(),
            config,
        })
    }

    /// Persist if dirty using atomic temp+rename; no-op if clean.
    pub fn persist(&mut self) -> std::io::Result<()> {
        if !self.dirty {
            return Ok(());
        }

        let serde_state = HammaStateSerde {
            version: self.version,
            contexts: SerializableContexts::from(&self.contexts),
            config: self.config.clone(),
        };

        let serialized = serde_json::to_vec_pretty(&serde_state)?;
        let tmp = self
            .path
            .with_extension("hamma.tmp");

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        {
            let mut f = File::create(&tmp)?;
            f.write_all(&serialized)?;
            f.flush()?;
        }

        fs::rename(tmp, &self.path)?;
        self.dirty = false;
        Ok(())
    }

    /// Gate whether a strategy should be attempted for a given context.
    pub fn should_try(&self, ctx: &HammaContextKey, strategy: HammaStrategy) -> bool {
        if let Some(strategy_map) = self.contexts.get(ctx) {
            if let Some(stats) = strategy_map.get(&strategy) {
                if stats.hard_blacklist {
                    return false;
                }

                if stats.samples >= self.config.min_samples_for_gating as u64 {
                    let gain = stats.mean_gain;
                    let speed = stats.mean_speed_mb_s;
                    let fail_rate = stats.failures as f64 / (stats.samples as f64).max(1.0);

                    if gain < self.config.min_gain_ratio && speed < self.config.min_speed_mb_s {
                        return false;
                    }

                    if fail_rate > 0.05 {
                        return false;
                    }
                }
            }
        }

        true
    }

    /// Record an observation (success or failure) for a strategy in context.
    pub fn record(&mut self, ctx: &HammaContextKey, strategy: HammaStrategy, obs: StrategyObservation) {
        let strategy_map = self.contexts.entry(ctx.clone()).or_default();
        let stats = strategy_map.entry(strategy).or_default();

        stats.samples += 1;
        if !obs.success {
            stats.failures += 1;
        }
        if obs.fallback {
            stats.fallbacks += 1;
        }

        stats.total_input_bytes += obs.input_bytes as u128;
        stats.total_output_bytes += obs.output_bytes as u128;
        stats.total_wall_ns += obs.wall_time.as_nanos();
        stats.total_cpu_ns += obs.cpu_time.as_nanos();

        // Update means/variance (Welford) for speed and gain.
        let speed_mb_s = if obs.wall_time.as_secs_f64() > 0.0 {
            (obs.input_bytes as f64 / 1_048_576.0) / obs.wall_time.as_secs_f64()
        } else {
            // Treat as very fast; cap to avoid inf.
            1_000_000.0
        };
        let gain = if obs.output_bytes > 0 {
            obs.input_bytes as f64 / obs.output_bytes as f64
        } else {
            // Output zero implies full dedup; treat as very high gain.
            1_000_000.0
        };

        // Speed variance
        let delta_speed = speed_mb_s - stats.mean_speed_mb_s;
        stats.mean_speed_mb_s += delta_speed / stats.samples as f64;
        let delta_speed2 = speed_mb_s - stats.mean_speed_mb_s;
        stats.var_speed += delta_speed * delta_speed2;

        // Gain variance
        let delta_gain = gain - stats.mean_gain;
        stats.mean_gain += delta_gain / stats.samples as f64;
        let delta_gain2 = gain - stats.mean_gain;
        stats.var_gain += delta_gain * delta_gain2;

        // Blacklist if reconstruction/strategy failed hard repeatedly.
        if stats.failures >= 3 && stats.samples >= 5 {
            stats.hard_blacklist = true;
        }

        self.dirty = true;
    }

    /// Build a coarse context key from observed inputs.
    pub fn make_context(
        &self,
        file_type: &str,
        entropy: f64,
        chunk_size: usize,
        shard_id: u16,
        dict_id: u32,
    ) -> HammaContextKey {
        let entropy_bucket = (entropy.clamp(0.0, 1.0) * 10.0).round() as u8;
        let chunk_size_bucket = next_power_bucket(chunk_size as u64);

        HammaContextKey {
            file_type: file_type.to_string(),
            entropy_bucket,
            chunk_size_bucket,
            shard_id,
            dict_id,
        }
    }
}

fn next_power_bucket(size: u64) -> u32 {
    if size == 0 {
        return 0;
    }
    let mut p = 1u64;
    while p < size {
        p <<= 1;
    }
    p as u32
}

// =============================================================================
// HAMMA MANAGER - Background auto-optimization
// =============================================================================

use std::sync::{Arc, RwLock};

/// HAMMA Manager - provides easy API for speed-optimized compression
/// Runs learning in background, automatically selects best strategies
pub struct HammaManager {
    state: Arc<RwLock<HammaState>>,
    speed_mode: SpeedMode,
    device_profile: DeviceProfile,
    auto_persist_interval: u64,
    observations_since_persist: Arc<RwLock<u64>>,
}

impl HammaManager {
    /// Create a new HAMMA manager with auto-detected device profile
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        let device_profile = DeviceProfile::detect();
        let speed_mode = device_profile.recommended_speed_mode();
        
        let config = HammaConfig {
            min_speed_mb_s: speed_mode.target_throughput_mb_s(),
            ..Default::default()
        };
        
        let state = HammaState::load_or_default(root, config);
        
        Self {
            state: Arc::new(RwLock::new(state)),
            speed_mode,
            device_profile,
            auto_persist_interval: 100, // Persist every 100 observations
            observations_since_persist: Arc::new(RwLock::new(0)),
        }
    }

    /// Create with specific speed mode
    pub fn with_speed_mode<P: AsRef<Path>>(root: P, speed_mode: SpeedMode) -> Self {
        let device_profile = DeviceProfile::detect();
        let effective_mode = if speed_mode == SpeedMode::Auto {
            device_profile.recommended_speed_mode()
        } else {
            speed_mode
        };
        
        let config = HammaConfig {
            min_speed_mb_s: effective_mode.target_throughput_mb_s(),
            ..Default::default()
        };
        
        let state = HammaState::load_or_default(root, config);
        
        Self {
            state: Arc::new(RwLock::new(state)),
            speed_mode: effective_mode,
            device_profile,
            auto_persist_interval: 100,
            observations_since_persist: Arc::new(RwLock::new(0)),
        }
    }

    /// Get current speed mode
    pub fn speed_mode(&self) -> SpeedMode {
        self.speed_mode
    }

    /// Get device profile
    pub fn device_profile(&self) -> DeviceProfile {
        self.device_profile
    }

    /// Get recommended codec based on speed mode and context
    pub fn get_codec(&self, file_type: &str, entropy: f64) -> Codec {
        match self.speed_mode {
            SpeedMode::Fastest => Codec::Lz4,
            SpeedMode::Balanced => {
                // High entropy (>0.9) = already compressed, use LZ4
                if entropy > 0.9 {
                    Codec::Lz4
                } else {
                    Codec::Zstd
                }
            }
            SpeedMode::Maximum | SpeedMode::Auto => {
                // Check HAMMA history for best codec
                let state = self.state.read().unwrap();
                let ctx = state.make_context(file_type, entropy, 0, 0, 0);
                
                // If compressed strategy is blacklisted, use LZ4
                if !state.should_try(&ctx, HammaStrategy::Compressed) {
                    Codec::Lz4
                } else if file_type.contains("json") || file_type.contains("xml") || file_type.contains("txt") {
                    Codec::Brotli
                } else {
                    Codec::Zstd
                }
            }
        }
    }

    /// Get recommended compression level
    pub fn get_level(&self, entropy: f64) -> CompressionLevel {
        match self.speed_mode {
            SpeedMode::Fastest => CompressionLevel::Fast,
            SpeedMode::Balanced => {
                if entropy > 0.8 {
                    CompressionLevel::Fast // Don't waste CPU on high entropy
                } else {
                    CompressionLevel::Custom(3)
                }
            }
            SpeedMode::Maximum => CompressionLevel::Custom(19),
            SpeedMode::Auto => {
                // Adaptive based on device
                match self.device_profile {
                    DeviceProfile::UltraLow | DeviceProfile::Low => CompressionLevel::Fast,
                    DeviceProfile::Normal => CompressionLevel::Custom(6),
                    DeviceProfile::High => CompressionLevel::Custom(12),
                }
            }
        }
    }

    /// Check if delta compression should be attempted
    pub fn should_try_delta(&self, ctx: &HammaContextKey) -> bool {
        if !self.speed_mode.allow_delta() {
            return false;
        }
        
        let state = self.state.read().unwrap();
        state.should_try(ctx, HammaStrategy::Delta)
    }

    /// Check if dictionary compression should be attempted
    pub fn should_try_dictionary(&self, ctx: &HammaContextKey) -> bool {
        if !self.speed_mode.allow_dictionary() {
            return false;
        }
        
        let state = self.state.read().unwrap();
        state.should_try(ctx, HammaStrategy::DictionaryCompressed)
    }

    /// Record an observation (called automatically by pipeline)
    pub fn record_observation(
        &self,
        file_type: &str,
        entropy: f64,
        chunk_size: usize,
        strategy: HammaStrategy,
        input_bytes: u64,
        output_bytes: u64,
        wall_time: Duration,
        success: bool,
    ) {
        let obs = StrategyObservation {
            input_bytes,
            output_bytes,
            wall_time,
            cpu_time: wall_time, // Approximate
            success,
            fallback: !success,
        };
        
        {
            let mut state = self.state.write().unwrap();
            let ctx = state.make_context(file_type, entropy, chunk_size, 0, 0);
            state.record(&ctx, strategy, obs);
        }
        
        // Auto-persist periodically
        let mut count = self.observations_since_persist.write().unwrap();
        *count += 1;
        if *count >= self.auto_persist_interval {
            *count = 0;
            drop(count);
            let _ = self.persist();
        }
    }

    /// Make a context key
    pub fn make_context(
        &self,
        file_type: &str,
        entropy: f64,
        chunk_size: usize,
    ) -> HammaContextKey {
        let state = self.state.read().unwrap();
        state.make_context(file_type, entropy, chunk_size, 0, 0)
    }

    /// Persist state to disk
    pub fn persist(&self) -> std::io::Result<()> {
        let mut state = self.state.write().unwrap();
        state.persist()
    }

    /// Get compression parameters as a single struct
    pub fn get_compression_params(&self, file_type: &str, entropy: f64) -> CompressionParams {
        CompressionParams {
            codec: self.get_codec(file_type, entropy),
            level: self.get_level(entropy),
            chunk_size: self.speed_mode.recommended_chunk_size(),
            threads: self.speed_mode.recommended_threads(num_cpus::get()),
            allow_delta: self.speed_mode.allow_delta(),
            allow_dictionary: self.speed_mode.allow_dictionary(),
        }
    }

    /// Get stats summary
    pub fn stats_summary(&self) -> HammaStats {
        let state = self.state.read().unwrap();
        
        let mut total_samples = 0u64;
        let mut total_contexts = 0usize;
        let mut blacklisted_strategies = 0usize;
        
        for (_ctx, strategies) in &state.contexts {
            total_contexts += 1;
            for (_strategy, stats) in strategies {
                total_samples += stats.samples;
                if stats.hard_blacklist {
                    blacklisted_strategies += 1;
                }
            }
        }
        
        HammaStats {
            speed_mode: self.speed_mode,
            device_profile: self.device_profile,
            total_contexts,
            total_samples,
            blacklisted_strategies,
        }
    }
}

/// Compression parameters determined by HAMMA
#[derive(Debug, Clone)]
pub struct CompressionParams {
    pub codec: Codec,
    pub level: CompressionLevel,
    pub chunk_size: usize,
    pub threads: usize,
    pub allow_delta: bool,
    pub allow_dictionary: bool,
}

/// HAMMA statistics summary
#[derive(Debug, Clone)]
pub struct HammaStats {
    pub speed_mode: SpeedMode,
    pub device_profile: DeviceProfile,
    pub total_contexts: usize,
    pub total_samples: u64,
    pub blacklisted_strategies: usize,
}

impl std::fmt::Display for HammaStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "HAMMA Statistics:")?;
        writeln!(f, "  Speed Mode: {:?}", self.speed_mode)?;
        writeln!(f, "  Device Profile: {:?}", self.device_profile)?;
        writeln!(f, "  Contexts Learned: {}", self.total_contexts)?;
        writeln!(f, "  Total Samples: {}", self.total_samples)?;
        writeln!(f, "  Blacklisted Strategies: {}", self.blacklisted_strategies)?;
        Ok(())
    }
}

// Global HAMMA manager instance for easy access
use std::sync::OnceLock;
static GLOBAL_HAMMA: OnceLock<HammaManager> = OnceLock::new();

/// Initialize global HAMMA manager
pub fn init_hamma<P: AsRef<Path>>(root: P, speed_mode: SpeedMode) {
    let _ = GLOBAL_HAMMA.get_or_init(|| HammaManager::with_speed_mode(root, speed_mode));
}

/// Get global HAMMA manager (initializes with defaults if not set)
pub fn get_hamma() -> &'static HammaManager {
    GLOBAL_HAMMA.get_or_init(|| HammaManager::new("."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::time::Duration;

    #[test]
    fn test_hamma_config_default() {
        let config = HammaConfig::default();
        assert!(config.min_speed_mb_s > 0.0);
        assert!(config.min_gain_ratio > 1.0);
        assert!(config.min_samples_for_gating > 0);
        assert!(!config.state_file.is_empty());
    }

    #[test]
    fn test_hamma_context_key_creation() {
        let state = HammaState::new(PathBuf::from("/tmp/test"), HammaConfig::default());
        
        let ctx = state.make_context("json", 0.45, 16384, 0, 0xFFFFFFFF);
        
        assert_eq!(ctx.file_type, "json");
        assert_eq!(ctx.entropy_bucket, 5); // 0.45 * 10 rounded
        assert_eq!(ctx.chunk_size_bucket, 16384);
        assert_eq!(ctx.shard_id, 0);
        assert_eq!(ctx.dict_id, 0xFFFFFFFF);
    }

    #[test]
    fn test_hamma_state_load_or_default() {
        let dir = tempdir().unwrap();
        let config = HammaConfig::default();
        
        let state = HammaState::load_or_default(dir.path(), config.clone());
        
        assert_eq!(state.version, 1);
        assert!(state.contexts.is_empty());
    }

    #[test]
    fn test_hamma_state_persist_and_reload() {
        let dir = tempdir().unwrap();
        let config = HammaConfig::default();
        
        // Create state, record observation, persist
        let mut state = HammaState::load_or_default(dir.path(), config.clone());
        let ctx = state.make_context("binary", 0.8, 8192, 1, 100);
        
        let obs = StrategyObservation {
            input_bytes: 8192,
            output_bytes: 4000,
            wall_time: Duration::from_millis(10),
            cpu_time: Duration::from_millis(8),
            success: true,
            fallback: false,
        };
        state.record(&ctx, HammaStrategy::Compressed, obs);
        state.persist().unwrap();
        
        // Reload and verify
        let state2 = HammaState::load_or_default(dir.path(), config);
        assert!(state2.contexts.contains_key(&ctx));
        
        let stats = state2.contexts.get(&ctx).unwrap().get(&HammaStrategy::Compressed).unwrap();
        assert_eq!(stats.samples, 1);
        assert!(stats.mean_gain > 1.0); // 8192/4000 = 2.048
    }

    #[test]
    fn test_hamma_should_try_no_history() {
        let state = HammaState::new(PathBuf::from("/tmp/test"), HammaConfig::default());
        let ctx = state.make_context("text", 0.3, 4096, 0, 0xFFFFFFFF);
        
        // No history means allow all strategies
        assert!(state.should_try(&ctx, HammaStrategy::Raw));
        assert!(state.should_try(&ctx, HammaStrategy::Compressed));
        assert!(state.should_try(&ctx, HammaStrategy::Delta));
        assert!(state.should_try(&ctx, HammaStrategy::DictionaryCompressed));
    }

    #[test]
    fn test_hamma_gating_after_samples() {
        let mut config = HammaConfig::default();
        config.min_samples_for_gating = 3;
        config.min_speed_mb_s = 100.0;
        config.min_gain_ratio = 1.1;
        
        let mut state = HammaState::new(PathBuf::from("/tmp/test"), config);
        let ctx = state.make_context("video", 0.95, 65536, 0, 0xFFFFFFFF);
        
        // Record poor observations (slow, no gain)
        for _ in 0..5 {
            let obs = StrategyObservation {
                input_bytes: 65536,
                output_bytes: 65000, // ~1% gain only
                wall_time: Duration::from_secs(1), // very slow
                cpu_time: Duration::from_secs(1),
                success: true,
                fallback: false,
            };
            state.record(&ctx, HammaStrategy::DictionaryCompressed, obs);
        }
        
        // Should be gated now (slow speed + marginal gain)
        assert!(!state.should_try(&ctx, HammaStrategy::DictionaryCompressed));
        // Other strategies still allowed
        assert!(state.should_try(&ctx, HammaStrategy::Raw));
    }

    #[test]
    fn test_hamma_blacklist_on_failures() {
        let mut state = HammaState::new(PathBuf::from("/tmp/test"), HammaConfig::default());
        let ctx = state.make_context("corrupt", 0.5, 32768, 0, 0xFFFFFFFF);
        
        // Record repeated failures
        for _ in 0..5 {
            let obs = StrategyObservation {
                input_bytes: 32768,
                output_bytes: 32768,
                wall_time: Duration::from_millis(1),
                cpu_time: Duration::from_millis(1),
                success: false,
                fallback: true,
            };
            state.record(&ctx, HammaStrategy::Delta, obs);
        }
        
        // Should be hard blacklisted (>=3 failures with >=5 samples)
        assert!(!state.should_try(&ctx, HammaStrategy::Delta));
    }

    #[test]
    fn test_hamma_welford_stats_accuracy() {
        let mut state = HammaState::new(PathBuf::from("/tmp/test"), HammaConfig::default());
        let ctx = state.make_context("data", 0.6, 16384, 0, 0xFFFFFFFF);
        
        // Record known observations
        let speeds = [100.0, 120.0, 80.0, 110.0, 90.0]; // MB/s
        for speed in speeds {
            let bytes = 1_048_576; // 1MB
            let time_secs = 1.0 / speed; // to achieve target speed
            let obs = StrategyObservation {
                input_bytes: bytes,
                output_bytes: bytes / 2, // 2x gain
                wall_time: Duration::from_secs_f64(time_secs),
                cpu_time: Duration::from_secs_f64(time_secs),
                success: true,
                fallback: false,
            };
            state.record(&ctx, HammaStrategy::Compressed, obs);
        }
        
        let stats = state.contexts.get(&ctx).unwrap().get(&HammaStrategy::Compressed).unwrap();
        assert_eq!(stats.samples, 5);
        
        // Mean speed should be close to 100
        assert!((stats.mean_speed_mb_s - 100.0).abs() < 5.0);
        // Mean gain should be close to 2.0
        assert!((stats.mean_gain - 2.0).abs() < 0.1);
    }

    #[test]
    fn test_next_power_bucket() {
        assert_eq!(next_power_bucket(0), 0);
        assert_eq!(next_power_bucket(1), 1);
        assert_eq!(next_power_bucket(2), 2);
        assert_eq!(next_power_bucket(3), 4);
        assert_eq!(next_power_bucket(4), 4);
        assert_eq!(next_power_bucket(5), 8);
        assert_eq!(next_power_bucket(1000), 1024);
        assert_eq!(next_power_bucket(4096), 4096);
        assert_eq!(next_power_bucket(65000), 65536);
    }

    #[test]
    fn test_hamma_strategy_serialization() {
        // Ensure strategies serialize/deserialize correctly
        let strategies = [
            HammaStrategy::Raw,
            HammaStrategy::Compressed,
            HammaStrategy::Delta,
            HammaStrategy::DictionaryCompressed,
        ];
        
        for s in strategies {
            let json = serde_json::to_string(&s).unwrap();
            let back: HammaStrategy = serde_json::from_str(&json).unwrap();
            assert_eq!(s, back);
        }
    }

    #[test]
    fn test_hamma_context_key_serialization() {
        let ctx = HammaContextKey {
            file_type: "image".to_string(),
            entropy_bucket: 7,
            chunk_size_bucket: 32768,
            shard_id: 5,
            dict_id: 42,
        };
        
        let json = serde_json::to_string(&ctx).unwrap();
        let back: HammaContextKey = serde_json::from_str(&json).unwrap();
        assert_eq!(ctx, back);
    }
}
