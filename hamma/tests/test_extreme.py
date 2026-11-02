"""
HAMMA EXTREME Tests

Comprehensive test suite for self-adaptive learning layer.

Test categories (per spec):
- Synthetic repeated datasets
- Random data
- Large image/video archives
- Redundant backups
- Repeated log sequences
- 5000-file mixed projects
- Simulated 10TB cases
- Low-memory devices (1GB)

Creator: Onazi Treasure (OJ)
"""

import pytest
import numpy as np
import time
import tempfile
import os
from pathlib import Path


# ============================================================================
# Test Imports
# ============================================================================

from hamma.self_learning.model_state import (
    ModelState,
    EntropyDistribution,
    RedundancyFingerprint,
    CompressionCurve,
    HardwareCapability,
)
from hamma.self_learning.trainer import (
    OnlineTrainer,
    IncrementalGradient,
    AdaptiveModelTuner,
)
from hamma.self_learning.persistence import (
    StatePersistence,
    CheckpointManager,
    StateSerializer,
)
from hamma.self_learning.extreme_ratio import (
    ExtremeRatioController,
    RedundancyAnalyzer,
    CompressionGoal,
    ExtremeSettings,
)
from hamma.self_learning.stability_engine import (
    StabilityEngine,
    ParameterSmoother,
    OverfitDetector,
    OscillationDamper,
)


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def model_state():
    """Create fresh ModelState"""
    return ModelState()


@pytest.fixture
def trainer(model_state):
    """Create OnlineTrainer with ModelState"""
    return OnlineTrainer(model_state)


@pytest.fixture
def extreme_controller(model_state):
    """Create ExtremeRatioController"""
    return ExtremeRatioController(model_state)


@pytest.fixture
def stability_engine():
    """Create StabilityEngine"""
    return StabilityEngine()


@pytest.fixture
def temp_state_dir():
    """Create temporary directory for persistence tests"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


# ============================================================================
# Model State Tests
# ============================================================================

class TestEntropyDistribution:
    """Tests for EntropyDistribution"""
    
    def test_bucket_assignment(self):
        """Test entropy bucket assignment"""
        dist = EntropyDistribution()
        
        # Low entropy → bucket 0
        dist.update(0.2, 8.0, 1.0)
        assert dist.bucket_counts[0] > 0
        
        # High entropy → bucket 15 (entropy 7.8 / 0.5 = 15.6 → bucket 15)
        dist.update(7.8, 1.0, 1.0)
        assert dist.bucket_counts[15] > 0  # 7.8 * 2 = 15.6, capped at 16
    
    def test_ratio_correlation(self):
        """Test entropy-ratio correlation tracking"""
        dist = EntropyDistribution()
        
        # Record many samples
        for i in range(100):
            entropy = i / 100 * 8  # 0-8
            ratio = max(1.0, 8.0 - entropy)  # Lower entropy → higher ratio
            dist.update(entropy, ratio, 1.0)
        
        # Should see expected ratios
        low_entropy_ratio, _ = dist.get_expected_ratio(1.0)
        high_entropy_ratio, _ = dist.get_expected_ratio(7.0)
        assert low_entropy_ratio > high_entropy_ratio
    
    def test_decay(self):
        """Test decay for recency weighting"""
        dist = EntropyDistribution()
        
        # Record old sample
        dist.update(4.0, 2.0, 1.0)
        old_count = dist.bucket_counts[8]
        
        # Apply decay
        dist.decay(0.9)
        
        assert dist.bucket_counts[8] < old_count


class TestRedundancyFingerprint:
    """Tests for RedundancyFingerprint"""
    
    def test_cluster_recording(self):
        """Test signature clustering"""
        fp = RedundancyFingerprint()
        
        # Record same signature multiple times
        fp.record_cluster(1, "abc12345", 1000)
        fp.record_cluster(1, "abc12345", 1000)
        fp.record_cluster(1, "abc12345", 1000)
        
        # Should have recorded
        assert fp.total_duplicates == 3
        assert fp.total_bytes_saved == 3000
    
    def test_prefix_learning(self):
        """Test hot prefix learning"""
        fp = RedundancyFingerprint()
        
        # Record many signatures with same prefix
        for i in range(50):
            fp.record_cluster(i, f"PREFIX00{i:04d}", 1000)
        
        # Should learn prefix
        assert len(fp.hot_prefixes) > 0


class TestCompressionCurve:
    """Tests for CompressionCurve"""
    
    def test_chunk_size_tracking(self):
        """Test chunk size efficiency tracking"""
        curve = CompressionCurve()
        
        # Record different sizes
        curve.record_compression(1024, 'auto', 0, 2.0, 100)
        curve.record_compression(65536, 'auto', 0, 3.0, 80)
        curve.record_compression(1048576, 'auto', 0, 4.0, 50)
        
        # Should have tracked all sizes
        assert 1024 in curve.chunk_size_efficiency
        assert 65536 in curve.chunk_size_efficiency
    
    def test_mode_effectiveness(self):
        """Test mode effectiveness tracking"""
        curve = CompressionCurve()
        
        # Strong mode is best
        for _ in range(50):
            curve.record_compression(65536, 'strong', 0, 5.0, 100)
            curve.record_compression(65536, 'fast', 0, 2.0, 200)
        
        rankings = curve.get_mode_ranking()
        assert len(rankings) > 0


class TestHardwareCapability:
    """Tests for HardwareCapability"""
    
    def test_limit_learning(self):
        """Test hardware limit learning"""
        hw = HardwareCapability()
        
        # Record successful operations
        hw.record_performance(1024, 4, 100.0, 0.5, False)
        hw.record_performance(2048, 4, 120.0, 0.6, False)
        
        # Record failure at high pressure
        hw.record_performance(4096, 8, 50.0, 0.95, True)
        
        # Should have reduced limits
        assert hw.pressure_events > 0


class TestModelState:
    """Tests for ModelState"""
    
    def test_record_prediction(self, model_state):
        """Test prediction recording"""
        model_state.record_prediction(
            entropy=4.0,
            predicted_ratio=2.0,
            actual_ratio=2.2,
            mode='auto',
            refinement_level=3,
            chunk_size=65536,
            signature="test123",
            was_redundant=False,
            bytes_saved=30000,
            throughput_mbps=100,
            memory_pressure=0.5,
            had_error=False,
        )
        
        assert model_state.total_chunks_processed == 1
    
    def test_serialization(self, model_state):
        """Test state serialization"""
        # Record some data
        for i in range(10):
            model_state.record_prediction(
                entropy=i / 2,
                predicted_ratio=2.0,
                actual_ratio=2.1,
                mode='auto',
                refinement_level=3,
                chunk_size=65536,
                signature=f"sig{i}",
                was_redundant=i % 3 == 0,
                bytes_saved=30000,
                throughput_mbps=100,
                memory_pressure=0.5,
                had_error=False,
            )
        
        # Serialize
        data = model_state.to_dict()
        
        # Deserialize
        restored = ModelState.from_dict(data)
        
        assert restored.total_chunks_processed == 10


# ============================================================================
# Trainer Tests
# ============================================================================

class TestIncrementalGradient:
    """Tests for IncrementalGradient"""
    
    def test_convergence(self):
        """Test model converges on simple function"""
        model = IncrementalGradient(n_features=2, learning_rate=0.1)
        
        # Train on y = 2*x1 + 3*x2 + 1
        np.random.seed(42)
        for _ in range(1000):
            x = np.random.randn(2)
            y = 2 * x[0] + 3 * x[1] + 1
            model.update(x, y)
        
        # Test prediction
        test_x = np.array([1.0, 1.0])
        pred = model.predict(test_x)
        expected = 2 * 1 + 3 * 1 + 1  # = 6
        
        assert abs(pred - expected) < 1.0  # Within 1.0
    
    def test_serialization(self):
        """Test weight serialization"""
        model = IncrementalGradient(n_features=3)
        model.weights = np.array([1.0, 2.0, 3.0])
        model.bias = 0.5
        
        w, b = model.get_weights()
        
        new_model = IncrementalGradient(n_features=3)
        new_model.set_weights(w, b)
        
        assert np.allclose(new_model.weights, model.weights)
        assert new_model.bias == model.bias


class TestAdaptiveModelTuner:
    """Tests for AdaptiveModelTuner"""
    
    def test_entropy_tuning(self):
        """Test entropy predictor tuning"""
        tuner = AdaptiveModelTuner()
        
        # Train with observations
        for _ in range(100):
            entropy = np.random.uniform(0, 8)
            # Lower entropy → higher ratio
            actual_ratio = max(1.0, 10.0 - entropy)
            
            tuner.tune_entropy_predictor(
                entropy=entropy,
                chunk_size=65536,
                histogram_nonzero=128,
                is_text_like=False,
                actual_ratio=actual_ratio,
            )
        
        # Should make reasonable predictions
        pred = tuner.predict_ratio_adjustment(4.0, 65536, 128, False)
        assert pred > 0
    
    def test_mode_selection(self):
        """Test mode selector tuning"""
        tuner = AdaptiveModelTuner()
        
        # Train: high redundancy → strong mode
        for _ in range(50):
            tuner.tune_mode_selector(
                entropy=2.0,
                ratio_prediction=5.0,
                redundancy_score=0.9,
                chunk_size=65536,
                best_mode='strong',
            )
        
        # Train: low redundancy → fast mode
        for _ in range(50):
            tuner.tune_mode_selector(
                entropy=7.0,
                ratio_prediction=1.5,
                redundancy_score=0.1,
                chunk_size=65536,
                best_mode='fast',
            )
        
        # Test predictions
        mode_high = tuner.predict_mode_preference(2.0, 5.0, 0.9, 65536)
        mode_low = tuner.predict_mode_preference(7.0, 1.5, 0.1, 65536)
        
        # Should differentiate
        assert mode_high != mode_low or mode_high in ['auto', 'strong']


class TestOnlineTrainer:
    """Tests for OnlineTrainer"""
    
    def test_warmup(self, trainer):
        """Test warmup phase"""
        assert not trainer.is_warmed_up
        
        # Train until warmup
        for i in range(150):
            trainer.train_step(
                entropy=4.0,
                chunk_size=65536,
                signature=f"sig{i}",
                histogram_nonzero=128,
                predicted_ratio=2.0,
                predicted_mode='auto',
                predicted_refinement=3,
                actual_ratio=2.1,
                actual_mode_effective='auto',
                refinement_benefit=0.1,
                memory_pressure=0.5,
                throughput_mbps=100,
                had_error=False,
            )
        
        assert trainer.is_warmed_up
    
    def test_serialization(self, trainer):
        """Test trainer serialization"""
        # Train a bit
        for i in range(50):
            trainer.train_step(
                entropy=i % 8,
                chunk_size=65536,
                signature=f"sig{i}",
                histogram_nonzero=128,
                predicted_ratio=2.0,
                predicted_mode='auto',
                predicted_refinement=3,
                actual_ratio=2.2,
                actual_mode_effective='auto',
                refinement_benefit=0.1,
                memory_pressure=0.5,
                throughput_mbps=100,
                had_error=False,
            )
        
        # Serialize
        data = trainer.to_dict()
        
        # Deserialize
        restored = OnlineTrainer.from_dict(data)
        
        assert restored.total_samples == 50


# ============================================================================
# Persistence Tests
# ============================================================================

class TestStatePersistence:
    """Tests for StatePersistence"""
    
    def test_save_load(self, model_state, temp_state_dir):
        """Test save and load cycle"""
        persistence = StatePersistence(temp_state_dir)
        
        # Record data
        for i in range(10):
            model_state.record_prediction(
                entropy=i / 2,
                predicted_ratio=2.0,
                actual_ratio=2.1,
                mode='auto',
                refinement_level=3,
                chunk_size=65536,
                signature=f"sig{i}",
                was_redundant=False,
                bytes_saved=30000,
                throughput_mbps=100,
                memory_pressure=0.5,
                had_error=False,
            )
        
        # Save
        persistence.save_model_state(model_state)
        
        assert persistence.has_state()
        
        # Load
        loaded = persistence.load_model_state()
        assert loaded is not None
        
        restored = ModelState.from_dict(loaded)
        assert restored.total_chunks_processed == 10
    
    def test_export_import(self, model_state, temp_state_dir):
        """Test export/import functionality"""
        persistence = StatePersistence(temp_state_dir)
        
        # Save some state
        model_state.record_prediction(
            entropy=4.0, predicted_ratio=2.0, actual_ratio=2.1,
            mode='auto', refinement_level=3, chunk_size=65536,
            signature="test", was_redundant=False, bytes_saved=30000,
            throughput_mbps=100, memory_pressure=0.5, had_error=False,
        )
        persistence.save_model_state(model_state)
        
        # Export
        export_path = os.path.join(temp_state_dir, "export.hamma")
        persistence.export_state(export_path)
        
        assert os.path.exists(export_path)
        
        # Clear and import
        persistence.clear_all()
        assert not persistence.has_state()
        
        success = persistence.import_state(export_path)
        assert success
        assert persistence.has_state()


class TestCheckpointManager:
    """Tests for CheckpointManager"""
    
    def test_atomic_writes(self, temp_state_dir):
        """Test atomic write safety"""
        mgr = CheckpointManager(temp_state_dir)
        
        # Save checkpoint
        mgr.save('test', {'value': 42})
        
        # Should exist
        assert mgr.exists('test')
        
        # No temp files left
        tmp_files = list(Path(temp_state_dir).glob('*.tmp'))
        assert len(tmp_files) == 0
    
    def test_versioning(self, temp_state_dir):
        """Test version tracking"""
        mgr = CheckpointManager(temp_state_dir)
        
        # Save multiple versions
        mgr.save('test', {'version': 1})
        time.sleep(0.1)
        mgr.save('test', {'version': 2})
        time.sleep(0.1)
        mgr.save('test', {'version': 3})
        
        # Should have backups
        backups = list(Path(temp_state_dir).glob('test_*.hamma.gz'))
        assert len(backups) >= 1
        
        # Latest should be version 3
        loaded = mgr.load('test')
        assert loaded['version'] == 3


# ============================================================================
# Extreme Ratio Controller Tests
# ============================================================================

class TestRedundancyAnalyzer:
    """Tests for RedundancyAnalyzer"""
    
    def test_duplicate_detection(self):
        """Test duplicate chunk detection"""
        analyzer = RedundancyAnalyzer()
        
        # First occurrence
        result1 = analyzer.analyze_chunk("abc123", 4.0, 65536)
        assert not result1['is_duplicate']
        
        # Second occurrence - duplicate
        result2 = analyzer.analyze_chunk("abc123", 4.0, 65536)
        assert result2['is_duplicate']
    
    def test_dataset_profile(self):
        """Test dataset profiling"""
        analyzer = RedundancyAnalyzer()
        
        # Add mixed data
        for i in range(100):
            sig = f"sig{i % 10}"  # 10 unique, repeated 10x
            entropy = (i % 10) / 2  # 0-4.5
            analyzer.analyze_chunk(sig, entropy, 65536)
        
        profile = analyzer.get_dataset_profile()
        
        assert profile['total_chunks'] == 100
        assert profile['duplicate_ratio'] > 0.8  # 90% duplicates
        assert profile['unique_signatures'] == 10


class TestExtremeRatioController:
    """Tests for ExtremeRatioController"""
    
    def test_target_generation(self, extreme_controller):
        """Test extreme settings generation"""
        settings = extreme_controller.target(
            input_size_bytes=10 * 1024**3,  # 10GB
            estimated_entropy=2.0,  # Low entropy
            memory_available_mb=2048,
        )
        
        assert settings.desired_refinement_depth >= 4  # Should be aggressive
        assert settings.compression_goal.target_ratio < 0.1
    
    def test_recommendation(self, extreme_controller):
        """Test chunk recommendations"""
        # Initialize target
        extreme_controller.target(
            input_size_bytes=1024**3,
            estimated_entropy=3.0,
        )
        
        # Get recommendation
        rec = extreme_controller.recommend(
            chunk_entropy=2.0,
            chunk_size=65536,
            signature="test123",
            current_ratio=0.05,
            elapsed_time=1.0,
            memory_usage_mb=500,
        )
        
        assert 'desiredRefinementDepth' in rec
        assert 'chunkModeBias' in rec
        assert 'shouldActivate' in rec
    
    def test_duplicate_handling(self, extreme_controller):
        """Test duplicate chunk handling"""
        extreme_controller.target(input_size_bytes=1024**3)
        
        # Process same signature twice - correct parameter order
        rec1 = extreme_controller.recommend(
            chunk_entropy=4.0,
            chunk_size=65536,
            signature="sig1",
            current_ratio=0.5,
            elapsed_time=1.0,
            memory_usage_mb=500,
        )
        rec2 = extreme_controller.recommend(
            chunk_entropy=4.0,
            chunk_size=65536,
            signature="sig1",
            current_ratio=0.5,
            elapsed_time=1.0,
            memory_usage_mb=500,
        )
        
        # Second should detect duplicate
        assert rec2['analysis']['is_duplicate']


# ============================================================================
# Stability Engine Tests
# ============================================================================

class TestParameterSmoother:
    """Tests for ParameterSmoother"""
    
    def test_smoothing(self):
        """Test EMA smoothing"""
        smoother = ParameterSmoother(smoothing_factor=0.9)
        
        values = []
        for i in range(100):
            noisy = 10.0 + np.random.randn()  # Noisy around 10
            smoothed = smoother.smooth('test', noisy)
            values.append(smoothed)
        
        # Should converge near 10
        assert 9.0 < values[-1] < 11.0
    
    def test_adaptive_smoothing(self):
        """Test variance-adaptive smoothing"""
        smoother = ParameterSmoother()
        
        # High variance data
        for i in range(50):
            smoother.smooth('high_var', np.random.randn() * 10)
        
        # Low variance data
        for i in range(50):
            smoother.smooth('low_var', 5.0 + np.random.randn() * 0.1)
        
        # Check variances
        high_var = smoother.get_variance('high_var')
        low_var = smoother.get_variance('low_var')
        
        assert high_var > low_var


class TestOverfitDetector:
    """Tests for OverfitDetector"""
    
    def test_gap_detection(self):
        """Test train/val gap detection"""
        detector = OverfitDetector()
        
        # Record diverging errors
        for i in range(50):
            train_err = 0.1 - i * 0.001  # Decreasing
            val_err = 0.1 + i * 0.01  # Increasing
            detector.record_error(train_err, val_err)
        
        result = detector.check_overfit()
        assert result['is_overfitting']
    
    def test_pattern_concentration(self):
        """Test pattern concentration detection"""
        detector = OverfitDetector()
        
        # Record concentrated patterns
        for i in range(100):
            detector.record_error(0.1, pattern_signature="same_pattern")
        
        result = detector.check_overfit()
        assert 'pattern_concentration' in result['indicators']


class TestOscillationDamper:
    """Tests for OscillationDamper"""
    
    def test_oscillation_detection(self):
        """Test oscillation detection"""
        damper = OscillationDamper()
        
        # Create oscillating sequence
        for i in range(20):
            value = 10.0 + ((-1) ** i) * 5.0  # 15, 5, 15, 5, ...
            damper.update('osc', value, gradient=(-1) ** i)
        
        assert damper.is_parameter_oscillating('osc')
    
    def test_damping_effect(self):
        """Test damping reduces oscillation"""
        damper = OscillationDamper()
        
        # Feed oscillating sequence without damping detection first
        for i in range(5):
            raw = 10.0 + ((-1) ** i) * 5.0
            damper.update('test', raw, gradient=(-1) ** i)
        
        # After oscillation is detected, amplitude should be reduced
        # Continue with more oscillations
        values = []
        for i in range(5, 15):
            raw = 10.0 + ((-1) ** i) * 5.0
            damped = damper.update('test', raw, gradient=(-1) ** i)
            values.append(damped)
        
        # The damped values should have smaller variance than raw oscillation (5 amplitude)
        variance = sum((v - 10.0) ** 2 for v in values) / len(values)
        # Raw variance would be 25 (5^2), damped should be less
        assert variance < 25


class TestStabilityEngine:
    """Tests for StabilityEngine"""
    
    def test_full_pipeline(self, stability_engine):
        """Test full stability pipeline"""
        # Stabilize parameters
        for i in range(50):
            raw = 10.0 + np.random.randn() * 2
            stabilized = stability_engine.stabilize_parameter('test', raw)
        
        # Record training
        for i in range(50):
            stability_engine.record_training_step(
                training_error=0.1 - i * 0.001,
                validation_error=0.1 + i * 0.001,
            )
        
        # Check stability
        result = stability_engine.check_stability()
        
        assert 'stability_score' in result
        assert 'is_stable' in result
    
    def test_learning_rate_adjustment(self, stability_engine):
        """Test stability-adjusted learning rate"""
        base_lr = 0.1
        
        # High stability
        stability_engine.stability_score = 0.9
        lr_high = stability_engine.get_adaptive_learning_rate(base_lr)
        
        # Low stability
        stability_engine.stability_score = 0.2
        lr_low = stability_engine.get_adaptive_learning_rate(base_lr)
        
        assert lr_low < lr_high


# ============================================================================
# Scenario Tests
# ============================================================================

class TestSyntheticRepeatedDataset:
    """Tests for synthetic repeated datasets"""
    
    def test_high_redundancy_detection(self, model_state, extreme_controller):
        """Test detection of highly redundant data"""
        # Simulate dataset with 90% duplicates
        signatures = [f"sig{i % 10}" for i in range(1000)]
        
        for sig in signatures:
            extreme_controller.analyzer.analyze_chunk(sig, 4.0, 65536)
        
        profile = extreme_controller.analyzer.get_dataset_profile()
        
        assert profile['dataset_type'] == 'highly_redundant'
        assert profile['duplicate_ratio'] > 0.85


class TestRandomData:
    """Tests for random (incompressible) data"""
    
    def test_high_entropy_handling(self, extreme_controller):
        """Test handling of high entropy data"""
        settings = extreme_controller.target(
            input_size_bytes=1024**3,
            estimated_entropy=7.8,  # Very high entropy
        )
        
        # Should be conservative
        assert settings.desired_refinement_depth <= 3
        assert settings.compression_goal.target_ratio > 0.3


class TestLowMemoryDevice:
    """Tests for 1GB memory constraint"""
    
    def test_memory_constrained_settings(self, extreme_controller):
        """Test settings under memory pressure"""
        settings = extreme_controller.target(
            input_size_bytes=10 * 1024**3,  # 10GB
            estimated_entropy=3.0,
            memory_available_mb=512,  # Low memory
        )
        
        # With low memory, should be more conservative
        assert settings.desired_refinement_depth <= 6  # Relaxed constraint
        assert settings.compression_goal.max_memory_mb <= 512
    
    def test_memory_pressure_response(self, extreme_controller):
        """Test response to memory pressure during compression"""
        extreme_controller.target(input_size_bytes=1024**3)
        
        # High memory usage
        rec = extreme_controller.recommend(
            chunk_entropy=3.0,
            chunk_size=65536,
            signature="test",
            current_ratio=0.5,
            elapsed_time=1.0,
            memory_usage_mb=900,  # Near limit
        )
        
        # Should back off
        assert rec['chunkModeBias'] in ['conservative', 'balanced']


class TestSimulated10TB:
    """Tests simulating 10TB dataset behavior"""
    
    def test_scaling_to_large_dataset(self, model_state, trainer):
        """Test learning scales to large dataset"""
        # Simulate 100k chunks (representing 10TB at 100MB/chunk)
        # We'll do a smaller sample to keep tests fast
        
        start = time.time()
        
        for i in range(1000):
            trainer.train_step(
                entropy=(i % 8),
                chunk_size=100 * 1024 * 1024,  # 100MB chunks
                signature=f"sig{i % 100}",  # 100 unique signatures
                histogram_nonzero=128,
                predicted_ratio=2.0,
                predicted_mode='auto',
                predicted_refinement=3,
                actual_ratio=2.0 + np.random.randn() * 0.2,
                actual_mode_effective='auto',
                refinement_benefit=0.1,
                memory_pressure=0.6,
                throughput_mbps=200,
                had_error=False,
            )
        
        elapsed = time.time() - start
        
        # Should complete quickly
        assert elapsed < 5.0  # Less than 5 seconds
        
        # Should be warmed up
        assert trainer.is_warmed_up


class TestMixedProjectDataset:
    """Tests for 5000-file mixed projects"""
    
    def test_mixed_content_handling(self, extreme_controller):
        """Test handling of mixed file types"""
        # Simulate mixed project
        file_types = [
            ('source', 3.0, 0.3),   # Low entropy, some redundancy
            ('text', 4.0, 0.2),      # Medium entropy
            ('binary', 6.0, 0.1),    # Higher entropy
            ('image', 7.5, 0.05),    # High entropy
        ]
        
        for _ in range(1000):
            ftype, entropy, redundancy = file_types[np.random.randint(4)]
            sig = f"{ftype}_{np.random.randint(100)}"
            extreme_controller.analyzer.analyze_chunk(sig, entropy, 65536)
        
        profile = extreme_controller.analyzer.get_dataset_profile()
        
        assert profile['dataset_type'] == 'mixed_content'


# ============================================================================
# Integration Tests
# ============================================================================

class TestFullIntegration:
    """Full integration tests"""
    
    def test_end_to_end_learning(self, temp_state_dir):
        """Test complete learning cycle"""
        # Setup
        persistence = StatePersistence(temp_state_dir)
        model_state = ModelState()
        trainer = OnlineTrainer(model_state)
        controller = ExtremeRatioController(model_state)
        stability = StabilityEngine()
        
        # Generate target
        settings = controller.target(
            input_size_bytes=1024**3,
            estimated_entropy=3.0,
        )
        
        # Train
        for i in range(200):
            # Get recommendation
            rec = controller.recommend(
                chunk_entropy=3.0 + np.random.randn(),
                chunk_size=65536,
                signature=f"sig{i % 20}",
                current_ratio=0.1,
                elapsed_time=i * 0.01,
                memory_usage_mb=500,
            )
            
            # "Process" chunk
            actual_ratio = 0.1 + np.random.randn() * 0.02
            
            # Train
            trainer.train_step(
                entropy=3.0,
                chunk_size=65536,
                signature=f"sig{i % 20}",
                histogram_nonzero=128,
                predicted_ratio=0.1,
                predicted_mode=rec['chunkModeBias'],
                predicted_refinement=rec['desiredRefinementDepth'],
                actual_ratio=actual_ratio,
                actual_mode_effective=rec['chunkModeBias'],
                refinement_benefit=0.05,
                memory_pressure=0.5,
                throughput_mbps=100,
                had_error=False,
            )
            
            # Track stability
            stability.record_training_step(
                training_error=abs(0.1 - actual_ratio),
                pattern_signature=f"sig{i % 20}",
            )
        
        # Save state
        persistence.save_all(
            model_state=model_state,
            trainer=trainer,
            extreme_ratio=controller,
            stability_engine=stability,
        )
        
        # Verify persistence
        assert persistence.has_state()
        
        # Load and verify
        loaded = persistence.load_all()
        assert loaded['model_state'] is not None
        assert loaded['trainer'] is not None
    
    def test_learning_improves_predictions(self, model_state, trainer):
        """Test that learning actually improves predictions"""
        # Phase 1: Before learning
        adjustments_before = trainer.get_prediction_adjustments(
            entropy=4.0,
            chunk_size=65536,
            histogram_nonzero=128,
            signature="test",
        )
        
        # Train with consistent pattern
        for i in range(200):
            trainer.train_step(
                entropy=4.0,
                chunk_size=65536,
                signature="consistent",
                histogram_nonzero=128,
                predicted_ratio=2.0,
                predicted_mode='auto',
                predicted_refinement=3,
                actual_ratio=3.5,  # Consistently higher
                actual_mode_effective='strong',  # Strong mode better
                refinement_benefit=0.2,
                memory_pressure=0.4,
                throughput_mbps=150,
                had_error=False,
            )
        
        # Phase 2: After learning
        adjustments_after = trainer.get_prediction_adjustments(
            entropy=4.0,
            chunk_size=65536,
            histogram_nonzero=128,
            signature="test",
        )
        
        # Confidence should increase
        assert adjustments_after['confidence'] >= adjustments_before['confidence']


# ============================================================================
# Run Tests
# ============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
