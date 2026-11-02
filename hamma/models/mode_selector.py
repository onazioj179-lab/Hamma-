"""
HAMMA Mode Selector Model

Classification model that decides optimal compression mode:
- fast: Speed priority, acceptable ratio
- strong: Best ratio, slower
- auto: Balanced approach
- skip-refine: Skip refinement pass

Creator: Onazi Treasure (OJ)
"""

from typing import Tuple, Optional, Literal
from dataclasses import dataclass


@dataclass
class ModeDecision:
    mode: Literal["fast", "strong", "auto", "skip-refine"]
    refinement_level: Literal[0, 1, 2]
    confidence: float


class ModeSelector:
    """
    Selects optimal compression mode based on chunk characteristics.
    
    Decision factors:
    - Entropy (compressibility)
    - Chunk size (processing overhead)
    - Device constraints (memory/CPU)
    - Historical performance
    - Redundancy status
    """
    
    def __init__(self):
        # Decision thresholds
        self._entropy_thresholds = {
            "low": 3.0,      # Very compressible
            "medium": 5.5,   # Moderately compressible
            "high": 7.0,     # Less compressible
        }
        
        self._ratio_thresholds = {
            "excellent": 4.0,  # 4:1 or better
            "good": 2.0,       # 2:1 or better
            "marginal": 1.2,   # Barely worth compressing
        }
        
        self._size_thresholds = {
            "small": 16 * 1024,      # 16KB
            "medium": 256 * 1024,    # 256KB
            "large": 4 * 1024 * 1024, # 4MB
        }
        
        # Stats
        self._predictions = 0
        self._mode_counts = {"fast": 0, "strong": 0, "auto": 0, "skip-refine": 0}
    
    def predict(
        self,
        entropy: float,
        chunk_size: int,
        expected_ratio: float,
        is_redundant: bool,
        device_profile: Optional[object] = None,
        history: Optional[object] = None,
    ) -> Tuple[Literal["fast", "strong", "auto", "skip-refine"], Literal[0, 1, 2]]:
        """
        Select optimal mode and refinement level.
        
        Returns:
            Tuple of (mode, refinement_level)
        """
        self._predictions += 1
        
        # Quick wins: redundant chunks don't need heavy compression
        if is_redundant:
            self._mode_counts["skip-refine"] += 1
            return ("skip-refine", 0)
        
        # Device constraints
        is_low_memory = False
        is_mobile = False
        is_throttled = False
        
        if device_profile:
            is_low_memory = getattr(device_profile, 'ram_pressure', 0) > 0.7
            is_mobile = getattr(device_profile, 'is_mobile', False)
            is_throttled = getattr(device_profile, 'is_throttled', False)
        
        # Low memory: always fast mode
        if is_low_memory or is_throttled:
            self._mode_counts["fast"] += 1
            return ("fast", 0)
        
        # Classify entropy
        if entropy < self._entropy_thresholds["low"]:
            entropy_class = "low"
        elif entropy < self._entropy_thresholds["medium"]:
            entropy_class = "medium"
        elif entropy < self._entropy_thresholds["high"]:
            entropy_class = "high"
        else:
            entropy_class = "random"
        
        # Classify expected ratio
        if expected_ratio >= self._ratio_thresholds["excellent"]:
            ratio_class = "excellent"
        elif expected_ratio >= self._ratio_thresholds["good"]:
            ratio_class = "good"
        elif expected_ratio >= self._ratio_thresholds["marginal"]:
            ratio_class = "marginal"
        else:
            ratio_class = "poor"
        
        # Classify chunk size
        if chunk_size < self._size_thresholds["small"]:
            size_class = "small"
        elif chunk_size < self._size_thresholds["medium"]:
            size_class = "medium"
        elif chunk_size < self._size_thresholds["large"]:
            size_class = "large"
        else:
            size_class = "huge"
        
        # Decision matrix
        mode, refinement = self._decide(
            entropy_class, ratio_class, size_class, is_mobile
        )
        
        # Historical adjustment
        if history:
            refinement_success = getattr(history, 'refinement_success_rate', 0.5)
            if refinement_success < 0.3 and refinement > 0:
                # Refinement hasn't been helping
                refinement = max(0, refinement - 1)
            elif refinement_success > 0.7 and refinement < 2:
                # Refinement is very effective
                refinement = min(2, refinement + 1)
        
        self._mode_counts[mode] += 1
        return (mode, refinement)
    
    def _decide(
        self,
        entropy_class: str,
        ratio_class: str,
        size_class: str,
        is_mobile: bool,
    ) -> Tuple[Literal["fast", "strong", "auto", "skip-refine"], Literal[0, 1, 2]]:
        """Core decision logic"""
        
        # Random data: skip refinement
        if entropy_class == "random" or ratio_class == "poor":
            return ("skip-refine", 0)
        
        # Excellent ratio: use strong mode with refinement
        if ratio_class == "excellent":
            if is_mobile:
                return ("strong", 1)
            else:
                return ("strong", 2)
        
        # Good ratio: balanced approach
        if ratio_class == "good":
            if size_class in ("small", "medium"):
                return ("auto", 1)
            else:
                # Large chunks: strong mode is worth it
                return ("strong", 1)
        
        # Marginal ratio
        if ratio_class == "marginal":
            if size_class == "small":
                # Small chunks with marginal ratio: fast
                return ("fast", 0)
            else:
                return ("auto", 1)
        
        # Default: auto mode
        return ("auto", 1)
    
    def get_stats(self) -> dict:
        """Get selector statistics"""
        return {
            "predictions": self._predictions,
            "mode_distribution": dict(self._mode_counts),
        }


class AdaptiveModeSelector(ModeSelector):
    """
    Extended mode selector with online learning.
    
    Adapts thresholds based on observed performance.
    """
    
    def __init__(self):
        super().__init__()
        
        # Learning state
        self._feedback_history = []
        self._max_history = 1000
        
        # Adaptive thresholds (start with defaults)
        self._adaptive_entropy_low = 3.0
        self._adaptive_entropy_high = 7.0
    
    def record_feedback(
        self,
        mode: str,
        actual_ratio: float,
        expected_ratio: float,
        processing_time_ms: float,
    ):
        """Record feedback for adaptive learning"""
        error = abs(actual_ratio - expected_ratio) / max(expected_ratio, 1.0)
        
        self._feedback_history.append({
            "mode": mode,
            "actual_ratio": actual_ratio,
            "expected_ratio": expected_ratio,
            "error": error,
            "time_ms": processing_time_ms,
        })
        
        # Trim history
        if len(self._feedback_history) > self._max_history:
            self._feedback_history = self._feedback_history[-self._max_history:]
        
        # Adapt thresholds periodically
        if len(self._feedback_history) % 100 == 0:
            self._adapt_thresholds()
    
    def _adapt_thresholds(self):
        """Adapt thresholds based on feedback"""
        if len(self._feedback_history) < 50:
            return
        
        # Analyze recent predictions
        recent = self._feedback_history[-100:]
        
        # Calculate average error per mode
        mode_errors = {}
        for fb in recent:
            mode = fb["mode"]
            if mode not in mode_errors:
                mode_errors[mode] = []
            mode_errors[mode].append(fb["error"])
        
        # If "strong" mode has high error, raise entropy threshold
        if "strong" in mode_errors:
            avg_error = sum(mode_errors["strong"]) / len(mode_errors["strong"])
            if avg_error > 0.3:
                self._adaptive_entropy_low *= 0.95  # Lower threshold
        
        # If "fast" mode has low error, we might be too conservative
        if "fast" in mode_errors:
            avg_error = sum(mode_errors["fast"]) / len(mode_errors["fast"])
            if avg_error < 0.1:
                self._adaptive_entropy_low *= 1.02  # Raise threshold
