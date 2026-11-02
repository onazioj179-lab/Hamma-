"""
HAMMA Stability Model

Analyzes memory, worker timing, and system state to prevent overload.
Throttles system when needed, ensures safe operation on 1GB devices.

Creator: Onazi Treasure (OJ)
"""

from typing import Tuple, Optional, Literal
from dataclasses import dataclass


@dataclass  
class MemoryTarget:
    chunk_size: int
    concurrency: int


class StabilityModel:
    """
    Stability assessment and resource management.
    
    Monitors:
    - Memory pressure
    - Worker timing variance
    - Error rates
    - Device thermal state
    
    Provides:
    - Stability flags (safe/warning/critical)
    - Memory optimization targets
    - Lane boost recommendations
    """
    
    def __init__(self):
        # Memory thresholds
        self._memory_safe = 0.5       # Under 50% = safe
        self._memory_warning = 0.7    # 50-70% = warning
        self._memory_critical = 0.85  # Over 85% = critical
        
        # Chunk size recommendations (in bytes)
        self._chunk_sizes = {
            "critical": 64 * 1024,      # 64KB for critical memory
            "warning": 256 * 1024,      # 256KB for warning
            "safe": 1024 * 1024,        # 1MB for safe
            "optimal": 4 * 1024 * 1024, # 4MB when plenty of RAM
        }
        
        # Concurrency recommendations
        self._concurrency = {
            "critical": 1,    # Single worker
            "warning": 2,     # Reduced parallelism
            "safe": 4,        # Normal parallelism
            "optimal": 8,     # Full parallelism
        }
        
        # Worker timing thresholds
        self._timing_variance_threshold = 2.0  # 2x average = unstable
        
        # Stats
        self._predictions = 0
        self._stability_counts = {"safe": 0, "warning": 0, "critical": 0}
    
    def predict(
        self,
        device_profile: Optional[object],
        worker_stats: Optional[object],
        chunk_size: int,
    ) -> Tuple[
        Literal["safe", "warning", "critical"],
        MemoryTarget,
        bool,
    ]:
        """
        Assess system stability and provide recommendations.
        
        Returns:
            Tuple of (stability_flag, memory_target, lane_boost)
        """
        self._predictions += 1
        
        # Extract device info
        ram_pressure = 0.5
        ram_available_mb = 2048
        cpu_cores = 4
        is_mobile = False
        is_throttled = False
        
        if device_profile:
            ram_pressure = getattr(device_profile, 'ram_pressure', 0.5)
            ram_available_mb = getattr(device_profile, 'ram_available_mb', 2048)
            cpu_cores = getattr(device_profile, 'cpu_cores', 4)
            is_mobile = getattr(device_profile, 'is_mobile', False)
            is_throttled = getattr(device_profile, 'is_throttled', False)
        
        # Worker analysis
        worker_unstable = False
        high_error_rate = False
        
        if worker_stats:
            last_time = getattr(worker_stats, 'last_chunk_time_ms', 0)
            avg_time = getattr(worker_stats, 'avg_chunk_time_ms', 1)
            error_count = getattr(worker_stats, 'error_count', 0)
            chunks_processed = getattr(worker_stats, 'chunks_processed', 1)
            
            # Check timing variance
            if avg_time > 0 and last_time > avg_time * self._timing_variance_threshold:
                worker_unstable = True
            
            # Check error rate
            error_rate = error_count / max(chunks_processed, 1)
            if error_rate > 0.05:  # More than 5% errors
                high_error_rate = True
        
        # Determine stability flag
        stability = self._assess_stability(
            ram_pressure, worker_unstable, high_error_rate, is_throttled
        )
        
        # Determine memory target
        memory_target = self._get_memory_target(
            stability, ram_available_mb, cpu_cores, is_mobile
        )
        
        # Determine lane boost
        lane_boost = self._should_lane_boost(
            stability, ram_pressure, worker_unstable, cpu_cores
        )
        
        self._stability_counts[stability] += 1
        
        return (stability, memory_target, lane_boost)
    
    def _assess_stability(
        self,
        ram_pressure: float,
        worker_unstable: bool,
        high_error_rate: bool,
        is_throttled: bool,
    ) -> Literal["safe", "warning", "critical"]:
        """Assess overall stability"""
        
        # Critical conditions
        if ram_pressure >= self._memory_critical:
            return "critical"
        if is_throttled and ram_pressure > self._memory_warning:
            return "critical"
        if high_error_rate:
            return "critical"
        
        # Warning conditions
        if ram_pressure >= self._memory_warning:
            return "warning"
        if worker_unstable:
            return "warning"
        if is_throttled:
            return "warning"
        
        return "safe"
    
    def _get_memory_target(
        self,
        stability: Literal["safe", "warning", "critical"],
        ram_available_mb: int,
        cpu_cores: int,
        is_mobile: bool,
    ) -> MemoryTarget:
        """Calculate optimal memory target"""
        
        # Base chunk size on stability
        if stability == "critical":
            chunk_size = self._chunk_sizes["critical"]
            concurrency = self._concurrency["critical"]
        elif stability == "warning":
            chunk_size = self._chunk_sizes["warning"]
            concurrency = self._concurrency["warning"]
        else:
            # Safe - optimize based on available resources
            if ram_available_mb > 4096:
                chunk_size = self._chunk_sizes["optimal"]
                concurrency = min(cpu_cores, self._concurrency["optimal"])
            else:
                chunk_size = self._chunk_sizes["safe"]
                concurrency = min(cpu_cores, self._concurrency["safe"])
        
        # Mobile adjustments
        if is_mobile:
            chunk_size = min(chunk_size, 512 * 1024)  # Max 512KB on mobile
            concurrency = min(concurrency, 2)
        
        # Low memory adjustments
        if ram_available_mb < 1024:  # Less than 1GB available
            chunk_size = min(chunk_size, 64 * 1024)  # 64KB max
            concurrency = 1
        elif ram_available_mb < 2048:  # Less than 2GB
            chunk_size = min(chunk_size, 256 * 1024)  # 256KB max
            concurrency = min(concurrency, 2)
        
        return MemoryTarget(
            chunk_size=chunk_size,
            concurrency=concurrency,
        )
    
    def _should_lane_boost(
        self,
        stability: Literal["safe", "warning", "critical"],
        ram_pressure: float,
        worker_unstable: bool,
        cpu_cores: int,
    ) -> bool:
        """Determine if lane boost should be enabled"""
        
        # Never boost in critical or warning state
        if stability != "safe":
            return False
        
        # Don't boost if workers are unstable
        if worker_unstable:
            return False
        
        # Boost if we have plenty of resources
        if ram_pressure < 0.3 and cpu_cores >= 4:
            return True
        
        return False
    
    def get_stats(self) -> dict:
        """Get model statistics"""
        return {
            "predictions": self._predictions,
            "stability_distribution": dict(self._stability_counts),
        }


class LowMemoryStabilityModel(StabilityModel):
    """
    Specialized stability model for 1GB devices.
    
    Extra conservative with memory management.
    Target: <50MB HAMMA footprint.
    """
    
    def __init__(self):
        super().__init__()
        
        # Tighter thresholds for low-memory
        self._memory_safe = 0.3       # Under 30% = safe
        self._memory_warning = 0.5    # 30-50% = warning  
        self._memory_critical = 0.7   # Over 70% = critical
        
        # Smaller chunk sizes
        self._chunk_sizes = {
            "critical": 16 * 1024,      # 16KB
            "warning": 32 * 1024,       # 32KB
            "safe": 64 * 1024,          # 64KB
            "optimal": 128 * 1024,      # 128KB max
        }
        
        # Reduced concurrency
        self._concurrency = {
            "critical": 1,
            "warning": 1,
            "safe": 2,
            "optimal": 2,
        }
