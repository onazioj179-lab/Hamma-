"""
HAMMA Request/Response Schemas

Pydantic models for API validation.
All inputs are metadata-only - no file content.

Creator: Onazi Treasure (OJ)
"""

from typing import Optional, List, Literal
from pydantic import BaseModel, Field


# ============================================================================
# Input Schemas - Metadata Only
# ============================================================================

class ChunkMetadata(BaseModel):
    """Metadata for a single chunk - NO raw content"""
    chunk_index: int = Field(..., ge=0, description="Index of chunk in sequence")
    chunk_size: int = Field(..., ge=0, description="Original size in bytes")
    compressed_size: Optional[int] = Field(None, ge=0, description="Compressed size if available")
    entropy_score: float = Field(..., ge=0, le=8, description="Shannon entropy 0-8")
    redundancy_signature: str = Field(..., description="Hash signature for dedup detection")
    histogram: List[int] = Field(default_factory=list, description="Byte frequency histogram (256 bins)")


class WorkerStats(BaseModel):
    """Worker timing and performance stats"""
    worker_id: int = Field(..., ge=0)
    last_chunk_time_ms: float = Field(..., ge=0)
    avg_chunk_time_ms: float = Field(..., ge=0)
    chunks_processed: int = Field(..., ge=0)
    error_count: int = Field(0, ge=0)
    pass_success_rate: float = Field(1.0, ge=0, le=1)


class DeviceProfile(BaseModel):
    """Device resource profile"""
    cpu_cores: int = Field(4, ge=1)
    ram_total_mb: int = Field(4096, ge=512)
    ram_available_mb: int = Field(2048, ge=0)
    ram_pressure: float = Field(0.5, ge=0, le=1, description="0=low, 1=critical")
    is_throttled: bool = Field(False)
    is_mobile: bool = Field(False)
    is_low_power: bool = Field(False)


class PartitionInfo(BaseModel):
    """Partition-level context"""
    partition_index: int = Field(0, ge=0)
    total_partitions: int = Field(1, ge=1)
    partition_size_bytes: int = Field(0, ge=0)
    chunks_in_partition: int = Field(0, ge=0)


class HistoricalPerformance(BaseModel):
    """Historical compression performance"""
    avg_compression_ratio: float = Field(1.0, ge=0)
    avg_throughput_mbps: float = Field(0, ge=0)
    refinement_success_rate: float = Field(0.5, ge=0, le=1)
    total_chunks_processed: int = Field(0, ge=0)
    total_bytes_saved: int = Field(0, ge=0)


class PredictionRequest(BaseModel):
    """
    Full prediction request - metadata only
    
    HAMMA receives ONLY metadata:
    - chunk size, compressed length, entropy score
    - redundancy signature, histogram
    - worker timing stats, pass success/failure
    - CPU/RAM profile, device throttle state
    - historical performance, partition info, chunk index
    
    NO raw file bytes or content.
    """
    chunk: ChunkMetadata
    worker_stats: Optional[WorkerStats] = None
    device_profile: Optional[DeviceProfile] = None
    partition_info: Optional[PartitionInfo] = None
    history: Optional[HistoricalPerformance] = None
    
    # Batch context
    batch_size: int = Field(1, ge=1)
    batch_index: int = Field(0, ge=0)


class BatchPredictionRequest(BaseModel):
    """Batch prediction for multiple chunks"""
    chunks: List[ChunkMetadata]
    worker_stats: Optional[WorkerStats] = None
    device_profile: Optional[DeviceProfile] = None
    partition_info: Optional[PartitionInfo] = None
    history: Optional[HistoricalPerformance] = None


# ============================================================================
# Output Schemas
# ============================================================================

class MemoryTarget(BaseModel):
    """Memory optimization targets"""
    chunk_size: int = Field(..., ge=1024, description="Recommended chunk size")
    concurrency: int = Field(..., ge=1, description="Recommended worker count")


class PredictionResponse(BaseModel):
    """
    HAMMA prediction output
    
    Optimization instructions for SPK coordinator.
    """
    chunk_mode: Literal["fast", "strong", "auto", "skip-refine"] = Field(
        ..., description="Recommended compression mode"
    )
    refinement_level: Literal[0, 1, 2] = Field(
        ..., description="0=none, 1=light, 2=aggressive"
    )
    lane_boost: bool = Field(
        ..., description="Whether to increase parallelism"
    )
    expected_ratio: float = Field(
        ..., ge=0, description="Predicted compression ratio"
    )
    stability_flag: Literal["safe", "warning", "critical"] = Field(
        ..., description="System stability assessment"
    )
    memory_target: MemoryTarget
    anomaly_detected: bool = Field(
        ..., description="Whether chunk behavior is anomalous"
    )
    
    # Optional additional insights
    confidence: float = Field(0.8, ge=0, le=1, description="Prediction confidence")
    redundancy_cluster: Optional[int] = Field(None, description="Cluster ID if redundant")


class BatchPredictionResponse(BaseModel):
    """Batch prediction response"""
    predictions: List[PredictionResponse]
    batch_stats: dict = Field(default_factory=dict)


class HealthResponse(BaseModel):
    """Health check response"""
    status: Literal["healthy", "degraded", "unhealthy"]
    version: str
    uptime_seconds: float
    requests_processed: int
    avg_latency_ms: float
    models_loaded: List[str]


class ProfileResponse(BaseModel):
    """Profiling endpoint response"""
    cpu_percent: float
    memory_mb: float
    active_requests: int
    model_stats: dict
