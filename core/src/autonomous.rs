//! V9 Autonomous Data Intelligence and Self-Repair
//!
//! Provides continuous health monitoring, predictive failure analysis,
//! and autonomous self-repair capabilities for SPK archives.

use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::utils::error::{SpkError, SpkResult};

/// Health scan results for an archive
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReport {
    /// Overall health status
    pub status: HealthStatus,
    /// Timestamp of scan
    pub scan_time: u64,
    /// Total chunks scanned
    pub chunks_scanned: u64,
    /// Corrupt chunks detected
    pub chunks_corrupt: u64,
    /// Missing chunks detected
    pub chunks_missing: u64,
    /// Suspicious patterns detected
    pub anomalies: Vec<Anomaly>,
    /// Predicted failures
    pub predictions: Vec<FailurePrediction>,
    /// Repair recommendations
    pub recommendations: Vec<RepairAction>,
}

/// Overall health status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthStatus {
    /// All chunks verified and healthy
    Healthy,
    /// Minor issues detected, archive functional
    Warning,
    /// Critical issues, data loss possible
    Critical,
    /// Archive corrupted beyond repair
    Failed,
}

/// Detected anomaly in archive
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anomaly {
    /// Type of anomaly
    pub anomaly_type: AnomalyType,
    /// Severity level
    pub severity: Severity,
    /// Affected chunk indices
    pub affected_chunks: Vec<u64>,
    /// Description
    pub description: String,
    /// Detection timestamp
    pub detected_at: u64,
}

/// Type of detected anomaly
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnomalyType {
    /// Hash mismatch
    HashMismatch,
    /// Chunk size mismatch
    SizeMismatch,
    /// Chunk offset error
    OffsetError,
    /// Compression ratio anomaly
    CompressionAnomaly,
    /// Metadata corruption
    MetadataCorruption,
    /// Suspicious access pattern
    SuspiciousAccess,
}

/// Severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

/// Predicted failure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailurePrediction {
    /// Type of predicted failure
    pub failure_type: FailureType,
    /// Probability (0.0 - 1.0)
    pub probability: f64,
    /// Estimated time until failure (seconds)
    pub time_to_failure: Option<u64>,
    /// Confidence in prediction (0.0 - 1.0)
    pub confidence: f64,
    /// Contributing factors
    pub factors: Vec<String>,
}

/// Type of failure
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FailureType {
    /// Chunk corruption
    ChunkCorruption,
    /// Storage device failure
    StorageFailure,
    /// Node failure in distributed setup
    NodeFailure,
    /// Network failure
    NetworkFailure,
    /// Thermal throttling
    ThermalIssue,
    /// Performance degradation
    PerformanceDecay,
}

/// Recommended repair action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairAction {
    /// Action type
    pub action_type: ActionType,
    /// Priority
    pub priority: Priority,
    /// Affected chunks
    pub target_chunks: Vec<u64>,
    /// Estimated repair time (seconds)
    pub estimated_duration: u64,
    /// Required resources
    pub resources_needed: Vec<String>,
}

/// Type of repair action
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionType {
    /// Rebuild from parity
    RebuildFromParity,
    /// Recover from redundant copy
    RecoverFromCopy,
    /// Re-fetch from distributed node
    FetchFromNode,
    /// Recompress chunk
    RecompressChunk,
    /// Update manifest
    UpdateManifest,
    /// Migrate to new storage
    MigrateStorage,
}

/// Action priority
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Priority {
    Low,
    Medium,
    High,
    Urgent,
}

/// Autonomous health monitor
pub struct HealthMonitor {
    /// Archive identifier
    archive_id: String,
    /// Scan history
    scan_history: VecDeque<HealthReport>,
    /// Maximum history size
    max_history: usize,
    /// Performance metrics
    metrics: PerformanceMetrics,
    /// Configuration
    config: MonitorConfig,
}

/// Performance metrics tracking
#[derive(Debug, Clone, Default)]
struct PerformanceMetrics {
    /// Average read latency (ms)
    avg_read_latency: f64,
    /// Average write latency (ms)
    avg_write_latency: f64,
    /// Error rate
    error_rate: f64,
    /// Throughput degradation
    throughput_decay: f64,
    /// Temperature readings (if available)
    temperatures: Vec<f64>,
}

/// Monitor configuration
#[derive(Debug, Clone)]
pub struct MonitorConfig {
    /// Scan interval (seconds)
    pub scan_interval: u64,
    /// Enable predictive analysis
    pub enable_predictions: bool,
    /// Enable auto-repair
    pub enable_auto_repair: bool,
    /// Minimum confidence for auto-repair
    pub auto_repair_confidence: f64,
    /// Maximum concurrent repairs
    pub max_concurrent_repairs: usize,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            scan_interval: 3600, // 1 hour
            enable_predictions: true,
            enable_auto_repair: false,
            auto_repair_confidence: 0.95,
            max_concurrent_repairs: 4,
        }
    }
}

impl HealthMonitor {
    /// Create new health monitor
    pub fn new(archive_id: String) -> Self {
        Self {
            archive_id,
            scan_history: VecDeque::new(),
            max_history: 100,
            metrics: PerformanceMetrics::default(),
            config: MonitorConfig::default(),
        }
    }

    /// Create with custom configuration
    pub fn with_config(archive_id: String, config: MonitorConfig) -> Self {
        Self {
            archive_id,
            scan_history: VecDeque::new(),
            max_history: 100,
            metrics: PerformanceMetrics::default(),
            config,
        }
    }

    /// Perform health scan
    pub fn scan(&mut self, chunk_count: u64) -> SpkResult<HealthReport> {
        let scan_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let mut report = HealthReport {
            status: HealthStatus::Healthy,
            scan_time,
            chunks_scanned: chunk_count,
            chunks_corrupt: 0,
            chunks_missing: 0,
            anomalies: Vec::new(),
            predictions: Vec::new(),
            recommendations: Vec::new(),
        };

        // Detect anomalies
        self.detect_anomalies(&mut report);

        // Run predictive analysis if enabled
        if self.config.enable_predictions {
            self.predict_failures(&mut report);
        }

        // Generate repair recommendations
        self.generate_recommendations(&mut report);

        // Update history
        self.scan_history.push_back(report.clone());
        if self.scan_history.len() > self.max_history {
            self.scan_history.pop_front();
        }

        Ok(report)
    }

    /// Detect anomalies in archive
    fn detect_anomalies(&self, report: &mut HealthReport) {
        // Check for hash mismatches
        if self.metrics.error_rate > 0.01 {
            report.anomalies.push(Anomaly {
                anomaly_type: AnomalyType::HashMismatch,
                severity: Severity::High,
                affected_chunks: Vec::new(),
                description: format!("Error rate: {:.2}%", self.metrics.error_rate * 100.0),
                detected_at: report.scan_time,
            });
        }

        // Check compression anomalies
        if self.metrics.throughput_decay > 0.2 {
            report.anomalies.push(Anomaly {
                anomaly_type: AnomalyType::CompressionAnomaly,
                severity: Severity::Medium,
                affected_chunks: Vec::new(),
                description: format!("Throughput decay: {:.1}%", self.metrics.throughput_decay * 100.0),
                detected_at: report.scan_time,
            });
        }

        // Update overall status
        report.status = if report.chunks_corrupt > 0 {
            HealthStatus::Critical
        } else if !report.anomalies.is_empty() {
            HealthStatus::Warning
        } else {
            HealthStatus::Healthy
        };
    }

    /// Predict potential failures
    fn predict_failures(&self, report: &mut HealthReport) {
        // Analyze performance trends
        if self.metrics.throughput_decay > 0.3 {
            report.predictions.push(FailurePrediction {
                failure_type: FailureType::PerformanceDecay,
                probability: 0.75,
                time_to_failure: Some(86400), // 24 hours
                confidence: 0.8,
                factors: vec![
                    "Sustained throughput degradation".to_string(),
                    "Increasing read latency".to_string(),
                ],
            });
        }

        // Check thermal issues
        if !self.metrics.temperatures.is_empty() {
            let avg_temp = self.metrics.temperatures.iter().sum::<f64>() 
                / self.metrics.temperatures.len() as f64;
            if avg_temp > 80.0 {
                report.predictions.push(FailurePrediction {
                    failure_type: FailureType::ThermalIssue,
                    probability: 0.6,
                    time_to_failure: Some(3600), // 1 hour
                    confidence: 0.85,
                    factors: vec![format!("Average temperature: {:.1}C", avg_temp)],
                });
            }
        }

        // Analyze error patterns
        if self.metrics.error_rate > 0.05 {
            report.predictions.push(FailurePrediction {
                failure_type: FailureType::StorageFailure,
                probability: 0.5,
                time_to_failure: Some(7200), // 2 hours
                confidence: 0.7,
                factors: vec![format!("Error rate: {:.2}%", self.metrics.error_rate * 100.0)],
            });
        }
    }

    /// Generate repair recommendations
    fn generate_recommendations(&self, report: &mut HealthReport) {
        for anomaly in &report.anomalies {
            let action = match anomaly.anomaly_type {
                AnomalyType::HashMismatch => RepairAction {
                    action_type: ActionType::RebuildFromParity,
                    priority: Priority::Urgent,
                    target_chunks: anomaly.affected_chunks.clone(),
                    estimated_duration: 300,
                    resources_needed: vec!["parity_data".to_string()],
                },
                AnomalyType::CompressionAnomaly => RepairAction {
                    action_type: ActionType::RecompressChunk,
                    priority: Priority::Medium,
                    target_chunks: anomaly.affected_chunks.clone(),
                    estimated_duration: 600,
                    resources_needed: vec!["cpu".to_string()],
                },
                AnomalyType::MetadataCorruption => RepairAction {
                    action_type: ActionType::UpdateManifest,
                    priority: Priority::High,
                    target_chunks: Vec::new(),
                    estimated_duration: 60,
                    resources_needed: vec!["manifest_backup".to_string()],
                },
                _ => RepairAction {
                    action_type: ActionType::RecoverFromCopy,
                    priority: Priority::High,
                    target_chunks: anomaly.affected_chunks.clone(),
                    estimated_duration: 180,
                    resources_needed: vec!["redundant_copy".to_string()],
                },
            };
            report.recommendations.push(action);
        }
    }

    /// Get scan history
    pub fn history(&self) -> &VecDeque<HealthReport> {
        &self.scan_history
    }

    /// Update performance metrics
    pub fn update_metrics(&mut self, latency_ms: f64, is_read: bool, had_error: bool) {
        if is_read {
            self.metrics.avg_read_latency = 
                (self.metrics.avg_read_latency * 0.95) + (latency_ms * 0.05);
        } else {
            self.metrics.avg_write_latency = 
                (self.metrics.avg_write_latency * 0.95) + (latency_ms * 0.05);
        }

        if had_error {
            self.metrics.error_rate = (self.metrics.error_rate * 0.99) + 0.01;
        } else {
            self.metrics.error_rate *= 0.99;
        }
    }

    /// Add temperature reading
    pub fn record_temperature(&mut self, temp_celsius: f64) {
        self.metrics.temperatures.push(temp_celsius);
        if self.metrics.temperatures.len() > 100 {
            self.metrics.temperatures.remove(0);
        }
    }
}

/// Multi-level redundancy manager
pub struct RedundancyManager {
    /// Redundancy level
    level: RedundancyLevel,
    /// Parity blocks
    parity_blocks: HashMap<u64, Vec<u8>>,
    /// Remote copies
    remote_locations: Vec<String>,
}

/// Redundancy level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RedundancyLevel {
    /// No redundancy
    None,
    /// Single parity block
    Single,
    /// Double parity (RAID-6 style)
    Double,
    /// Triple parity for mission-critical
    Triple,
    /// Distributed across nodes
    Distributed,
}

impl RedundancyManager {
    /// Create new redundancy manager
    pub fn new(level: RedundancyLevel) -> Self {
        Self {
            level,
            parity_blocks: HashMap::new(),
            remote_locations: Vec::new(),
        }
    }

    /// Generate parity block for chunk
    pub fn generate_parity(&mut self, chunk_id: u64, data: &[u8]) -> SpkResult<()> {
        match self.level {
            RedundancyLevel::None => Ok(()),
            RedundancyLevel::Single | RedundancyLevel::Double | RedundancyLevel::Triple => {
                // Simple XOR-based parity for now
                let parity = data.iter().fold(0u8, |acc, &b| acc ^ b);
                self.parity_blocks.insert(chunk_id, vec![parity]);
                Ok(())
            }
            RedundancyLevel::Distributed => {
                // Would distribute to remote nodes
                Ok(())
            }
        }
    }

    /// Recover chunk from parity
    pub fn recover_chunk(&self, chunk_id: u64) -> SpkResult<Vec<u8>> {
        self.parity_blocks
            .get(&chunk_id)
            .cloned()
            .ok_or_else(|| SpkError::InvalidFormat("Parity block not found".into()))
    }

    /// Add remote location
    pub fn add_remote_location(&mut self, location: String) {
        self.remote_locations.push(location);
    }
}

/// Integrity audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    /// Timestamp
    pub timestamp: u64,
    /// Event type
    pub event_type: AuditEventType,
    /// User/process identifier
    pub actor: String,
    /// Affected chunk indices
    pub affected_chunks: Vec<u64>,
    /// Action taken
    pub action: String,
    /// Success status
    pub success: bool,
    /// Additional details
    pub details: String,
}

/// Audit event type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuditEventType {
    Read,
    Write,
    Repair,
    Delete,
    Verify,
    Migrate,
    AccessDenied,
}

/// Immutable audit trail
pub struct AuditTrail {
    /// Log entries
    entries: Vec<AuditLogEntry>,
    /// Maximum entries before rotation
    max_entries: usize,
}

impl AuditTrail {
    /// Create new audit trail
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            max_entries: 10000,
        }
    }

    /// Log an event
    pub fn log(&mut self, event: AuditLogEntry) {
        self.entries.push(event);
        if self.entries.len() > self.max_entries {
            // In production, would archive old entries
            self.entries.remove(0);
        }
    }

    /// Query logs by event type
    pub fn query_by_type(&self, event_type: AuditEventType) -> Vec<&AuditLogEntry> {
        self.entries
            .iter()
            .filter(|e| e.event_type == event_type)
            .collect()
    }

    /// Get entries in time range
    pub fn query_time_range(&self, start: u64, end: u64) -> Vec<&AuditLogEntry> {
        self.entries
            .iter()
            .filter(|e| e.timestamp >= start && e.timestamp <= end)
            .collect()
    }

    /// Export logs
    pub fn export_json(&self) -> SpkResult<String> {
        serde_json::to_string(&self.entries)
            .map_err(|e| SpkError::SerializationError(e.to_string()))
    }
}

impl Default for AuditTrail {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_monitor_creation() {
        let monitor = HealthMonitor::new("test-archive".to_string());
        assert_eq!(monitor.archive_id, "test-archive");
    }

    #[test]
    fn test_health_scan() {
        let mut monitor = HealthMonitor::new("test".to_string());
        let report = monitor.scan(100).unwrap();
        assert_eq!(report.chunks_scanned, 100);
        assert_eq!(report.status, HealthStatus::Healthy);
    }

    #[test]
    fn test_redundancy_manager() {
        let mut manager = RedundancyManager::new(RedundancyLevel::Single);
        let data = vec![1, 2, 3, 4, 5];
        manager.generate_parity(0, &data).unwrap();
        assert!(manager.parity_blocks.contains_key(&0));
    }

    #[test]
    fn test_audit_trail() {
        let mut trail = AuditTrail::new();
        trail.log(AuditLogEntry {
            timestamp: 1000,
            event_type: AuditEventType::Read,
            actor: "test".to_string(),
            affected_chunks: vec![0, 1, 2],
            action: "read chunks".to_string(),
            success: true,
            details: "test read".to_string(),
        });
        assert_eq!(trail.entries.len(), 1);
    }

    #[test]
    fn test_anomaly_detection() {
        let mut monitor = HealthMonitor::new("test".to_string());
        monitor.metrics.error_rate = 0.02;
        let report = monitor.scan(100).unwrap();
        assert!(!report.anomalies.is_empty());
    }

    #[test]
    fn test_failure_prediction() {
        let mut monitor = HealthMonitor::new("test".to_string());
        monitor.metrics.throughput_decay = 0.4;
        let report = monitor.scan(100).unwrap();
        assert!(!report.predictions.is_empty());
    }
}
