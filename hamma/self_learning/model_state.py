"""
HAMMA EXTREME Model State

Maintains learned state across jobs:
- Rolling entropy distributions
- Redundancy cluster fingerprints
- Compression efficiency curves
- Hardware capability maps
- Chunk-size vs throughput graphs

NO user file contents stored - only structural metadata.

Creator: Onazi Treasure (OJ)
"""

import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from collections import deque
import hashlib
import time


# ============================================================================
# Core Data Structures
# ============================================================================

@dataclass
class EntropyDistribution:
    """
    Rolling entropy distribution learned across jobs.
    Tracks how entropy correlates with compression ratios.
    """
    # Entropy buckets (0-8 in 0.5 increments = 17 buckets)
    bucket_counts: np.ndarray = field(default_factory=lambda: np.zeros(17))
    bucket_ratio_sums: np.ndarray = field(default_factory=lambda: np.zeros(17))
    bucket_ratio_squared: np.ndarray = field(default_factory=lambda: np.zeros(17))
    
    # Online statistics
    total_samples: int = 0
    last_update: float = field(default_factory=time.time)
    
    def update(self, entropy: float, actual_ratio: float, weight: float = 1.0):
        """Update distribution with new observation."""
        bucket = min(int(entropy * 2), 16)
        self.bucket_counts[bucket] += weight
        self.bucket_ratio_sums[bucket] += actual_ratio * weight
        self.bucket_ratio_squared[bucket] += (actual_ratio ** 2) * weight
        self.total_samples += 1
        self.last_update = time.time()
    
    def get_expected_ratio(self, entropy: float) -> Tuple[float, float]:
        """Get expected ratio and variance for entropy value."""
        bucket = min(int(entropy * 2), 16)
        count = self.bucket_counts[bucket]
        
        if count < 1:
            # Default estimates based on entropy
            default_ratios = [8.0, 7.0, 6.0, 5.0, 4.0, 3.5, 3.0, 2.5,
                            2.0, 1.8, 1.5, 1.3, 1.2, 1.1, 1.05, 1.02, 1.0]
            return default_ratios[bucket], 0.5
        
        mean = self.bucket_ratio_sums[bucket] / count
        variance = (self.bucket_ratio_squared[bucket] / count) - (mean ** 2)
        variance = max(0.01, variance)
        
        return mean, np.sqrt(variance)
    
    def decay(self, factor: float = 0.99):
        """Apply decay to give more weight to recent observations."""
        self.bucket_counts *= factor
        self.bucket_ratio_sums *= factor
        self.bucket_ratio_squared *= factor


@dataclass
class RedundancyFingerprint:
    """
    Tracks redundancy patterns across jobs.
    Learns which signature patterns indicate high redundancy.
    """
    # SimHash clustering learned patterns
    cluster_signatures: Dict[int, List[int]] = field(default_factory=dict)
    cluster_sizes: Dict[int, int] = field(default_factory=dict)
    cluster_savings: Dict[int, int] = field(default_factory=dict)  # bytes saved
    
    # Pattern statistics
    total_clusters: int = 0
    total_duplicates: int = 0
    total_bytes_saved: int = 0
    
    # Learned signature prefixes that indicate redundancy
    hot_prefixes: Dict[str, float] = field(default_factory=dict)  # prefix -> redundancy rate
    
    def record_cluster(self, cluster_id: int, signature: str, bytes_saved: int):
        """Record a redundancy cluster observation."""
        # Extract prefix for pattern learning
        prefix = signature[:8] if len(signature) >= 8 else signature
        
        # Update cluster stats
        if cluster_id not in self.cluster_sizes:
            self.cluster_sizes[cluster_id] = 0
            self.cluster_savings[cluster_id] = 0
            self.total_clusters += 1
        
        self.cluster_sizes[cluster_id] += 1
        self.cluster_savings[cluster_id] += bytes_saved
        self.total_duplicates += 1
        self.total_bytes_saved += bytes_saved
        
        # Learn prefix patterns
        if prefix not in self.hot_prefixes:
            self.hot_prefixes[prefix] = 0.0
        # Exponential moving average
        self.hot_prefixes[prefix] = 0.9 * self.hot_prefixes[prefix] + 0.1
    
    def predict_redundancy_likelihood(self, signature: str) -> float:
        """Predict likelihood that signature is redundant."""
        prefix = signature[:8] if len(signature) >= 8 else signature
        return self.hot_prefixes.get(prefix, 0.0)
    
    def prune_cold_prefixes(self, threshold: float = 0.01):
        """Remove prefixes with low redundancy rates."""
        self.hot_prefixes = {
            k: v for k, v in self.hot_prefixes.items() if v > threshold
        }


@dataclass
class CompressionCurve:
    """
    Tracks compression efficiency across different parameters.
    Learns optimal settings for different data characteristics.
    """
    # Chunk size -> efficiency mapping
    chunk_size_efficiency: Dict[int, List[float]] = field(default_factory=dict)
    
    # Mode effectiveness: mode -> (ratio_sum, count)
    mode_effectiveness: Dict[str, Tuple[float, int]] = field(default_factory=lambda: {
        'fast': (0.0, 0),
        'strong': (0.0, 0),
        'auto': (0.0, 0),
        'skip-refine': (0.0, 0),
    })
    
    # Refinement level effectiveness: level -> (benefit_sum, count)
    refinement_effectiveness: Dict[int, Tuple[float, int]] = field(default_factory=lambda: {
        0: (0.0, 0),
        1: (0.0, 0),
        2: (0.0, 0),
    })
    
    # Throughput curve: chunk_size -> MB/s
    throughput_curve: Dict[int, float] = field(default_factory=dict)
    
    def record_compression(
        self,
        chunk_size: int,
        mode: str,
        refinement_level: int,
        ratio: float,
        throughput_mbps: float,
    ):
        """Record compression result."""
        # Update chunk size efficiency
        if chunk_size not in self.chunk_size_efficiency:
            self.chunk_size_efficiency[chunk_size] = []
        self.chunk_size_efficiency[chunk_size].append(ratio)
        
        # Limit history
        if len(self.chunk_size_efficiency[chunk_size]) > 1000:
            self.chunk_size_efficiency[chunk_size] = \
                self.chunk_size_efficiency[chunk_size][-500:]
        
        # Update mode effectiveness
        if mode in self.mode_effectiveness:
            current_sum, count = self.mode_effectiveness[mode]
            self.mode_effectiveness[mode] = (current_sum + ratio, count + 1)
        
        # Update refinement effectiveness
        if refinement_level in self.refinement_effectiveness:
            current_sum, count = self.refinement_effectiveness[refinement_level]
            self.refinement_effectiveness[refinement_level] = (current_sum + ratio, count + 1)
        
        # Update throughput curve (exponential moving average)
        if chunk_size not in self.throughput_curve:
            self.throughput_curve[chunk_size] = throughput_mbps
        else:
            self.throughput_curve[chunk_size] = \
                0.9 * self.throughput_curve[chunk_size] + 0.1 * throughput_mbps
    
    def get_optimal_chunk_size(self, target_ratio: float = 2.0) -> int:
        """Get optimal chunk size for target ratio."""
        best_size = 1024 * 1024  # Default 1MB
        best_score = 0.0
        
        for size, ratios in self.chunk_size_efficiency.items():
            if len(ratios) < 10:
                continue
            avg_ratio = sum(ratios) / len(ratios)
            throughput = self.throughput_curve.get(size, 100)
            
            # Score combines ratio achievement and throughput
            score = (avg_ratio / target_ratio) * np.log(throughput + 1)
            
            if score > best_score:
                best_score = score
                best_size = size
        
        return best_size
    
    def get_mode_ranking(self) -> List[Tuple[str, float]]:
        """Get modes ranked by average effectiveness."""
        rankings = []
        for mode, (ratio_sum, count) in self.mode_effectiveness.items():
            if count > 0:
                avg = ratio_sum / count
                rankings.append((mode, avg))
        return sorted(rankings, key=lambda x: -x[1])


@dataclass
class HardwareCapability:
    """
    Learned hardware characteristics for adaptive optimization.
    """
    # CPU characteristics
    cpu_cores: int = 4
    cpu_speed_estimate: float = 1.0  # relative speed factor
    
    # Memory characteristics
    ram_total_mb: int = 4096
    safe_memory_limit_mb: int = 2048
    optimal_concurrency: int = 4
    
    # Disk I/O characteristics
    disk_read_mbps: float = 100.0
    disk_write_mbps: float = 100.0
    
    # Learned limits
    max_stable_chunk_size: int = 4 * 1024 * 1024
    max_stable_concurrency: int = 8
    
    # History of pressure events
    pressure_events: int = 0
    last_pressure_event: float = 0.0
    
    def record_performance(
        self,
        chunk_size: int,
        concurrency: int,
        throughput_mbps: float,
        memory_pressure: float,
        had_error: bool,
    ):
        """Record hardware performance observation."""
        # Update speed estimate
        expected_throughput = 50 * concurrency  # baseline expectation
        self.cpu_speed_estimate = 0.95 * self.cpu_speed_estimate + \
                                  0.05 * (throughput_mbps / expected_throughput)
        
        # Track pressure events
        if memory_pressure > 0.85 or had_error:
            self.pressure_events += 1
            self.last_pressure_event = time.time()
            
            # Reduce limits
            if chunk_size == self.max_stable_chunk_size:
                self.max_stable_chunk_size = max(64 * 1024, chunk_size // 2)
            if concurrency == self.max_stable_concurrency:
                self.max_stable_concurrency = max(1, concurrency - 1)
        
        # Gradually recover limits after stable period
        elif time.time() - self.last_pressure_event > 300:  # 5 minutes stable
            self.max_stable_chunk_size = min(
                16 * 1024 * 1024,
                int(self.max_stable_chunk_size * 1.1)
            )
            self.max_stable_concurrency = min(
                self.cpu_cores * 2,
                self.max_stable_concurrency + 1
            )
    
    def get_safe_settings(self, desired_chunk_size: int, desired_concurrency: int) -> Tuple[int, int]:
        """Get safe settings based on learned limits."""
        safe_chunk = min(desired_chunk_size, self.max_stable_chunk_size)
        safe_concurrency = min(desired_concurrency, self.max_stable_concurrency)
        return safe_chunk, safe_concurrency


# ============================================================================
# Main Model State Container
# ============================================================================

class ModelState:
    """
    Central state container for HAMMA EXTREME self-learning.
    
    Maintains all learned knowledge across jobs without storing
    any user file contents - only structural metadata.
    """
    
    def __init__(self):
        # Core learned distributions
        self.entropy_dist = EntropyDistribution()
        self.redundancy_fp = RedundancyFingerprint()
        self.compression_curve = CompressionCurve()
        self.hardware_cap = HardwareCapability()
        
        # Job history (aggregated stats only)
        self.jobs_completed: int = 0
        self.total_bytes_processed: int = 0
        self.total_bytes_output: int = 0
        self.total_chunks_processed: int = 0
        
        # Prediction accuracy tracking
        self.prediction_errors: deque = deque(maxlen=1000)
        self.prediction_accuracy: float = 0.8
        
        # Learning rate (adapts over time)
        self.learning_rate: float = 0.1
        self.learning_rate_min: float = 0.01
        self.learning_rate_decay: float = 0.9999
        
        # Version for state compatibility
        self.version: str = "1.0.0"
        self.created_at: float = time.time()
        self.last_updated: float = time.time()
    
    def record_prediction(
        self,
        entropy: float,
        predicted_ratio: float,
        actual_ratio: float,
        mode: str,
        refinement_level: int,
        chunk_size: int,
        signature: str,
        was_redundant: bool,
        bytes_saved: int,
        throughput_mbps: float,
        memory_pressure: float,
        had_error: bool,
    ):
        """
        Record a prediction result for learning.
        This is the main learning entry point.
        """
        # Update entropy distribution
        self.entropy_dist.update(entropy, actual_ratio, self.learning_rate)
        
        # Update redundancy fingerprints
        if was_redundant:
            cluster_id = hash(signature[:16]) % 10000
            self.redundancy_fp.record_cluster(cluster_id, signature, bytes_saved)
        
        # Update compression curves
        self.compression_curve.record_compression(
            chunk_size, mode, refinement_level, actual_ratio, throughput_mbps
        )
        
        # Update hardware capabilities
        self.hardware_cap.record_performance(
            chunk_size, 4, throughput_mbps, memory_pressure, had_error
        )
        
        # Track prediction error
        prediction_error = abs(predicted_ratio - actual_ratio) / max(actual_ratio, 0.1)
        self.prediction_errors.append(prediction_error)
        
        # Update accuracy estimate
        if len(self.prediction_errors) > 10:
            avg_error = sum(self.prediction_errors) / len(self.prediction_errors)
            self.prediction_accuracy = max(0.1, 1.0 - avg_error)
        
        # Decay learning rate
        self.learning_rate = max(
            self.learning_rate_min,
            self.learning_rate * self.learning_rate_decay
        )
        
        # Update timestamps
        self.last_updated = time.time()
        self.total_chunks_processed += 1
    
    def record_job_completion(
        self,
        input_bytes: int,
        output_bytes: int,
        chunks_processed: int,
    ):
        """Record completion of a compression job."""
        self.jobs_completed += 1
        self.total_bytes_processed += input_bytes
        self.total_bytes_output += output_bytes
        self.total_chunks_processed += chunks_processed
        
        # Apply decay to distributions
        self.entropy_dist.decay(0.995)
        self.redundancy_fp.prune_cold_prefixes()
        
        self.last_updated = time.time()
    
    def get_prediction_adjustments(self, entropy: float, signature: str) -> Dict[str, float]:
        """
        Get learned adjustments for predictions.
        Returns factors to adjust base predictions.
        """
        # Get learned entropy-ratio relationship
        expected_ratio, std = self.entropy_dist.get_expected_ratio(entropy)
        
        # Get redundancy likelihood
        redundancy_likelihood = self.redundancy_fp.predict_redundancy_likelihood(signature)
        
        # Get mode rankings
        mode_rankings = self.compression_curve.get_mode_ranking()
        
        return {
            'expected_ratio': expected_ratio,
            'ratio_std': std,
            'redundancy_likelihood': redundancy_likelihood,
            'top_mode': mode_rankings[0][0] if mode_rankings else 'auto',
            'prediction_confidence': self.prediction_accuracy,
            'learning_rate': self.learning_rate,
        }
    
    def get_optimal_settings(self) -> Dict[str, Any]:
        """Get current optimal settings based on learning."""
        optimal_chunk = self.compression_curve.get_optimal_chunk_size()
        safe_chunk, safe_concurrency = self.hardware_cap.get_safe_settings(
            optimal_chunk, 8
        )
        
        return {
            'optimal_chunk_size': safe_chunk,
            'optimal_concurrency': safe_concurrency,
            'mode_preference': self.compression_curve.get_mode_ranking(),
            'refinement_effectiveness': self.compression_curve.refinement_effectiveness,
            'hardware_speed_factor': self.hardware_cap.cpu_speed_estimate,
        }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get summary statistics."""
        overall_ratio = 1.0
        if self.total_bytes_output > 0:
            overall_ratio = self.total_bytes_processed / self.total_bytes_output
        
        return {
            'version': self.version,
            'jobs_completed': self.jobs_completed,
            'total_bytes_processed': self.total_bytes_processed,
            'total_bytes_output': self.total_bytes_output,
            'overall_ratio': overall_ratio,
            'total_chunks': self.total_chunks_processed,
            'prediction_accuracy': self.prediction_accuracy,
            'learning_rate': self.learning_rate,
            'redundancy_clusters': self.redundancy_fp.total_clusters,
            'bytes_saved_from_redundancy': self.redundancy_fp.total_bytes_saved,
            'created_at': self.created_at,
            'last_updated': self.last_updated,
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize state to dictionary for persistence."""
        return {
            'version': self.version,
            'created_at': self.created_at,
            'last_updated': self.last_updated,
            'jobs_completed': self.jobs_completed,
            'total_bytes_processed': self.total_bytes_processed,
            'total_bytes_output': self.total_bytes_output,
            'total_chunks_processed': self.total_chunks_processed,
            'prediction_accuracy': self.prediction_accuracy,
            'learning_rate': self.learning_rate,
            'entropy_dist': {
                'bucket_counts': self.entropy_dist.bucket_counts.tolist(),
                'bucket_ratio_sums': self.entropy_dist.bucket_ratio_sums.tolist(),
                'bucket_ratio_squared': self.entropy_dist.bucket_ratio_squared.tolist(),
                'total_samples': self.entropy_dist.total_samples,
            },
            'redundancy_fp': {
                'cluster_sizes': dict(self.redundancy_fp.cluster_sizes),
                'total_clusters': self.redundancy_fp.total_clusters,
                'total_duplicates': self.redundancy_fp.total_duplicates,
                'total_bytes_saved': self.redundancy_fp.total_bytes_saved,
                'hot_prefixes': dict(self.redundancy_fp.hot_prefixes),
            },
            'compression_curve': {
                'mode_effectiveness': dict(self.compression_curve.mode_effectiveness),
                'refinement_effectiveness': dict(self.compression_curve.refinement_effectiveness),
                'throughput_curve': dict(self.compression_curve.throughput_curve),
            },
            'hardware_cap': {
                'cpu_cores': self.hardware_cap.cpu_cores,
                'cpu_speed_estimate': self.hardware_cap.cpu_speed_estimate,
                'ram_total_mb': self.hardware_cap.ram_total_mb,
                'max_stable_chunk_size': self.hardware_cap.max_stable_chunk_size,
                'max_stable_concurrency': self.hardware_cap.max_stable_concurrency,
                'pressure_events': self.hardware_cap.pressure_events,
            },
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ModelState':
        """Deserialize state from dictionary."""
        state = cls()
        
        state.version = data.get('version', '1.0.0')
        state.created_at = data.get('created_at', time.time())
        state.last_updated = data.get('last_updated', time.time())
        state.jobs_completed = data.get('jobs_completed', 0)
        state.total_bytes_processed = data.get('total_bytes_processed', 0)
        state.total_bytes_output = data.get('total_bytes_output', 0)
        state.total_chunks_processed = data.get('total_chunks_processed', 0)
        state.prediction_accuracy = data.get('prediction_accuracy', 0.8)
        state.learning_rate = data.get('learning_rate', 0.1)
        
        # Restore entropy distribution
        if 'entropy_dist' in data:
            ed = data['entropy_dist']
            state.entropy_dist.bucket_counts = np.array(ed.get('bucket_counts', np.zeros(17)))
            state.entropy_dist.bucket_ratio_sums = np.array(ed.get('bucket_ratio_sums', np.zeros(17)))
            state.entropy_dist.bucket_ratio_squared = np.array(ed.get('bucket_ratio_squared', np.zeros(17)))
            state.entropy_dist.total_samples = ed.get('total_samples', 0)
        
        # Restore redundancy fingerprints
        if 'redundancy_fp' in data:
            rf = data['redundancy_fp']
            state.redundancy_fp.cluster_sizes = {int(k): v for k, v in rf.get('cluster_sizes', {}).items()}
            state.redundancy_fp.total_clusters = rf.get('total_clusters', 0)
            state.redundancy_fp.total_duplicates = rf.get('total_duplicates', 0)
            state.redundancy_fp.total_bytes_saved = rf.get('total_bytes_saved', 0)
            state.redundancy_fp.hot_prefixes = rf.get('hot_prefixes', {})
        
        # Restore compression curve
        if 'compression_curve' in data:
            cc = data['compression_curve']
            state.compression_curve.mode_effectiveness = {
                k: tuple(v) for k, v in cc.get('mode_effectiveness', {}).items()
            }
            state.compression_curve.refinement_effectiveness = {
                int(k): tuple(v) for k, v in cc.get('refinement_effectiveness', {}).items()
            }
            state.compression_curve.throughput_curve = {
                int(k): v for k, v in cc.get('throughput_curve', {}).items()
            }
        
        # Restore hardware capabilities
        if 'hardware_cap' in data:
            hc = data['hardware_cap']
            state.hardware_cap.cpu_cores = hc.get('cpu_cores', 4)
            state.hardware_cap.cpu_speed_estimate = hc.get('cpu_speed_estimate', 1.0)
            state.hardware_cap.ram_total_mb = hc.get('ram_total_mb', 4096)
            state.hardware_cap.max_stable_chunk_size = hc.get('max_stable_chunk_size', 4 * 1024 * 1024)
            state.hardware_cap.max_stable_concurrency = hc.get('max_stable_concurrency', 8)
            state.hardware_cap.pressure_events = hc.get('pressure_events', 0)
        
        return state
