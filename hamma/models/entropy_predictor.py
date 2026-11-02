"""
HAMMA Entropy Predictor Model

Lightweight regression model that predicts compressibility
without reading file content - only uses metadata.

Creator: Onazi Treasure (OJ)
"""

import numpy as np
from typing import List, Optional


class EntropyPredictor:
    """
    Predicts compression ratio based on entropy and metadata.
    
    Uses a simple weighted model optimized for <1ms inference.
    No deep learning - just fast numerical computation.
    """
    
    def __init__(self):
        # Pre-computed weights from synthetic training
        # entropy -> compression ratio mapping
        self._entropy_weights = np.array([
            8.0,   # entropy 0 -> ratio ~8x
            6.5,   # entropy 1 -> ratio ~6.5x
            5.0,   # entropy 2 -> ratio ~5x
            3.5,   # entropy 3 -> ratio ~3.5x
            2.5,   # entropy 4 -> ratio ~2.5x
            1.8,   # entropy 5 -> ratio ~1.8x
            1.3,   # entropy 6 -> ratio ~1.3x
            1.1,   # entropy 7 -> ratio ~1.1x
            1.0,   # entropy 8 -> ratio ~1x (random)
        ])
        
        # Size factor (larger chunks compress slightly better)
        self._size_thresholds = np.array([
            1024,      # 1KB
            4096,      # 4KB
            16384,     # 16KB
            65536,     # 64KB
            262144,    # 256KB
            1048576,   # 1MB
            4194304,   # 4MB
        ])
        
        self._size_factors = np.array([
            0.85,  # very small chunks compress worse
            0.92,
            0.97,
            1.00,
            1.02,
            1.04,
            1.05,
        ])
        
        # Stats tracking
        self._predictions = 0
        self._total_time_ns = 0
    
    def predict(
        self,
        entropy: float,
        chunk_size: int,
        histogram: Optional[List[int]] = None,
    ) -> float:
        """
        Predict compression ratio for a chunk.
        
        Args:
            entropy: Shannon entropy (0-8)
            chunk_size: Size in bytes
            histogram: Optional byte frequency histogram
            
        Returns:
            Predicted compression ratio (e.g., 2.5 means 2.5:1)
        """
        import time
        start = time.perf_counter_ns()
        
        # Base ratio from entropy
        entropy_idx = int(min(max(entropy, 0), 8))
        base_ratio = self._entropy_weights[entropy_idx]
        
        # Interpolate for precision
        if entropy_idx < 8:
            frac = entropy - entropy_idx
            next_ratio = self._entropy_weights[min(entropy_idx + 1, 8)]
            base_ratio = base_ratio * (1 - frac) + next_ratio * frac
        
        # Size factor
        size_factor = self._get_size_factor(chunk_size)
        
        # Histogram adjustment
        histogram_factor = 1.0
        if histogram and len(histogram) == 256:
            histogram_factor = self._analyze_histogram(histogram)
        
        # Final prediction
        ratio = base_ratio * size_factor * histogram_factor
        
        # Ensure reasonable bounds
        ratio = max(1.0, min(ratio, 100.0))
        
        # Track stats
        self._predictions += 1
        self._total_time_ns += time.perf_counter_ns() - start
        
        return round(ratio, 2)
    
    def _get_size_factor(self, chunk_size: int) -> float:
        """Get size adjustment factor"""
        for i, threshold in enumerate(self._size_thresholds):
            if chunk_size <= threshold:
                return self._size_factors[i]
        return self._size_factors[-1]
    
    def _analyze_histogram(self, histogram: List[int]) -> float:
        """
        Analyze byte histogram for compression hints.
        
        Looks for patterns that indicate better/worse compressibility:
        - Few unique bytes -> better compression
        - Spiky distribution -> better compression
        - Flat distribution -> worse compression
        """
        arr = np.array(histogram, dtype=np.float64)
        total = arr.sum()
        
        if total == 0:
            return 1.0
        
        # Normalize
        probs = arr / total
        
        # Count non-zero bins (unique bytes used)
        unique_bytes = np.count_nonzero(arr)
        
        # Concentration factor (how concentrated the distribution is)
        max_prob = probs.max()
        
        # Score based on uniqueness and concentration
        factor = 1.0
        
        # Fewer unique bytes = better compression
        if unique_bytes < 32:
            factor *= 1.3
        elif unique_bytes < 64:
            factor *= 1.15
        elif unique_bytes < 128:
            factor *= 1.05
        elif unique_bytes > 250:
            factor *= 0.95
        
        # High concentration = better compression
        if max_prob > 0.3:
            factor *= 1.2
        elif max_prob > 0.1:
            factor *= 1.1
        
        return factor
    
    def get_stats(self) -> dict:
        """Get predictor statistics"""
        return {
            "predictions": self._predictions,
            "avg_time_ns": self._total_time_ns / self._predictions if self._predictions > 0 else 0,
        }
