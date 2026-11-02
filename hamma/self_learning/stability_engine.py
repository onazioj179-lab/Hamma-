"""
HAMMA EXTREME Stability Engine

Ensures stable model behavior under varying conditions.
Prevents overfitting, oscillation, and parameter drift.

Components per spec Section 7:
- ParameterSmoother: Exponential moving averages
- OverfitDetector: Monitors generalization
- OscillationDamper: Prevents parameter swings

Creator: Onazi Treasure (OJ)
"""

import math
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from collections import deque
import time


# ============================================================================
# Parameter Smoother
# ============================================================================

class ParameterSmoother:
    """
    Applies exponential moving averages to model parameters.
    Prevents abrupt changes that could destabilize predictions.
    """
    
    def __init__(
        self,
        smoothing_factor: float = 0.95,
        min_smoothing: float = 0.8,
        max_smoothing: float = 0.99,
    ):
        self.smoothing_factor = smoothing_factor
        self.min_smoothing = min_smoothing
        self.max_smoothing = max_smoothing
        
        # Tracked parameters
        self.smoothed_values: Dict[str, float] = {}
        self.raw_values: Dict[str, deque] = {}
        
        # Adaptive smoothing
        self.variance_estimates: Dict[str, float] = {}
        
        # Statistics
        self.updates = 0
    
    def smooth(self, name: str, new_value: float) -> float:
        """
        Apply smoothing to a parameter value.
        
        Returns smoothed value.
        """
        if name not in self.smoothed_values:
            # Initialize with first value
            self.smoothed_values[name] = new_value
            self.raw_values[name] = deque(maxlen=50)
            self.variance_estimates[name] = 0.0
        
        # Track raw values for variance estimation
        self.raw_values[name].append(new_value)
        
        # Update variance estimate
        if len(self.raw_values[name]) > 5:
            mean = sum(self.raw_values[name]) / len(self.raw_values[name])
            variance = sum((x - mean) ** 2 for x in self.raw_values[name]) / len(self.raw_values[name])
            self.variance_estimates[name] = variance
        
        # Adaptive smoothing: more smoothing for high variance
        adaptive_factor = self.smoothing_factor
        if self.variance_estimates[name] > 0.1:
            # High variance - increase smoothing
            adaptive_factor = min(self.max_smoothing, self.smoothing_factor + 0.03)
        elif self.variance_estimates[name] < 0.01:
            # Low variance - can reduce smoothing
            adaptive_factor = max(self.min_smoothing, self.smoothing_factor - 0.02)
        
        # Apply EMA
        old_value = self.smoothed_values[name]
        smoothed = adaptive_factor * old_value + (1 - adaptive_factor) * new_value
        self.smoothed_values[name] = smoothed
        
        self.updates += 1
        return smoothed
    
    def get_smoothed(self, name: str) -> Optional[float]:
        """Get current smoothed value."""
        return self.smoothed_values.get(name)
    
    def get_all_smoothed(self) -> Dict[str, float]:
        """Get all smoothed values."""
        return dict(self.smoothed_values)
    
    def get_variance(self, name: str) -> float:
        """Get estimated variance for parameter."""
        return self.variance_estimates.get(name, 0.0)
    
    def reset(self, name: Optional[str] = None):
        """Reset smoothing state."""
        if name:
            if name in self.smoothed_values:
                del self.smoothed_values[name]
                del self.raw_values[name]
                del self.variance_estimates[name]
        else:
            self.smoothed_values.clear()
            self.raw_values.clear()
            self.variance_estimates.clear()


# ============================================================================
# Overfit Detector
# ============================================================================

class OverfitDetector:
    """
    Monitors for overfitting to recent patterns.
    
    Detects when:
    - Training error diverges from validation error
    - Model becomes too specialized to recent data
    - Generalization degrades
    """
    
    def __init__(
        self,
        window_size: int = 100,
        overfit_threshold: float = 0.3,
    ):
        self.window_size = window_size
        self.overfit_threshold = overfit_threshold
        
        # Error tracking
        self.training_errors: deque = deque(maxlen=window_size)
        self.validation_errors: deque = deque(maxlen=window_size)
        
        # Pattern tracking
        self.recent_patterns: deque = deque(maxlen=window_size)
        self.pattern_counts: Dict[str, int] = {}
        
        # State
        self.is_overfitting = False
        self.overfit_score = 0.0
        self.last_check = time.time()
    
    def record_error(
        self,
        training_error: float,
        validation_error: Optional[float] = None,
        pattern_signature: Optional[str] = None,
    ):
        """
        Record error for overfit detection.
        
        Args:
            training_error: Error on training sample
            validation_error: Error on held-out sample (if available)
            pattern_signature: Signature of input pattern
        """
        self.training_errors.append(training_error)
        
        if validation_error is not None:
            self.validation_errors.append(validation_error)
        
        if pattern_signature:
            self.recent_patterns.append(pattern_signature)
            self.pattern_counts[pattern_signature] = self.pattern_counts.get(pattern_signature, 0) + 1
    
    def check_overfit(self) -> Dict[str, Any]:
        """
        Check for overfitting.
        
        Returns dict with:
        - is_overfitting: bool
        - overfit_score: 0-1 score
        - indicators: specific indicators
        """
        indicators = []
        scores = []
        
        # Check 1: Training vs validation error gap
        if len(self.training_errors) >= 20 and len(self.validation_errors) >= 20:
            avg_train = sum(list(self.training_errors)[-20:]) / 20
            avg_val = sum(list(self.validation_errors)[-20:]) / 20
            
            if avg_val > 0:
                gap = (avg_val - avg_train) / avg_val
                if gap > self.overfit_threshold:
                    indicators.append('train_val_gap')
                    scores.append(min(1.0, gap))
        
        # Check 2: Pattern concentration
        if len(self.recent_patterns) >= 50:
            unique_patterns = len(set(self.recent_patterns))
            concentration = 1.0 - (unique_patterns / len(self.recent_patterns))
            
            if concentration > 0.5:  # Less than 50% unique
                indicators.append('pattern_concentration')
                scores.append(concentration)
        
        # Check 3: Error trend
        if len(self.training_errors) >= 50:
            first_half = list(self.training_errors)[:25]
            second_half = list(self.training_errors)[25:50]
            
            avg_first = sum(first_half) / len(first_half)
            avg_second = sum(second_half) / len(second_half)
            
            if avg_first > 0:
                improvement = (avg_first - avg_second) / avg_first
                if improvement < -0.2:  # Error getting worse
                    indicators.append('degrading_performance')
                    scores.append(abs(improvement))
        
        # Compute overall score
        self.overfit_score = sum(scores) / len(scores) if scores else 0.0
        self.is_overfitting = self.overfit_score > self.overfit_threshold
        self.last_check = time.time()
        
        return {
            'is_overfitting': self.is_overfitting,
            'overfit_score': self.overfit_score,
            'indicators': indicators,
            'recommendation': self._get_recommendation(indicators),
        }
    
    def _get_recommendation(self, indicators: List[str]) -> str:
        """Get recommendation based on indicators."""
        if not indicators:
            return 'continue_normal'
        
        if 'train_val_gap' in indicators:
            return 'increase_regularization'
        elif 'pattern_concentration' in indicators:
            return 'diversify_training_data'
        elif 'degrading_performance' in indicators:
            return 'reset_learning_rate'
        
        return 'reduce_learning_rate'
    
    def reset(self):
        """Reset detector state."""
        self.training_errors.clear()
        self.validation_errors.clear()
        self.recent_patterns.clear()
        self.pattern_counts.clear()
        self.is_overfitting = False
        self.overfit_score = 0.0


# ============================================================================
# Oscillation Damper
# ============================================================================

class OscillationDamper:
    """
    Prevents parameter oscillation during training.
    
    Detects and dampens:
    - Sign changes in gradients
    - Ping-pong parameter updates
    - Unstable convergence
    """
    
    def __init__(
        self,
        damping_factor: float = 0.5,
        oscillation_threshold: int = 3,
    ):
        self.damping_factor = damping_factor
        self.oscillation_threshold = oscillation_threshold
        
        # Track parameter history
        self.param_history: Dict[str, deque] = {}
        self.gradient_signs: Dict[str, deque] = {}
        
        # Oscillation detection
        self.oscillation_counts: Dict[str, int] = {}
        self.is_oscillating: Dict[str, bool] = {}
        
        # Applied damping
        self.damping_applied: Dict[str, float] = {}
    
    def update(
        self,
        name: str,
        new_value: float,
        gradient: Optional[float] = None,
    ) -> float:
        """
        Apply oscillation damping to parameter update.
        
        Returns damped value.
        """
        if name not in self.param_history:
            self.param_history[name] = deque(maxlen=10)
            self.gradient_signs[name] = deque(maxlen=5)
            self.oscillation_counts[name] = 0
            self.is_oscillating[name] = False
            self.damping_applied[name] = 1.0
        
        history = self.param_history[name]
        
        # Track gradient sign changes
        if gradient is not None and len(history) > 0:
            prev_value = history[-1]
            direction = 1 if new_value > prev_value else -1
            
            signs = self.gradient_signs[name]
            signs.append(direction)
            
            # Count sign changes
            if len(signs) >= 2:
                changes = sum(1 for i in range(len(signs)-1) if signs[i] != signs[i+1])
                
                if changes >= self.oscillation_threshold:
                    self.oscillation_counts[name] += 1
                    self.is_oscillating[name] = True
                else:
                    self.is_oscillating[name] = False
        
        # Apply damping if oscillating
        damped_value = new_value
        if self.is_oscillating[name]:
            # Reduce the update magnitude
            if len(history) > 0:
                prev = history[-1]
                delta = new_value - prev
                damped_delta = delta * self.damping_factor
                damped_value = prev + damped_delta
                self.damping_applied[name] = self.damping_factor
        else:
            self.damping_applied[name] = 1.0
        
        history.append(damped_value)
        return damped_value
    
    def is_parameter_oscillating(self, name: str) -> bool:
        """Check if parameter is oscillating."""
        return self.is_oscillating.get(name, False)
    
    def get_damping_stats(self) -> Dict[str, Any]:
        """Get damping statistics."""
        return {
            'oscillating_params': [k for k, v in self.is_oscillating.items() if v],
            'oscillation_counts': dict(self.oscillation_counts),
            'damping_applied': dict(self.damping_applied),
        }
    
    def reset(self, name: Optional[str] = None):
        """Reset damper state."""
        if name:
            for d in [self.param_history, self.gradient_signs, 
                      self.oscillation_counts, self.is_oscillating, self.damping_applied]:
                if name in d:
                    del d[name]
        else:
            self.param_history.clear()
            self.gradient_signs.clear()
            self.oscillation_counts.clear()
            self.is_oscillating.clear()
            self.damping_applied.clear()


# ============================================================================
# Stability Engine - Main Controller
# ============================================================================

class StabilityEngine:
    """
    Main stability controller for HAMMA EXTREME.
    
    Coordinates all stability mechanisms:
    - Parameter smoothing
    - Overfit detection
    - Oscillation damping
    
    Provides unified interface for stable model updates.
    """
    
    def __init__(self):
        self.smoother = ParameterSmoother()
        self.overfit_detector = OverfitDetector()
        self.damper = OscillationDamper()
        
        # Global stability state
        self.stability_score = 1.0
        self.alerts: deque = deque(maxlen=100)
        self.last_check = time.time()
        
        # Thresholds
        self.critical_stability_threshold = 0.3
        self.warning_stability_threshold = 0.6
        
        # Statistics
        self.total_updates = 0
        self.stability_interventions = 0
    
    def stabilize_parameter(
        self,
        name: str,
        new_value: float,
        gradient: Optional[float] = None,
    ) -> float:
        """
        Apply full stability pipeline to a parameter.
        
        Returns stabilized value.
        """
        # Step 1: Dampen oscillations
        damped = self.damper.update(name, new_value, gradient)
        
        # Step 2: Apply smoothing
        smoothed = self.smoother.smooth(name, damped)
        
        self.total_updates += 1
        
        if abs(smoothed - new_value) > 0.1 * abs(new_value):
            self.stability_interventions += 1
        
        return smoothed
    
    def record_training_step(
        self,
        training_error: float,
        validation_error: Optional[float] = None,
        pattern_signature: Optional[str] = None,
    ):
        """Record training step for stability monitoring."""
        self.overfit_detector.record_error(
            training_error,
            validation_error,
            pattern_signature,
        )
    
    def check_stability(self) -> Dict[str, Any]:
        """
        Perform comprehensive stability check.
        
        Returns stability report.
        """
        # Check for overfitting
        overfit_result = self.overfit_detector.check_overfit()
        
        # Check for oscillations
        damping_stats = self.damper.get_damping_stats()
        
        # Check parameter variances
        variances = {k: self.smoother.get_variance(k) for k in self.smoother.smoothed_values}
        high_variance_params = [k for k, v in variances.items() if v > 0.5]
        
        # Compute overall stability score
        scores = [1.0]  # Base score
        
        if overfit_result['is_overfitting']:
            scores.append(1.0 - overfit_result['overfit_score'])
        
        oscillating_ratio = len(damping_stats['oscillating_params']) / max(1, len(self.damper.is_oscillating))
        scores.append(1.0 - oscillating_ratio)
        
        variance_penalty = min(1.0, len(high_variance_params) * 0.1)
        scores.append(1.0 - variance_penalty)
        
        self.stability_score = sum(scores) / len(scores)
        
        # Generate alerts
        alerts = []
        if self.stability_score < self.critical_stability_threshold:
            alerts.append({'level': 'critical', 'message': 'System stability critically low'})
        elif self.stability_score < self.warning_stability_threshold:
            alerts.append({'level': 'warning', 'message': 'System stability degraded'})
        
        if overfit_result['is_overfitting']:
            alerts.append({'level': 'warning', 'message': f"Overfitting detected: {overfit_result['indicators']}"})
        
        if damping_stats['oscillating_params']:
            alerts.append({'level': 'info', 'message': f"Oscillation detected in: {damping_stats['oscillating_params']}"})
        
        for alert in alerts:
            self.alerts.append({'timestamp': time.time(), **alert})
        
        self.last_check = time.time()
        
        return {
            'stability_score': self.stability_score,
            'is_stable': self.stability_score > self.warning_stability_threshold,
            'overfit_status': overfit_result,
            'oscillation_status': damping_stats,
            'high_variance_params': high_variance_params,
            'alerts': alerts,
            'recommendations': self._get_recommendations(overfit_result, damping_stats, high_variance_params),
        }
    
    def _get_recommendations(
        self,
        overfit_result: Dict[str, Any],
        damping_stats: Dict[str, Any],
        high_variance_params: List[str],
    ) -> List[str]:
        """Generate stability recommendations."""
        recommendations = []
        
        if overfit_result['is_overfitting']:
            recommendations.append(overfit_result['recommendation'])
        
        if damping_stats['oscillating_params']:
            recommendations.append('reduce_learning_rate')
        
        if high_variance_params:
            recommendations.append('increase_smoothing')
        
        if not recommendations:
            recommendations.append('continue_normal')
        
        return recommendations
    
    def should_halt_training(self) -> bool:
        """Check if training should be halted due to instability."""
        return self.stability_score < self.critical_stability_threshold
    
    def get_adaptive_learning_rate(self, base_lr: float) -> float:
        """Get stability-adjusted learning rate."""
        if self.stability_score > 0.8:
            return base_lr
        elif self.stability_score > 0.5:
            return base_lr * 0.5
        elif self.stability_score > 0.3:
            return base_lr * 0.1
        else:
            return base_lr * 0.01
    
    def reset(self):
        """Reset all stability state."""
        self.smoother.reset()
        self.overfit_detector.reset()
        self.damper.reset()
        self.stability_score = 1.0
        self.alerts.clear()
        self.total_updates = 0
        self.stability_interventions = 0
    
    def get_stats(self) -> Dict[str, Any]:
        """Get stability statistics."""
        return {
            'stability_score': self.stability_score,
            'total_updates': self.total_updates,
            'stability_interventions': self.stability_interventions,
            'intervention_rate': (
                self.stability_interventions / self.total_updates
                if self.total_updates > 0 else 0.0
            ),
            'recent_alerts': list(self.alerts)[-10:],
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize engine state."""
        return {
            'stability_score': self.stability_score,
            'total_updates': self.total_updates,
            'stability_interventions': self.stability_interventions,
            'smoothed_values': self.smoother.get_all_smoothed(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StabilityEngine':
        """Deserialize engine state."""
        engine = cls()
        engine.stability_score = data.get('stability_score', 1.0)
        engine.total_updates = data.get('total_updates', 0)
        engine.stability_interventions = data.get('stability_interventions', 0)
        
        smoothed = data.get('smoothed_values', {})
        for name, value in smoothed.items():
            engine.smoother.smoothed_values[name] = value
        
        return engine
