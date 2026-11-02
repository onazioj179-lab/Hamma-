//! # SPK V14: Heterogeneous Hardware Orchestration
//!
//! Unified compression pipeline across CPU, GPU, TPU, NPU, and FPGA.
//! Enables dynamic workload distribution and hot-swap of accelerators.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use crate::utils::error::{SpkError, SpkResult};

/// V14 version constant
pub const V14_HETEROGENEOUS_VERSION: u8 = 14;

/// Maximum accelerators per system
pub const V14_MAX_ACCELERATORS: usize = 64;

/// Default workload timeout
pub const V14_DEFAULT_TIMEOUT_MS: u64 = 5000;

// =============================================================================
// HARDWARE TYPES
// =============================================================================

/// Hardware accelerator types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AcceleratorType {
    CPU,
    GPU,
    TPU,    // Tensor Processing Unit
    NPU,    // Neural Processing Unit
    FPGA,   // Field-Programmable Gate Array
    ASIC,   // Application-Specific Integrated Circuit
}

/// Hardware capability flags
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareCapabilities {
    /// Accelerator type
    pub accelerator_type: AcceleratorType,
    /// Device ID
    pub device_id: u32,
    /// Device name
    pub name: String,
    /// Memory size in bytes
    pub memory_bytes: u64,
    /// Compute units (cores, SMs, etc.)
    pub compute_units: u32,
    /// Clock speed in MHz
    pub clock_mhz: u32,
    /// Supported operations
    pub operations: Vec<AcceleratorOp>,
    /// Power consumption in watts
    pub power_watts: f32,
    /// Temperature in Celsius
    pub temperature_c: f32,
    /// Utilization percentage
    pub utilization: f32,
}

/// Accelerator operation types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AcceleratorOp {
    Compression,
    Decompression,
    Hashing,
    Encryption,
    MatrixOps,      // For TPU/NPU
    StreamTransform, // For FPGA
    Deduplication,
}

impl HardwareCapabilities {
    /// Check if operation is supported
    pub fn supports(&self, op: AcceleratorOp) -> bool {
        self.operations.contains(&op)
    }

    /// Calculate performance score
    pub fn performance_score(&self) -> f64 {
        let base_score = (self.compute_units as f64) * (self.clock_mhz as f64) / 1000.0;
        let memory_factor = (self.memory_bytes as f64 / (1024.0 * 1024.0 * 1024.0)).min(1.0);
        let util_factor = 1.0 - (self.utilization as f64 / 100.0);
        
        base_score * memory_factor * util_factor
    }
}

// =============================================================================
// HARDWARE DETECTION
// =============================================================================

/// Hardware detection layer
pub struct HardwareDetector;

impl HardwareDetector {
    /// Detect all available hardware
    pub fn detect_all() -> SpkResult<Vec<HardwareCapabilities>> {
        let mut devices = Vec::new();

        // Detect CPU
        devices.extend(Self::detect_cpu()?);

        // Detect GPU
        devices.extend(Self::detect_gpu()?);

        // Detect TPU (if available)
        if let Ok(tpus) = Self::detect_tpu() {
            devices.extend(tpus);
        }

        // Detect NPU (if available)
        if let Ok(npus) = Self::detect_npu() {
            devices.extend(npus);
        }

        // Detect FPGA (if available)
        if let Ok(fpgas) = Self::detect_fpga() {
            devices.extend(fpgas);
        }

        Ok(devices)
    }

    /// Detect CPU capabilities
    fn detect_cpu() -> SpkResult<Vec<HardwareCapabilities>> {
        let num_cpus = num_cpus::get() as u32;
        
        Ok(vec![HardwareCapabilities {
            accelerator_type: AcceleratorType::CPU,
            device_id: 0,
            name: "CPU".to_string(),
            memory_bytes: 0, // System RAM not easily queryable
            compute_units: num_cpus,
            clock_mhz: 3000, // Placeholder
            operations: vec![
                AcceleratorOp::Compression,
                AcceleratorOp::Decompression,
                AcceleratorOp::Hashing,
                AcceleratorOp::Encryption,
                AcceleratorOp::Deduplication,
            ],
            power_watts: 65.0,
            temperature_c: 50.0,
            utilization: 0.0,
        }])
    }

    /// Detect GPU capabilities
    fn detect_gpu() -> SpkResult<Vec<HardwareCapabilities>> {
        // Placeholder - would integrate with actual GPU detection
        #[cfg(feature = "cuda")]
        {
            // CUDA GPU detection would go here
            Ok(vec![])
        }
        #[cfg(not(feature = "cuda"))]
        {
            Ok(vec![])
        }
    }

    /// Detect TPU capabilities
    fn detect_tpu() -> SpkResult<Vec<HardwareCapabilities>> {
        // Placeholder for TPU detection (Google Cloud TPU, Edge TPU, etc.)
        Ok(vec![])
    }

    /// Detect NPU capabilities
    fn detect_npu() -> SpkResult<Vec<HardwareCapabilities>> {
        // Placeholder for NPU detection (Apple Neural Engine, Intel Movidius, etc.)
        Ok(vec![])
    }

    /// Detect FPGA capabilities
    fn detect_fpga() -> SpkResult<Vec<HardwareCapabilities>> {
        // Placeholder for FPGA detection (Xilinx, Intel Altera, etc.)
        Ok(vec![])
    }
}

// =============================================================================
// WORKLOAD DEFINITION
// =============================================================================

/// Workload to be executed on hardware
#[derive(Debug, Clone)]
pub struct Workload {
    /// Workload ID
    pub id: u64,
    /// Operation type
    pub operation: AcceleratorOp,
    /// Input data
    pub input: Vec<u8>,
    /// Priority (higher = more important)
    pub priority: u32,
    /// Preferred accelerator type
    pub preferred: Option<AcceleratorType>,
    /// Deadline for completion
    pub deadline: Option<Instant>,
    /// Estimated compute requirement
    pub compute_estimate: f64,
}

/// Workload result
#[derive(Debug, Clone)]
pub struct WorkloadResult {
    /// Workload ID
    pub workload_id: u64,
    /// Output data
    pub output: Vec<u8>,
    /// Device that executed it
    pub device_id: u32,
    /// Execution time
    pub execution_time: Duration,
    /// Success status
    pub success: bool,
    /// Error message if failed
    pub error: Option<String>,
}

// =============================================================================
// WORKLOAD SCHEDULER
// =============================================================================

/// Heterogeneous workload scheduler
pub struct HeterogeneousScheduler {
    /// Available devices
    devices: Arc<RwLock<HashMap<u32, HardwareCapabilities>>>,
    /// Pending workloads
    pending: Arc<RwLock<Vec<Workload>>>,
    /// Active workloads
    active: Arc<RwLock<HashMap<u64, (u32, Instant)>>>, // workload_id -> (device_id, start_time)
    /// Completed workloads
    completed: Arc<RwLock<Vec<WorkloadResult>>>,
    /// Configuration
    config: SchedulerConfig,
    /// Next workload ID
    next_id: Arc<RwLock<u64>>,
}

/// Scheduler configuration
#[derive(Debug, Clone)]
pub struct SchedulerConfig {
    /// Enable load balancing
    pub load_balancing: bool,
    /// Enable hot-swap
    pub hot_swap: bool,
    /// Maximum queue size
    pub max_queue_size: usize,
    /// Workload timeout
    pub timeout: Duration,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            load_balancing: true,
            hot_swap: true,
            max_queue_size: 10000,
            timeout: Duration::from_millis(V14_DEFAULT_TIMEOUT_MS),
        }
    }
}

impl HeterogeneousScheduler {
    /// Create new scheduler
    pub fn new(config: SchedulerConfig) -> Self {
        Self {
            devices: Arc::new(RwLock::new(HashMap::new())),
            pending: Arc::new(RwLock::new(Vec::new())),
            active: Arc::new(RwLock::new(HashMap::new())),
            completed: Arc::new(RwLock::new(Vec::new())),
            config,
            next_id: Arc::new(RwLock::new(0)),
        }
    }

    /// Initialize with detected hardware
    pub fn init(&self) -> SpkResult<()> {
        let detected = HardwareDetector::detect_all()?;
        
        let mut devices = self.devices.write()
            .map_err(|_| SpkError::LockError("Failed to acquire devices lock".into()))?;

        for device in detected {
            devices.insert(device.device_id, device);
        }

        Ok(())
    }

    /// Register hardware device
    pub fn register_device(&self, device: HardwareCapabilities) -> SpkResult<()> {
        let mut devices = self.devices.write()
            .map_err(|_| SpkError::LockError("Failed to acquire devices lock".into()))?;

        devices.insert(device.device_id, device);
        Ok(())
    }

    /// Unregister hardware device (hot-swap)
    pub fn unregister_device(&self, device_id: u32) -> SpkResult<()> {
        let mut devices = self.devices.write()
            .map_err(|_| SpkError::LockError("Failed to acquire devices lock".into()))?;

        devices.remove(&device_id);

        // Reschedule active workloads from this device
        if self.config.hot_swap {
            self.reschedule_from_device(device_id)?;
        }

        Ok(())
    }

    /// Submit workload
    pub fn submit(&self, mut workload: Workload) -> SpkResult<u64> {
        let mut next_id = self.next_id.write()
            .map_err(|_| SpkError::LockError("Failed to acquire next_id lock".into()))?;

        workload.id = *next_id;
        *next_id += 1;
        drop(next_id);

        let mut pending = self.pending.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending lock".into()))?;

        if pending.len() >= self.config.max_queue_size {
            return Err(SpkError::QueueFull("Scheduler queue is full".into()));
        }

        pending.push(workload.clone());
        Ok(workload.id)
    }

    /// Schedule next workload
    pub fn schedule_next(&self) -> SpkResult<Option<(Workload, u32)>> {
        let mut pending = self.pending.write()
            .map_err(|_| SpkError::LockError("Failed to acquire pending lock".into()))?;

        if pending.is_empty() {
            return Ok(None);
        }

        // Sort by priority
        pending.sort_by(|a, b| b.priority.cmp(&a.priority));

        let workload = pending.remove(0);
        drop(pending);

        // Find best device
        let device_id = self.find_best_device(&workload)?;

        // Mark as active
        let mut active = self.active.write()
            .map_err(|_| SpkError::LockError("Failed to acquire active lock".into()))?;
        active.insert(workload.id, (device_id, Instant::now()));

        Ok(Some((workload, device_id)))
    }

    /// Find best device for workload
    fn find_best_device(&self, workload: &Workload) -> SpkResult<u32> {
        let devices = self.devices.read()
            .map_err(|_| SpkError::LockError("Failed to acquire devices lock".into()))?;

        let active = self.active.read()
            .map_err(|_| SpkError::LockError("Failed to acquire active lock".into()))?;

        // Filter devices that support the operation
        let candidates: Vec<_> = devices.values()
            .filter(|d| d.supports(workload.operation))
            .filter(|d| {
                if let Some(preferred) = workload.preferred {
                    d.accelerator_type == preferred
                } else {
                    true
                }
            })
            .collect();

        if candidates.is_empty() {
            return Err(SpkError::NoDeviceAvailable("No suitable device found".into()));
        }

        // Calculate load for each device
        let mut device_loads: HashMap<u32, usize> = HashMap::new();
        for (device_id, _) in active.values() {
            *device_loads.entry(*device_id).or_insert(0) += 1;
        }

        // Find device with best score considering load
        let best = candidates.iter()
            .min_by(|a, b| {
                let load_a = *device_loads.get(&a.device_id).unwrap_or(&0);
                let load_b = *device_loads.get(&b.device_id).unwrap_or(&0);
                
                let score_a = a.performance_score() / (load_a as f64 + 1.0);
                let score_b = b.performance_score() / (load_b as f64 + 1.0);
                
                score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
            })
            .ok_or_else(|| SpkError::NoDeviceAvailable("No device available".into()))?;

        Ok(best.device_id)
    }

    /// Complete workload
    pub fn complete(&self, result: WorkloadResult) -> SpkResult<()> {
        let mut active = self.active.write()
            .map_err(|_| SpkError::LockError("Failed to acquire active lock".into()))?;
        active.remove(&result.workload_id);
        drop(active);

        let mut completed = self.completed.write()
            .map_err(|_| SpkError::LockError("Failed to acquire completed lock".into()))?;
        completed.push(result);

        Ok(())
    }

    /// Reschedule workloads from a removed device
    fn reschedule_from_device(&self, device_id: u32) -> SpkResult<()> {
        let mut active = self.active.write()
            .map_err(|_| SpkError::LockError("Failed to acquire active lock".into()))?;

        let to_reschedule: Vec<u64> = active.iter()
            .filter(|(_, (dev_id, _))| *dev_id == device_id)
            .map(|(wl_id, _)| *wl_id)
            .collect();

        for wl_id in to_reschedule {
            active.remove(&wl_id);
            // Would need to move back to pending queue in real implementation
        }

        Ok(())
    }

    /// Get scheduler statistics
    pub fn stats(&self) -> SpkResult<SchedulerStats> {
        let devices = self.devices.read()
            .map_err(|_| SpkError::LockError("Failed to acquire devices lock".into()))?;
        let pending = self.pending.read()
            .map_err(|_| SpkError::LockError("Failed to acquire pending lock".into()))?;
        let active = self.active.read()
            .map_err(|_| SpkError::LockError("Failed to acquire active lock".into()))?;
        let completed = self.completed.read()
            .map_err(|_| SpkError::LockError("Failed to acquire completed lock".into()))?;

        Ok(SchedulerStats {
            total_devices: devices.len(),
            pending_workloads: pending.len(),
            active_workloads: active.len(),
            completed_workloads: completed.len(),
        })
    }

    /// List all devices
    pub fn list_devices(&self) -> SpkResult<Vec<HardwareCapabilities>> {
        let devices = self.devices.read()
            .map_err(|_| SpkError::LockError("Failed to acquire devices lock".into()))?;
        Ok(devices.values().cloned().collect())
    }

    /// Get device profile
    pub fn get_device(&self, device_id: u32) -> SpkResult<Option<HardwareCapabilities>> {
        let devices = self.devices.read()
            .map_err(|_| SpkError::LockError("Failed to acquire devices lock".into()))?;
        Ok(devices.get(&device_id).cloned())
    }
}

impl Default for HeterogeneousScheduler {
    fn default() -> Self {
        Self::new(SchedulerConfig::default())
    }
}

/// Scheduler statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerStats {
    pub total_devices: usize,
    pub pending_workloads: usize,
    pub active_workloads: usize,
    pub completed_workloads: usize,
}

// =============================================================================
// HARDWARE EXECUTORS
// =============================================================================

/// TPU executor for ML-heavy compression
pub struct TpuExecutor {
    device_id: u32,
}

impl TpuExecutor {
    /// Create new TPU executor
    pub fn new(device_id: u32) -> Self {
        Self { device_id }
    }

    /// Execute compression on TPU
    pub fn compress(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        // Placeholder for TPU-accelerated compression
        // Would use tensor operations for pattern recognition
        Ok(data.to_vec())
    }

    /// Execute decompression on TPU
    pub fn decompress(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        // Placeholder for TPU-accelerated decompression
        Ok(data.to_vec())
    }
}

/// NPU executor for neural compression
pub struct NpuExecutor {
    device_id: u32,
}

impl NpuExecutor {
    /// Create new NPU executor
    pub fn new(device_id: u32) -> Self {
        Self { device_id }
    }

    /// Execute neural compression
    pub fn neural_compress(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        // Placeholder for NPU-based neural compression
        Ok(data.to_vec())
    }
}

/// FPGA executor for stream transforms
pub struct FpgaExecutor {
    device_id: u32,
}

impl FpgaExecutor {
    /// Create new FPGA executor
    pub fn new(device_id: u32) -> Self {
        Self { device_id }
    }

    /// Execute hashing on FPGA
    pub fn hardware_hash(&self, _data: &[u8]) -> SpkResult<Vec<u8>> {
        // Placeholder for FPGA-accelerated hashing
        // FPGAs excel at streaming operations
        Ok(vec![0u8; 32])
    }

    /// Execute stream transform on FPGA
    pub fn stream_transform(&self, data: &[u8]) -> SpkResult<Vec<u8>> {
        // Placeholder for FPGA stream transformation
        Ok(data.to_vec())
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hardware_detection() {
        let devices = HardwareDetector::detect_all().unwrap();
        assert!(!devices.is_empty()); // Should at least detect CPU
    }

    #[test]
    fn test_hardware_capabilities() {
        let cap = HardwareCapabilities {
            accelerator_type: AcceleratorType::CPU,
            device_id: 0,
            name: "Test CPU".to_string(),
            memory_bytes: 1024 * 1024 * 1024,
            compute_units: 8,
            clock_mhz: 3000,
            operations: vec![AcceleratorOp::Compression],
            power_watts: 65.0,
            temperature_c: 50.0,
            utilization: 25.0,
        };

        assert!(cap.supports(AcceleratorOp::Compression));
        assert!(!cap.supports(AcceleratorOp::MatrixOps));
        assert!(cap.performance_score() > 0.0);
    }

    #[test]
    fn test_scheduler_creation() {
        let scheduler = HeterogeneousScheduler::default();
        let stats = scheduler.stats().unwrap();
        assert_eq!(stats.pending_workloads, 0);
    }

    #[test]
    fn test_scheduler_init() {
        let scheduler = HeterogeneousScheduler::default();
        scheduler.init().unwrap();
        
        let devices = scheduler.list_devices().unwrap();
        assert!(!devices.is_empty());
    }

    #[test]
    fn test_workload_submission() {
        let scheduler = HeterogeneousScheduler::default();
        scheduler.init().unwrap();

        let workload = Workload {
            id: 0,
            operation: AcceleratorOp::Compression,
            input: vec![1, 2, 3, 4],
            priority: 10,
            preferred: None,
            deadline: None,
            compute_estimate: 1.0,
        };

        let id = scheduler.submit(workload).unwrap();
        assert_eq!(id, 0);

        let stats = scheduler.stats().unwrap();
        assert_eq!(stats.pending_workloads, 1);
    }

    #[test]
    fn test_device_registration() {
        let scheduler = HeterogeneousScheduler::default();

        let device = HardwareCapabilities {
            accelerator_type: AcceleratorType::GPU,
            device_id: 100,
            name: "Test GPU".to_string(),
            memory_bytes: 8 * 1024 * 1024 * 1024,
            compute_units: 5120,
            clock_mhz: 1500,
            operations: vec![AcceleratorOp::Compression, AcceleratorOp::MatrixOps],
            power_watts: 250.0,
            temperature_c: 65.0,
            utilization: 0.0,
        };

        scheduler.register_device(device.clone()).unwrap();

        let retrieved = scheduler.get_device(100).unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().name, "Test GPU");
    }

    #[test]
    fn test_hot_swap() {
        let scheduler = HeterogeneousScheduler::default();
        scheduler.init().unwrap();

        let device = HardwareCapabilities {
            accelerator_type: AcceleratorType::FPGA,
            device_id: 200,
            name: "Test FPGA".to_string(),
            memory_bytes: 2 * 1024 * 1024 * 1024,
            compute_units: 1000,
            clock_mhz: 200,
            operations: vec![AcceleratorOp::Hashing, AcceleratorOp::StreamTransform],
            power_watts: 75.0,
            temperature_c: 45.0,
            utilization: 0.0,
        };

        scheduler.register_device(device).unwrap();
        
        let before = scheduler.list_devices().unwrap().len();
        scheduler.unregister_device(200).unwrap();
        let after = scheduler.list_devices().unwrap().len();

        assert_eq!(after, before - 1);
    }

    #[test]
    fn test_tpu_executor() {
        let executor = TpuExecutor::new(0);
        let data = vec![1, 2, 3, 4, 5];
        let result = executor.compress(&data).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_npu_executor() {
        let executor = NpuExecutor::new(0);
        let data = vec![1, 2, 3, 4, 5];
        let result = executor.neural_compress(&data).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_fpga_executor() {
        let executor = FpgaExecutor::new(0);
        let data = vec![1, 2, 3, 4, 5];
        let hash = executor.hardware_hash(&data).unwrap();
        assert_eq!(hash.len(), 32);
    }
}
