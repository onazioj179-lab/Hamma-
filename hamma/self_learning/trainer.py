"""
HAMMA EXTREME Online Trainer

Incremental training system for adaptive model updates.
Uses online gradient updates with small local datasets.
Avoids storing historical data - safe and lightweight.

Creator: Onazi Treasure (OJ)
"""

import numpy as np
from typing import Dict, List, Optional, Tuple, Any, Callable
from dataclasses import dataclass, field
from collections import deque
import time


# ============================================================================
# Incremental Gradient Update System
# ============================================================================

class IncrementalGradient:
    """
    Online gradient descent for model parameter updates.
    Lightweight incremental learning without storing history.
    """
    
    def __init__(
        self,
        n_features: int,
        learning_rate: float = 0.01,
        momentum: float = 0.9,
        l2_reg: float = 0.001,
    ):
        self.n_features = n_features
        self.learning_rate = learning_rate
        self.momentum = momentum
        self.l2_reg = l2_reg
        
        # Model weights
        self.weights = np.zeros(n_features)
        self.bias = 0.0
        
        # Momentum terms
        self.velocity_w = np.zeros(n_features)
        self.velocity_b = 0.0
        
        # Adaptive learning rate (AdaGrad-style)
        self.grad_squared_w = np.zeros(n_features) + 1e-8
        self.grad_squared_b = 1e-8
        
        # Statistics
        self.updates = 0
        self.total_loss = 0.0
    
    def predict(self, features: np.ndarray) -> float:
        """Make prediction for feature vector."""
        return np.dot(self.weights, features) + self.bias
    
    def update(self, features: np.ndarray, target: float, sample_weight: float = 1.0):
        """
        Perform single-sample gradient update.
        
        Args:
            features: Feature vector
            target: True target value
            sample_weight: Weight for this sample
        """
        # Forward pass
        prediction = self.predict(features)
        error = prediction - target
        
        # Compute gradients
        grad_w = error * features * sample_weight + self.l2_reg * self.weights
        grad_b = error * sample_weight
        
        # Accumulate squared gradients for adaptive learning rate
        self.grad_squared_w += grad_w ** 2
        self.grad_squared_b += grad_b ** 2
        
        # Adaptive learning rates
        lr_w = self.learning_rate / np.sqrt(self.grad_squared_w)
        lr_b = self.learning_rate / np.sqrt(self.grad_squared_b)
        
        # Momentum update
        self.velocity_w = self.momentum * self.velocity_w - lr_w * grad_w
        self.velocity_b = self.momentum * self.velocity_b - lr_b * grad_b
        
        # Apply updates
        self.weights += self.velocity_w
        self.bias += self.velocity_b
        
        # Track statistics
        self.updates += 1
        self.total_loss += 0.5 * error ** 2
    
    def get_loss(self) -> float:
        """Get average loss."""
        if self.updates == 0:
            return 0.0
        return self.total_loss / self.updates
    
    def decay_learning_rate(self, factor: float = 0.99):
        """Decay learning rate."""
        self.learning_rate *= factor
    
    def get_weights(self) -> Tuple[np.ndarray, float]:
        """Get current weights."""
        return self.weights.copy(), self.bias
    
    def set_weights(self, weights: np.ndarray, bias: float):
        """Set weights (for loading from persistence)."""
        self.weights = weights.copy()
        self.bias = bias


# ============================================================================
# Adaptive Model Tuner
# ============================================================================

class AdaptiveModelTuner:
    """
    Tunes prediction models based on observed performance.
    Adjusts model parameters incrementally for each predictor.
    """
    
    def __init__(self):
        # Entropy predictor tuning
        # Features: [entropy, log_chunk_size, histogram_sparsity, is_text_like]
        self.entropy_model = IncrementalGradient(
            n_features=4,
            learning_rate=0.01,
        )
        
        # Mode selector tuning
        # Features: [entropy, ratio_prediction, redundancy_score, size_class]
        self.mode_model = IncrementalGradient(
            n_features=4,
            learning_rate=0.01,
        )
        
        # Refinement benefit predictor
        # Features: [entropy, initial_ratio, chunk_size_log, mode_encoded]
        self.refinement_model = IncrementalGradient(
            n_features=4,
            learning_rate=0.01,
        )
        
        # Stability predictor
        # Features: [memory_pressure, worker_variance, error_rate, throughput_trend]
        self.stability_model = IncrementalGradient(
            n_features=4,
            learning_rate=0.01,
        )
        
        # Performance tracking
        self.tune_count = 0
        self.last_tune = time.time()
    
    def tune_entropy_predictor(
        self,
        entropy: float,
        chunk_size: int,
        histogram_nonzero: int,
        is_text_like: bool,
        actual_ratio: float,
    ):
        """
        Update entropy predictor with observation.
        """
        features = np.array([
            entropy / 8.0,  # Normalize to 0-1
            np.log2(max(chunk_size, 1024)) / 20.0,  # Log-normalized
            histogram_nonzero / 256.0,  # Proportion of non-zero bins
            1.0 if is_text_like else 0.0,
        ])
        
        # Target is log of ratio for numerical stability
        target = np.log(max(actual_ratio, 1.0))
        
        self.entropy_model.update(features, target)
        self.tune_count += 1
        self.last_tune = time.time()
    
    def tune_mode_selector(
        self,
        entropy: float,
        ratio_prediction: float,
        redundancy_score: float,
        chunk_size: int,
        best_mode: str,
    ):
        """
        Update mode selector with observation.
        """
        # Encode mode as numeric target
        mode_targets = {'fast': 0.0, 'auto': 0.5, 'strong': 1.0, 'skip-refine': -0.5}
        target = mode_targets.get(best_mode, 0.5)
        
        # Size class: 0=small, 1=medium, 2=large
        size_class = 0 if chunk_size < 64*1024 else (1 if chunk_size < 1024*1024 else 2)
        
        features = np.array([
            entropy / 8.0,
            np.log(max(ratio_prediction, 1.0)) / 3.0,
            redundancy_score,
            size_class / 2.0,
        ])
        
        self.mode_model.update(features, target)
    
    def tune_refinement_predictor(
        self,
        entropy: float,
        initial_ratio: float,
        chunk_size: int,
        mode: str,
        refinement_benefit: float,
    ):
        """
        Update refinement benefit predictor.
        """
        mode_encoded = {'fast': 0, 'auto': 1, 'strong': 2, 'skip-refine': 0}.get(mode, 1)
        
        features = np.array([
            entropy / 8.0,
            np.log(max(initial_ratio, 1.0)) / 3.0,
            np.log2(max(chunk_size, 1024)) / 20.0,
            mode_encoded / 2.0,
        ])
        
        # Benefit is improvement in ratio
        target = min(refinement_benefit, 2.0)  # Cap at 2x improvement
        
        self.refinement_model.update(features, target)
    
    def tune_stability_predictor(
        self,
        memory_pressure: float,
        worker_variance: float,
        error_rate: float,
        throughput_trend: float,
        actual_stable: bool,
    ):
        """
        Update stability predictor.
        """
        features = np.array([
            memory_pressure,
            min(worker_variance, 5.0) / 5.0,
            min(error_rate, 0.5) / 0.5,
            (throughput_trend + 1.0) / 2.0,  # Normalize -1 to 1 range
        ])
        
        target = 1.0 if actual_stable else 0.0
        
        self.stability_model.update(features, target)
    
    def predict_ratio_adjustment(
        self,
        entropy: float,
        chunk_size: int,
        histogram_nonzero: int,
        is_text_like: bool,
    ) -> float:
        """
        Get learned ratio adjustment factor.
        """
        features = np.array([
            entropy / 8.0,
            np.log2(max(chunk_size, 1024)) / 20.0,
            histogram_nonzero / 256.0,
            1.0 if is_text_like else 0.0,
        ])
        
        log_ratio = self.entropy_model.predict(features)
        return np.exp(log_ratio)
    
    def predict_mode_preference(
        self,
        entropy: float,
        ratio_prediction: float,
        redundancy_score: float,
        chunk_size: int,
    ) -> str:
        """
        Get learned mode preference.
        """
        size_class = 0 if chunk_size < 64*1024 else (1 if chunk_size < 1024*1024 else 2)
        
        features = np.array([
            entropy / 8.0,
            np.log(max(ratio_prediction, 1.0)) / 3.0,
            redundancy_score,
            size_class / 2.0,
        ])
        
        score = self.mode_model.predict(features)
        
        if score < -0.25:
            return 'skip-refine'
        elif score < 0.25:
            return 'fast'
        elif score < 0.75:
            return 'auto'
        else:
            return 'strong'
    
    def predict_refinement_benefit(
        self,
        entropy: float,
        initial_ratio: float,
        chunk_size: int,
        mode: str,
    ) -> float:
        """
        Predict benefit of refinement pass.
        """
        mode_encoded = {'fast': 0, 'auto': 1, 'strong': 2, 'skip-refine': 0}.get(mode, 1)
        
        features = np.array([
            entropy / 8.0,
            np.log(max(initial_ratio, 1.0)) / 3.0,
            np.log2(max(chunk_size, 1024)) / 20.0,
            mode_encoded / 2.0,
        ])
        
        return max(0, self.refinement_model.predict(features))
    
    def predict_stability(
        self,
        memory_pressure: float,
        worker_variance: float,
        error_rate: float,
        throughput_trend: float,
    ) -> float:
        """
        Predict stability score (0-1).
        """
        features = np.array([
            memory_pressure,
            min(worker_variance, 5.0) / 5.0,
            min(error_rate, 0.5) / 0.5,
            (throughput_trend + 1.0) / 2.0,
        ])
        
        score = self.stability_model.predict(features)
        return max(0.0, min(1.0, score))
    
    def get_stats(self) -> Dict[str, Any]:
        """Get tuner statistics."""
        return {
            'tune_count': self.tune_count,
            'last_tune': self.last_tune,
            'entropy_loss': self.entropy_model.get_loss(),
            'mode_loss': self.mode_model.get_loss(),
            'refinement_loss': self.refinement_model.get_loss(),
            'stability_loss': self.stability_model.get_loss(),
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize tuner state."""
        return {
            'tune_count': self.tune_count,
            'entropy_weights': self.entropy_model.weights.tolist(),
            'entropy_bias': self.entropy_model.bias,
            'mode_weights': self.mode_model.weights.tolist(),
            'mode_bias': self.mode_model.bias,
            'refinement_weights': self.refinement_model.weights.tolist(),
            'refinement_bias': self.refinement_model.bias,
            'stability_weights': self.stability_model.weights.tolist(),
            'stability_bias': self.stability_model.bias,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AdaptiveModelTuner':
        """Deserialize tuner state."""
        tuner = cls()
        tuner.tune_count = data.get('tune_count', 0)
        
        if 'entropy_weights' in data:
            tuner.entropy_model.set_weights(
                np.array(data['entropy_weights']),
                data.get('entropy_bias', 0.0)
            )
        if 'mode_weights' in data:
            tuner.mode_model.set_weights(
                np.array(data['mode_weights']),
                data.get('mode_bias', 0.0)
            )
        if 'refinement_weights' in data:
            tuner.refinement_model.set_weights(
                np.array(data['refinement_weights']),
                data.get('refinement_bias', 0.0)
            )
        if 'stability_weights' in data:
            tuner.stability_model.set_weights(
                np.array(data['stability_weights']),
                data.get('stability_bias', 0.0)
            )
        
        return tuner


# ============================================================================
# Online Trainer - Main Training Coordinator
# ============================================================================

class OnlineTrainer:
    """
    Coordinates online learning across all HAMMA EXTREME models.
    
    Manages:
    - Incremental updates from compression results
    - Adaptive model tuning
    - Learning rate scheduling
    - Stability monitoring during training
    """
    
    def __init__(self, model_state: Optional[Any] = None):
        self.tuner = AdaptiveModelTuner()
        self.model_state = model_state
        
        # Training configuration
        self.batch_size = 1  # True online learning
        self.warmup_samples = 100
        self.min_samples_for_prediction = 10
        
        # Sample buffer for mini-batch updates
        self.sample_buffer: deque = deque(maxlen=100)
        
        # Training statistics
        self.total_samples = 0
        self.training_errors: deque = deque(maxlen=100)
        self.is_warmed_up = False
        
        # Learning rate schedule
        self.initial_lr = 0.1
        self.current_lr = 0.1
        self.lr_decay_rate = 0.9999
        self.min_lr = 0.001
    
    def train_step(
        self,
        # Chunk metadata (NO content)
        entropy: float,
        chunk_size: int,
        signature: str,
        histogram_nonzero: int,
        
        # Prediction that was made
        predicted_ratio: float,
        predicted_mode: str,
        predicted_refinement: int,
        
        # Actual results
        actual_ratio: float,
        actual_mode_effective: str,
        refinement_benefit: float,
        
        # System state
        memory_pressure: float,
        throughput_mbps: float,
        had_error: bool,
    ):
        """
        Perform single training step with observation.
        """
        # Detect text-like data from histogram
        is_text_like = histogram_nonzero < 100
        
        # Update entropy predictor
        self.tuner.tune_entropy_predictor(
            entropy=entropy,
            chunk_size=chunk_size,
            histogram_nonzero=histogram_nonzero,
            is_text_like=is_text_like,
            actual_ratio=actual_ratio,
        )
        
        # Update mode selector
        redundancy_score = 1.0 if actual_mode_effective == 'skip-refine' else 0.0
        self.tuner.tune_mode_selector(
            entropy=entropy,
            ratio_prediction=predicted_ratio,
            redundancy_score=redundancy_score,
            chunk_size=chunk_size,
            best_mode=actual_mode_effective,
        )
        
        # Update refinement predictor
        self.tuner.tune_refinement_predictor(
            entropy=entropy,
            initial_ratio=predicted_ratio,
            chunk_size=chunk_size,
            mode=predicted_mode,
            refinement_benefit=refinement_benefit,
        )
        
        # Calculate worker variance (simplified)
        worker_variance = abs(actual_ratio - predicted_ratio) / max(predicted_ratio, 0.1)
        error_rate = 1.0 if had_error else 0.0
        throughput_trend = 0.0  # Would need history
        
        # Update stability predictor
        self.tuner.tune_stability_predictor(
            memory_pressure=memory_pressure,
            worker_variance=worker_variance,
            error_rate=error_rate,
            throughput_trend=throughput_trend,
            actual_stable=not had_error and memory_pressure < 0.8,
        )
        
        # Track training error
        prediction_error = abs(predicted_ratio - actual_ratio) / max(actual_ratio, 0.1)
        self.training_errors.append(prediction_error)
        
        # Update learning rate
        self.current_lr = max(self.min_lr, self.current_lr * self.lr_decay_rate)
        self.tuner.entropy_model.decay_learning_rate(0.9999)
        self.tuner.mode_model.decay_learning_rate(0.9999)
        
        # Update model state if provided
        if self.model_state:
            self.model_state.record_prediction(
                entropy=entropy,
                predicted_ratio=predicted_ratio,
                actual_ratio=actual_ratio,
                mode=predicted_mode,
                refinement_level=predicted_refinement,
                chunk_size=chunk_size,
                signature=signature,
                was_redundant=actual_mode_effective == 'skip-refine',
                bytes_saved=int(chunk_size * (1 - 1/max(actual_ratio, 1))),
                throughput_mbps=throughput_mbps,
                memory_pressure=memory_pressure,
                had_error=had_error,
            )
        
        self.total_samples += 1
        if self.total_samples >= self.warmup_samples:
            self.is_warmed_up = True
    
    def get_prediction_adjustments(
        self,
        entropy: float,
        chunk_size: int,
        histogram_nonzero: int,
        signature: str,
    ) -> Dict[str, Any]:
        """
        Get learned adjustments for predictions.
        """
        if not self.is_warmed_up:
            return {
                'ratio_factor': 1.0,
                'mode_preference': 'auto',
                'refinement_benefit': 0.1,
                'stability_factor': 1.0,
                'confidence': 0.5,
            }
        
        is_text_like = histogram_nonzero < 100
        
        # Get learned ratio adjustment
        ratio_factor = self.tuner.predict_ratio_adjustment(
            entropy, chunk_size, histogram_nonzero, is_text_like
        )
        
        # Get mode preference
        redundancy_score = 0.0
        if self.model_state:
            redundancy_score = self.model_state.redundancy_fp.predict_redundancy_likelihood(signature)
        
        mode_preference = self.tuner.predict_mode_preference(
            entropy, ratio_factor, redundancy_score, chunk_size
        )
        
        # Get refinement benefit prediction
        refinement_benefit = self.tuner.predict_refinement_benefit(
            entropy, ratio_factor, chunk_size, mode_preference
        )
        
        # Calculate confidence based on training errors
        confidence = 0.8
        if len(self.training_errors) > 10:
            avg_error = sum(self.training_errors) / len(self.training_errors)
            confidence = max(0.2, min(0.95, 1.0 - avg_error))
        
        return {
            'ratio_factor': ratio_factor,
            'mode_preference': mode_preference,
            'refinement_benefit': refinement_benefit,
            'stability_factor': 1.0,
            'confidence': confidence,
        }
    
    def get_training_stats(self) -> Dict[str, Any]:
        """Get training statistics."""
        avg_error = 0.0
        if self.training_errors:
            avg_error = sum(self.training_errors) / len(self.training_errors)
        
        return {
            'total_samples': self.total_samples,
            'is_warmed_up': self.is_warmed_up,
            'current_lr': self.current_lr,
            'avg_error': avg_error,
            'tuner_stats': self.tuner.get_stats(),
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize trainer state."""
        return {
            'total_samples': self.total_samples,
            'is_warmed_up': self.is_warmed_up,
            'current_lr': self.current_lr,
            'tuner': self.tuner.to_dict(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any], model_state: Optional[Any] = None) -> 'OnlineTrainer':
        """Deserialize trainer state."""
        trainer = cls(model_state)
        trainer.total_samples = data.get('total_samples', 0)
        trainer.is_warmed_up = data.get('is_warmed_up', False)
        trainer.current_lr = data.get('current_lr', 0.1)
        
        if 'tuner' in data:
            trainer.tuner = AdaptiveModelTuner.from_dict(data['tuner'])
        
        return trainer
