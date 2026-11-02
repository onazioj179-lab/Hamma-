"""
HAMMA EXTREME Ratio Controller

Pushes compression toward theoretical limits for redundant datasets.
Target: 10TB → ~1GB when redundancy permits.

Creator: Onazi Treasure (OJ)
"""

import math
from typing import Dict, Optional, Any, Tuple, List
from dataclasses import dataclass, field
from collections import deque
import time


# ============================================================================
# Compression Goal Configuration
# ============================================================================

@dataclass
class CompressionGoal:
    """
    Defines a compression target with constraints.
    """
    # Target ratio (output_size / input_size)
    target_ratio: float  # e.g., 0.0001 for 10000x compression
    
    # Acceptable range
    min_acceptable_ratio: float
    max_acceptable_ratio: float
    
    # Time constraints
    max_time_per_gb: float = 60.0  # seconds
    
    # Memory constraints
    max_memory_mb: int = 1024  # 1GB limit
    
    # Quality constraints
    min_integrity: float = 1.0  # Always require full integrity
    
    def __post_init__(self):
        # Ensure min <= target <= max
        if self.min_acceptable_ratio > self.target_ratio:
            self.min_acceptable_ratio = self.target_ratio
        if self.max_acceptable_ratio < self.target_ratio:
            self.max_acceptable_ratio = self.target_ratio


@dataclass
class ExtremeSettings:
    """
    Settings for extreme compression mode.
    """
    # Refinement depth (0-10, higher = more aggressive)
    desired_refinement_depth: int = 5
    
    # Chunk mode bias: 'aggressive', 'balanced', 'conservative'
    chunk_mode_bias: str = 'balanced'
    
    # Compression goal
    compression_goal: CompressionGoal = field(
        default_factory=lambda: CompressionGoal(
            target_ratio=0.01,  # 100x default
            min_acceptable_ratio=0.001,
            max_acceptable_ratio=0.1,
        )
    )
    
    # Activation threshold - min entropy reduction to enable extreme mode
    activation_threshold: float = 0.3
    
    # Risk tolerance (0-1, higher = more aggressive)
    risk_tolerance: float = 0.5


# ============================================================================
# Redundancy Analyzer
# ============================================================================

class RedundancyAnalyzer:
    """
    Analyzes datasets for compression potential.
    """
    
    def __init__(self):
        # Track seen patterns
        self.signature_counts: Dict[str, int] = {}
        self.entropy_distribution: List[float] = []
        self.redundancy_scores: deque = deque(maxlen=1000)
        
        # Analysis results
        self.total_chunks = 0
        self.duplicate_chunks = 0
        self.high_entropy_chunks = 0
    
    def analyze_chunk(
        self,
        signature: str,
        entropy: float,
        size: int,
    ) -> Dict[str, Any]:
        """
        Analyze a chunk for redundancy.
        
        Returns analysis with:
        - is_duplicate: Whether chunk was seen before
        - redundancy_score: 0-1 redundancy likelihood
        - recommended_mode: Suggested compression mode
        """
        self.total_chunks += 1
        
        # Check for duplicate
        is_duplicate = signature in self.signature_counts
        if is_duplicate:
            self.duplicate_chunks += 1
        
        # Update signature count
        self.signature_counts[signature] = self.signature_counts.get(signature, 0) + 1
        
        # Track entropy
        self.entropy_distribution.append(entropy)
        is_high_entropy = entropy > 7.5
        if is_high_entropy:
            self.high_entropy_chunks += 1
        
        # Calculate redundancy score
        count = self.signature_counts[signature]
        base_score = 1.0 - (entropy / 8.0)  # Low entropy = high redundancy
        frequency_bonus = min(0.3, (count - 1) * 0.1)  # Frequent patterns
        redundancy_score = min(1.0, base_score + frequency_bonus)
        
        self.redundancy_scores.append(redundancy_score)
        
        # Recommend mode
        if is_duplicate:
            recommended_mode = 'skip-refine'  # Just reference
        elif redundancy_score > 0.7:
            recommended_mode = 'strong'  # High compression potential
        elif redundancy_score > 0.4:
            recommended_mode = 'auto'
        else:
            recommended_mode = 'fast'
        
        return {
            'is_duplicate': is_duplicate,
            'redundancy_score': redundancy_score,
            'recommended_mode': recommended_mode,
            'occurrence_count': count,
        }
    
    def get_dataset_profile(self) -> Dict[str, Any]:
        """Get overall dataset profile."""
        if self.total_chunks == 0:
            return {'status': 'no_data'}
        
        avg_redundancy = (
            sum(self.redundancy_scores) / len(self.redundancy_scores)
            if self.redundancy_scores else 0.0
        )
        
        avg_entropy = (
            sum(self.entropy_distribution) / len(self.entropy_distribution)
            if self.entropy_distribution else 4.0
        )
        
        duplicate_ratio = self.duplicate_chunks / self.total_chunks
        high_entropy_ratio = self.high_entropy_chunks / self.total_chunks
        
        # Estimate achievable compression
        if duplicate_ratio > 0.8:
            potential_ratio = 0.0001  # 10000x possible
        elif duplicate_ratio > 0.5:
            potential_ratio = 0.001  # 1000x possible
        elif avg_redundancy > 0.6:
            potential_ratio = 0.01  # 100x possible
        elif avg_redundancy > 0.3:
            potential_ratio = 0.1  # 10x possible
        else:
            potential_ratio = 0.5  # 2x possible
        
        # Classify dataset type
        if duplicate_ratio > 0.7:
            dataset_type = 'highly_redundant'
        elif avg_entropy < 2.0:
            dataset_type = 'structured_data'
        elif avg_entropy > 7.0:
            dataset_type = 'encrypted_or_random'
        else:
            dataset_type = 'mixed_content'
        
        return {
            'total_chunks': self.total_chunks,
            'duplicate_ratio': duplicate_ratio,
            'high_entropy_ratio': high_entropy_ratio,
            'avg_redundancy': avg_redundancy,
            'avg_entropy': avg_entropy,
            'unique_signatures': len(self.signature_counts),
            'dataset_type': dataset_type,
            'potential_ratio': potential_ratio,
        }
    
    def reset(self):
        """Reset analyzer state."""
        self.signature_counts.clear()
        self.entropy_distribution.clear()
        self.redundancy_scores.clear()
        self.total_chunks = 0
        self.duplicate_chunks = 0
        self.high_entropy_chunks = 0


# ============================================================================
# Extreme Ratio Controller
# ============================================================================

class ExtremeRatioController:
    """
    Main controller for extreme compression ratios.
    
    Coordinates:
    - Target setting based on dataset analysis
    - Dynamic adjustment during compression
    - Recommendation generation
    - Performance monitoring
    """
    
    def __init__(self, model_state: Optional[Any] = None):
        self.model_state = model_state
        self.analyzer = RedundancyAnalyzer()
        
        # Current settings
        self.current_settings = ExtremeSettings()
        
        # State tracking
        self.active_compression: Optional[Dict[str, Any]] = None
        self.compression_history: deque = deque(maxlen=100)
        
        # Performance tracking
        self.achieved_ratios: deque = deque(maxlen=1000)
        self.time_per_chunk: deque = deque(maxlen=1000)
    
    def target(
        self,
        input_size_bytes: int,
        estimated_entropy: float = 4.0,
        memory_available_mb: int = 1024,
        time_budget_seconds: Optional[float] = None,
    ) -> ExtremeSettings:
        """
        Generate extreme settings for target compression.
        
        Args:
            input_size_bytes: Total input size
            estimated_entropy: Average entropy estimate (0-8)
            memory_available_mb: Available memory
            time_budget_seconds: Optional time budget
            
        Returns:
            ExtremeSettings configured for this job
        """
        input_gb = input_size_bytes / (1024 ** 3)
        
        # Determine target ratio based on entropy
        if estimated_entropy < 2.0:
            # Very low entropy - extreme compression possible
            target_ratio = 0.001  # 1000x
            refinement_depth = 8
            chunk_mode_bias = 'aggressive'
        elif estimated_entropy < 4.0:
            # Low entropy - good compression
            target_ratio = 0.01  # 100x
            refinement_depth = 6
            chunk_mode_bias = 'aggressive'
        elif estimated_entropy < 6.0:
            # Medium entropy - moderate compression
            target_ratio = 0.1  # 10x
            refinement_depth = 4
            chunk_mode_bias = 'balanced'
        else:
            # High entropy - limited compression
            target_ratio = 0.5  # 2x
            refinement_depth = 2
            chunk_mode_bias = 'conservative'
        
        # Adjust for memory constraints
        if memory_available_mb < 512:
            refinement_depth = min(refinement_depth, 3)
            chunk_mode_bias = 'conservative'
        
        # Adjust for time budget
        if time_budget_seconds:
            time_per_gb = time_budget_seconds / max(input_gb, 0.001)
            if time_per_gb < 10:
                # Very tight budget
                refinement_depth = min(refinement_depth, 2)
                chunk_mode_bias = 'conservative'
                target_ratio = max(target_ratio, 0.2)
            elif time_per_gb < 30:
                # Moderate budget
                refinement_depth = min(refinement_depth, 4)
        
        # Use learned adjustments if available
        if self.model_state:
            optimal = self.model_state.get_optimal_settings()
            # Adjust refinement based on learned optimal concurrency
            optimal_concurrency = optimal.get('optimal_concurrency', 4)
            if optimal_concurrency < 4:
                refinement_depth = max(1, refinement_depth - 1)
        
        # Compute activation threshold
        # Lower threshold = more aggressive activation
        if estimated_entropy < 3.0:
            activation_threshold = 0.2
        else:
            activation_threshold = 0.3 + (estimated_entropy - 3.0) * 0.1
        
        goal = CompressionGoal(
            target_ratio=target_ratio,
            min_acceptable_ratio=target_ratio * 0.1,
            max_acceptable_ratio=min(target_ratio * 10, 0.8),
            max_memory_mb=memory_available_mb,
            max_time_per_gb=time_budget_seconds / max(input_gb, 0.001) if time_budget_seconds else 60.0,
        )
        
        settings = ExtremeSettings(
            desired_refinement_depth=refinement_depth,
            chunk_mode_bias=chunk_mode_bias,
            compression_goal=goal,
            activation_threshold=activation_threshold,
            risk_tolerance=0.3 if memory_available_mb < 512 else 0.5,
        )
        
        self.current_settings = settings
        return settings
    
    def recommend(
        self,
        chunk_entropy: float,
        chunk_size: int,
        signature: str,
        current_ratio: float,
        elapsed_time: float,
        memory_usage_mb: int,
    ) -> Dict[str, Any]:
        """
        Generate recommendations for current chunk.
        
        Returns recommendations with:
        - desiredRefinementDepth
        - chunkModeBias
        - compressionGoal
        - activationThreshold
        - adjustments: any dynamic adjustments
        """
        # Analyze this chunk
        analysis = self.analyzer.analyze_chunk(signature, chunk_entropy, chunk_size)
        
        # Start with current settings
        refinement_depth = self.current_settings.desired_refinement_depth
        chunk_mode = self.current_settings.chunk_mode_bias
        
        # Adjust based on chunk analysis
        if analysis['is_duplicate']:
            # Duplicate chunk - minimal processing needed
            refinement_depth = 0
            chunk_mode = 'skip-refine'
        elif analysis['redundancy_score'] > 0.8:
            # Very redundant - push harder
            refinement_depth = min(10, refinement_depth + 2)
            chunk_mode = 'aggressive'
        elif analysis['redundancy_score'] < 0.2:
            # Low redundancy - don't waste time
            refinement_depth = max(1, refinement_depth - 2)
            chunk_mode = 'conservative'
        
        # Adjust for memory pressure
        goal = self.current_settings.compression_goal
        if memory_usage_mb > goal.max_memory_mb * 0.9:
            refinement_depth = max(1, refinement_depth - 2)
            chunk_mode = 'conservative'
        
        # Adjust for time pressure
        if elapsed_time > 0:
            processed_size = chunk_size  # Simplified
            throughput_mbps = (processed_size / elapsed_time) / (1024 * 1024)
            
            if throughput_mbps < 10:  # Too slow
                refinement_depth = max(1, refinement_depth - 1)
        
        # Adjust for progress vs target
        if current_ratio > goal.max_acceptable_ratio:
            # Not meeting target - push harder
            refinement_depth = min(10, refinement_depth + 1)
            if chunk_mode != 'aggressive':
                chunk_mode = 'balanced' if chunk_mode == 'conservative' else 'aggressive'
        elif current_ratio < goal.min_acceptable_ratio:
            # Exceeding target - can relax
            pass  # Keep settings, we're doing well
        
        # Calculate activation
        should_activate = (
            chunk_entropy < 8.0 * (1 - self.current_settings.activation_threshold) and
            analysis['redundancy_score'] > self.current_settings.activation_threshold
        )
        
        return {
            'desiredRefinementDepth': refinement_depth,
            'chunkModeBias': chunk_mode,
            'compressionGoal': {
                'target_ratio': goal.target_ratio,
                'min_ratio': goal.min_acceptable_ratio,
                'max_ratio': goal.max_acceptable_ratio,
            },
            'activationThreshold': self.current_settings.activation_threshold,
            'shouldActivate': should_activate,
            'analysis': analysis,
            'adjustments': {
                'reason': self._get_adjustment_reason(analysis, memory_usage_mb, current_ratio, goal),
            },
        }
    
    def _get_adjustment_reason(
        self,
        analysis: Dict[str, Any],
        memory_mb: int,
        ratio: float,
        goal: CompressionGoal,
    ) -> str:
        """Get human-readable reason for adjustments."""
        reasons = []
        
        if analysis['is_duplicate']:
            reasons.append('duplicate_chunk')
        if analysis['redundancy_score'] > 0.7:
            reasons.append('high_redundancy')
        if analysis['redundancy_score'] < 0.3:
            reasons.append('low_redundancy')
        if memory_mb > goal.max_memory_mb * 0.8:
            reasons.append('memory_pressure')
        if ratio > goal.max_acceptable_ratio:
            reasons.append('below_target')
        if ratio < goal.min_acceptable_ratio:
            reasons.append('exceeding_target')
        
        return ','.join(reasons) if reasons else 'nominal'
    
    def record_result(
        self,
        achieved_ratio: float,
        processing_time: float,
        chunk_size: int,
    ):
        """Record compression result for tracking."""
        self.achieved_ratios.append(achieved_ratio)
        self.time_per_chunk.append(processing_time)
        
        self.compression_history.append({
            'ratio': achieved_ratio,
            'time': processing_time,
            'size': chunk_size,
            'timestamp': time.time(),
        })
    
    def get_progress(self) -> Dict[str, Any]:
        """Get current compression progress."""
        profile = self.analyzer.get_dataset_profile()
        
        avg_ratio = (
            sum(self.achieved_ratios) / len(self.achieved_ratios)
            if self.achieved_ratios else 0.5
        )
        
        avg_time = (
            sum(self.time_per_chunk) / len(self.time_per_chunk)
            if self.time_per_chunk else 0.0
        )
        
        goal = self.current_settings.compression_goal
        on_target = goal.min_acceptable_ratio <= avg_ratio <= goal.max_acceptable_ratio
        
        return {
            'dataset_profile': profile,
            'avg_ratio': avg_ratio,
            'avg_chunk_time': avg_time,
            'target_ratio': goal.target_ratio,
            'on_target': on_target,
            'chunks_processed': len(self.achieved_ratios),
            'current_settings': {
                'refinement_depth': self.current_settings.desired_refinement_depth,
                'chunk_mode': self.current_settings.chunk_mode_bias,
                'activation_threshold': self.current_settings.activation_threshold,
            },
        }
    
    def reset(self):
        """Reset controller state for new job."""
        self.analyzer.reset()
        self.achieved_ratios.clear()
        self.time_per_chunk.clear()
        self.compression_history.clear()
        self.active_compression = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize controller state."""
        return {
            'settings': {
                'refinement_depth': self.current_settings.desired_refinement_depth,
                'chunk_mode_bias': self.current_settings.chunk_mode_bias,
                'activation_threshold': self.current_settings.activation_threshold,
                'risk_tolerance': self.current_settings.risk_tolerance,
                'goal': {
                    'target_ratio': self.current_settings.compression_goal.target_ratio,
                    'min_ratio': self.current_settings.compression_goal.min_acceptable_ratio,
                    'max_ratio': self.current_settings.compression_goal.max_acceptable_ratio,
                },
            },
            'achieved_ratios': list(self.achieved_ratios),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any], model_state: Optional[Any] = None) -> 'ExtremeRatioController':
        """Deserialize controller state."""
        controller = cls(model_state)
        
        if 'settings' in data:
            settings = data['settings']
            goal_data = settings.get('goal', {})
            
            goal = CompressionGoal(
                target_ratio=goal_data.get('target_ratio', 0.01),
                min_acceptable_ratio=goal_data.get('min_ratio', 0.001),
                max_acceptable_ratio=goal_data.get('max_ratio', 0.1),
            )
            
            controller.current_settings = ExtremeSettings(
                desired_refinement_depth=settings.get('refinement_depth', 5),
                chunk_mode_bias=settings.get('chunk_mode_bias', 'balanced'),
                compression_goal=goal,
                activation_threshold=settings.get('activation_threshold', 0.3),
                risk_tolerance=settings.get('risk_tolerance', 0.5),
            )
        
        if 'achieved_ratios' in data:
            controller.achieved_ratios.extend(data['achieved_ratios'])
        
        return controller
