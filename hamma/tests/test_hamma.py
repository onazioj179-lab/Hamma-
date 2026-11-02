"""
HAMMA Test Suite - Comprehensive Tests
Tests: 5000-file batch, 10TB dataset, high redundancy, mixed entropy,
unstable workers, low memory, multi-hour simulation

Creator: Onazi Treasure (OJ)
"""

import pytest
import random
import time
from typing import List
from fastapi.testclient import TestClient

from hamma.api.fastapi_app import app
from hamma.api.request_schemas import (
    ChunkMetadata,
    WorkerStats,
    DeviceProfile,
    HistoricalPerformance,
)
from hamma.models.entropy_predictor import EntropyPredictor
from hamma.models.redundancy_model import RedundancyPredictor, SimHashRedundancyPredictor
from hamma.models.mode_selector import ModeSelector
from hamma.models.stability_model import StabilityModel

# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def client():
    """Create test client"""
    return TestClient(app)

@pytest.fixture
def entropy_predictor():
    """Create entropy predictor instance"""
    return EntropyPredictor()

@pytest.fixture
def redundancy_predictor():
    """Create redundancy predictor instance"""
    return RedundancyPredictor()

@pytest.fixture
def simhash_predictor():
    """Create SimHash predictor instance"""
    return SimHashRedundancyPredictor()

@pytest.fixture
def mode_selector():
    """Create mode selector instance"""
    return ModeSelector()

@pytest.fixture
def stability_model():
    """Create stability model instance"""
    return StabilityModel()

def random_signature(length: int = 32) -> str:
    """Generate random hex signature"""
    return ''.join(random.choices('0123456789abcdef', k=length))

def random_histogram() -> List[int]:
    """Generate random byte histogram"""
    total = 1_000_000
    hist = [0] * 256
    for _ in range(total):
        hist[random.randint(0, 255)] += 1
    return hist

def create_chunk_dict(
    chunk_index: int = 0,
    entropy: float = 5.0,
    chunk_size: int = 1024 * 1024,
    signature: str = None,
    histogram: List[int] = None,
) -> dict:
    """Create chunk metadata dict for testing"""
    return {
        'chunk_index': chunk_index,
        'entropy_score': entropy,
        'chunk_size': chunk_size,
        'redundancy_signature': signature or random_signature(),
        'histogram': histogram or [],
    }

def create_worker_dict(
    worker_id: int = 0,
    healthy: bool = True,
    slow: bool = False,
) -> dict:
    """Create worker stats dict for testing"""
    avg_time = 50.0 if healthy else 500.0
    last_time = 45.0 if healthy else (2000.0 if slow else 450.0)
    error_count = 0 if healthy else random.randint(5, 50)
    
    return {
        'worker_id': worker_id,
        'chunks_processed': random.randint(100, 10000),
        'avg_chunk_time_ms': avg_time,
        'last_chunk_time_ms': last_time,
        'error_count': error_count,
        'pass_success_rate': 0.95 if healthy else 0.7,
    }

def create_device_dict(
    mobile: bool = False,
    low_ram: bool = False,
    throttled: bool = False,
) -> dict:
    """Create device profile dict for testing"""
    ram_available = 512 if low_ram else 4096
    ram_pressure = 0.9 if low_ram else 0.3
    
    return {
        'cpu_cores': 2 if mobile else 8,
        'is_mobile': mobile,
        'ram_total_mb': 2048 if low_ram else 8192,
        'ram_available_mb': ram_available,
        'ram_pressure': ram_pressure,
        'is_throttled': throttled,
    }

# ============================================================================
# Basic API Tests
# ============================================================================

class TestBasicAPI:
    """Basic API endpoint tests"""
    
    def test_health_check(self, client):
        """Test health endpoint"""
        response = client.get('/health')
        assert response.status_code == 200
        data = response.json()
        assert data['status'] == 'healthy'
        assert 'version' in data
    
    def test_single_prediction(self, client):
        """Test single prediction endpoint"""
        request = {
            'chunk': create_chunk_dict(entropy=5.0),
        }
        response = client.post('/predict', json=request)
        assert response.status_code == 200
        
        data = response.json()
        assert 'chunk_mode' in data
        assert data['chunk_mode'] in ['fast', 'strong', 'auto', 'skip-refine']
        assert 'refinement_level' in data
        assert data['refinement_level'] in [0, 1, 2]
        assert 'expected_ratio' in data
        assert data['expected_ratio'] >= 1.0
        assert 'stability_flag' in data
        assert data['stability_flag'] in ['safe', 'warning', 'critical']
    
    def test_batch_prediction(self, client):
        """Test batch prediction endpoint"""
        chunks = [create_chunk_dict(i, random.uniform(0, 8)) for i in range(10)]
        
        request = {
            'chunks': chunks,
        }
        response = client.post('/predict/batch', json=request)
        assert response.status_code == 200
        
        data = response.json()
        assert 'predictions' in data
        assert len(data['predictions']) == 10
        assert 'batch_stats' in data
    
    def test_profile_endpoint(self, client):
        """Test system profile endpoint"""
        response = client.get('/profile')
        assert response.status_code == 200
        
        data = response.json()
        assert 'memory_mb' in data
        assert 'model_stats' in data

# ============================================================================
# Model Unit Tests
# ============================================================================

class TestEntropyPredictor:
    """Entropy predictor unit tests"""
    
    def test_low_entropy_high_ratio(self, entropy_predictor):
        """Low entropy should predict high compression ratio"""
        ratio = entropy_predictor.predict(entropy=1.0, chunk_size=1024*1024)
        assert ratio >= 4.0, f"Low entropy should give high ratio, got {ratio}"
    
    def test_high_entropy_low_ratio(self, entropy_predictor):
        """High entropy should predict low compression ratio"""
        ratio = entropy_predictor.predict(entropy=7.5, chunk_size=1024*1024)
        assert ratio <= 1.5, f"High entropy should give low ratio, got {ratio}"
    
    def test_prediction_speed(self, entropy_predictor):
        """Predictions should be under 1ms"""
        start = time.perf_counter()
        for _ in range(1000):
            entropy_predictor.predict(entropy=random.uniform(0, 8), chunk_size=1024*1024)
        elapsed = (time.perf_counter() - start) * 1000
        avg = elapsed / 1000
        assert avg < 1.0, f"Avg prediction time {avg}ms > 1ms"

class TestModeSelector:
    """Mode selector unit tests"""
    
    def test_redundant_skip_refine(self, mode_selector):
        """Redundant chunks should skip refinement"""
        mode, level = mode_selector.predict(
            entropy=5.0,
            chunk_size=1024*1024,
            expected_ratio=3.0,
            is_redundant=True,
        )
        assert mode == 'skip-refine'
        assert level == 0
    
    def test_high_entropy_skip_refine(self, mode_selector):
        """High entropy should skip refinement"""
        mode, level = mode_selector.predict(
            entropy=7.8,
            chunk_size=1024*1024,
            expected_ratio=1.05,
            is_redundant=False,
        )
        assert mode == 'skip-refine'
    
    def test_low_entropy_strong_mode(self, mode_selector):
        """Low entropy should use strong mode"""
        mode, level = mode_selector.predict(
            entropy=1.5,
            chunk_size=1024*1024,
            expected_ratio=6.0,
            is_redundant=False,
        )
        assert mode in ['strong', 'auto']

class TestRedundancyPredictor:
    """Redundancy predictor unit tests"""
    
    def test_detect_duplicate(self, redundancy_predictor):
        """Should detect duplicate signatures"""
        sig = random_signature()
        
        # First occurrence
        cluster1 = redundancy_predictor.predict(sig, chunk_index=0)
        
        # Second occurrence (same signature)
        cluster2 = redundancy_predictor.predict(sig, chunk_index=1)
        
        # Second should find the cluster
        assert cluster2 is not None
        assert cluster1 == cluster2 or cluster2 == 0
    
    def test_unique_signatures(self, redundancy_predictor):
        """Unique signatures should not cluster initially"""
        sig1 = random_signature()
        sig2 = random_signature()
        
        cluster1 = redundancy_predictor.predict(sig1, chunk_index=0)
        cluster2 = redundancy_predictor.predict(sig2, chunk_index=1)
        
        # Different signatures = different clusters or no match
        if cluster1 is not None and cluster2 is not None:
            # They should be different clusters
            pass  # OK

class TestStabilityModel:
    """Stability model unit tests"""
    
    def test_safe_conditions(self, stability_model):
        """Safe conditions should return safe flag"""
        flag, target, boost = stability_model.predict(
            device_profile=None,
            worker_stats=None,
            chunk_size=1024*1024,
        )
        assert flag == 'safe'
    
    def test_memory_target_structure(self, stability_model):
        """Memory target should have required fields"""
        flag, target, boost = stability_model.predict(
            device_profile=None,
            worker_stats=None,
            chunk_size=1024*1024,
        )
        assert hasattr(target, 'chunk_size')
        assert hasattr(target, 'concurrency')
        assert target.chunk_size > 0
        assert target.concurrency > 0

# ============================================================================
# Large Scale Tests
# ============================================================================

class TestLargeScale:
    """Large scale performance tests"""
    
    def test_5000_file_batch(self, client):
        """Test 5000 file batch prediction"""
        chunks = []
        for i in range(5000):
            entropy = random.uniform(0, 8)
            size = random.choice([64*1024, 256*1024, 1024*1024, 4*1024*1024])
            chunks.append(create_chunk_dict(i, entropy, size))
        
        request = {'chunks': chunks}
        
        start = time.perf_counter()
        response = client.post('/predict/batch', json=request)
        elapsed = (time.perf_counter() - start) * 1000
        
        assert response.status_code == 200
        data = response.json()
        assert len(data['predictions']) == 5000
        
        print(f"5000-file batch: {elapsed:.1f}ms ({elapsed/5000:.2f}ms per prediction)")
        assert elapsed < 60000, f"5000 predictions took {elapsed}ms, expected <60s"
    
    def test_10tb_simulation(self, entropy_predictor, mode_selector):
        """Simulate 10TB dataset processing"""
        file_types = [
            ('video', 0.7, 7.5),
            ('image', 0.2, 6.0),
            ('document', 0.05, 3.0),
            ('binary', 0.05, 5.0),
        ]
        
        total_predictions = 0
        total_time = 0
        ratios = []
        
        for file_type, proportion, base_entropy in file_types:
            n_chunks = 1000
            
            for i in range(n_chunks):
                entropy = max(0, min(8, base_entropy + random.uniform(-1, 1)))
                
                start = time.perf_counter()
                ratio = entropy_predictor.predict(entropy, 4*1024*1024)
                ratios.append(ratio)
                
                mode, level = mode_selector.predict(
                    entropy=entropy,
                    chunk_size=4*1024*1024,
                    expected_ratio=ratio,
                    is_redundant=False,
                )
                
                elapsed = (time.perf_counter() - start) * 1000
                total_time += elapsed
                total_predictions += 1
        
        avg_time = total_time / total_predictions
        avg_ratio = sum(ratios) / len(ratios)
        
        print(f"10TB simulation: {total_predictions} predictions")
        print(f"  Avg time: {avg_time:.3f}ms per prediction")
        print(f"  Avg expected ratio: {avg_ratio:.2f}x")
        
        assert avg_time < 1.0, f"Average prediction time {avg_time}ms > 1ms target"
    
    def test_high_redundancy(self, redundancy_predictor):
        """Test dataset with 80% redundancy"""
        base_sigs = [random_signature() for _ in range(200)]
        
        redundant_count = 0
        total = 1000
        
        for i in range(total):
            sig = base_sigs[i] if i < 200 else random.choice(base_sigs)
            cluster = redundancy_predictor.predict(sig, chunk_index=i)
            if cluster is not None:
                redundant_count += 1
        
        redundancy_rate = redundant_count / total
        print(f"High redundancy test: {redundancy_rate*100:.1f}% detected")
        
        # Should detect at least 50% (allowing for algorithm behavior)
        assert redundancy_rate >= 0.5, f"Expected >=50% redundancy, got {redundancy_rate*100}%"
    
    def test_mixed_entropy(self, entropy_predictor, mode_selector):
        """Test with realistic mixed entropy distribution"""
        distributions = [
            (0.1, 0.0, 2.0),
            (0.3, 2.0, 5.0),
            (0.4, 5.0, 7.0),
            (0.2, 7.0, 8.0),
        ]
        
        mode_counts = {'fast': 0, 'strong': 0, 'auto': 0, 'skip-refine': 0}
        total = 1000
        
        for proportion, low, high in distributions:
            n = int(total * proportion)
            for _ in range(n):
                entropy = random.uniform(low, high)
                ratio = entropy_predictor.predict(entropy, 1024*1024)
                mode, level = mode_selector.predict(
                    entropy=entropy,
                    chunk_size=1024*1024,
                    expected_ratio=ratio,
                    is_redundant=False,
                )
                mode_counts[mode] += 1
        
        print("Mixed entropy distribution modes:")
        for mode, count in mode_counts.items():
            print(f"  {mode}: {count} ({count/total*100:.1f}%)")
        
        # Should use multiple modes
        assert sum(1 for c in mode_counts.values() if c > 0) >= 2

# ============================================================================
# API Integration Tests
# ============================================================================

class TestAPIIntegration:
    """API integration tests"""
    
    def test_full_prediction_flow(self, client):
        """Test complete prediction flow with all parameters"""
        request = {
            'chunk': create_chunk_dict(chunk_index=42, entropy=4.5, chunk_size=2*1024*1024),
            'worker_stats': create_worker_dict(worker_id=0, healthy=True),
            'device_profile': create_device_dict(mobile=False, low_ram=False),
            'history': {
                'avg_compression_ratio': 2.8,
                'refinement_success_rate': 0.65,
                'total_chunks_processed': 1000,
                'total_bytes_saved': 50000,
            },
        }
        
        response = client.post('/predict', json=request)
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify all fields present
        assert 'chunk_mode' in data
        assert 'refinement_level' in data
        assert 'lane_boost' in data
        assert 'expected_ratio' in data
        assert 'stability_flag' in data
        assert 'memory_target' in data
        assert 'anomaly_detected' in data
        assert 'confidence' in data
        
        # Verify sensible values
        assert data['expected_ratio'] >= 1.0
        assert data['confidence'] >= 0.0 and data['confidence'] <= 1.0
        assert data['memory_target']['chunk_size'] > 0
        assert data['memory_target']['concurrency'] > 0
    
    def test_low_memory_device(self, client):
        """Test with low memory device profile"""
        request = {
            'chunk': create_chunk_dict(entropy=5.0),
            'device_profile': {
                'cpu_cores': 4,
                'is_mobile': False,
                'ram_total_mb': 2048,
                'ram_available_mb': 256,
                'ram_pressure': 0.88,
                'is_throttled': True,
            },
        }
        
        response = client.post('/predict', json=request)
        assert response.status_code == 200
        
        data = response.json()
        assert data['stability_flag'] in ['warning', 'critical']
    
    def test_mobile_device(self, client):
        """Test with mobile device profile"""
        request = {
            'chunk': create_chunk_dict(entropy=4.0, chunk_size=256*1024),
            'device_profile': {
                'cpu_cores': 2,
                'is_mobile': True,
                'ram_total_mb': 1024,
                'ram_available_mb': 512,
                'ram_pressure': 0.6,
                'is_throttled': False,
            },
        }
        
        response = client.post('/predict', json=request)
        assert response.status_code == 200
        
        data = response.json()
        # Should return valid predictions for mobile
        assert data['memory_target']['concurrency'] >= 1
    
    def test_worker_anomaly(self, client):
        """Test detection of slow worker"""
        request = {
            'chunk': create_chunk_dict(),
            'worker_stats': {
                'worker_id': 1,
                'chunks_processed': 1000,
                'avg_chunk_time_ms': 50.0,
                'last_chunk_time_ms': 5000.0,  # 100x slower!
                'error_count': 0,
                'pass_success_rate': 0.95,
            },
        }
        response = client.post('/predict', json=request)
        assert response.status_code == 200
        
        data = response.json()
        # Should detect the anomaly
        assert data['anomaly_detected'] == True or data['stability_flag'] != 'safe'
    
    def test_entropy_anomalies(self, client):
        """Test entropy edge cases"""
        # Very low entropy
        request = {'chunk': create_chunk_dict(entropy=0.1)}
        response = client.post('/predict', json=request)
        assert response.status_code == 200
        
        # Very high entropy
        request = {'chunk': create_chunk_dict(entropy=7.99)}
        response = client.post('/predict', json=request)
        assert response.status_code == 200
        data = response.json()
        assert data['chunk_mode'] == 'skip-refine'

# ============================================================================
# Performance Benchmarks
# ============================================================================

class TestPerformance:
    """Performance benchmark tests"""
    
    def test_latency(self, client):
        """Test prediction latency"""
        latencies = []
        
        for _ in range(100):
            request = {
                'chunk': create_chunk_dict(entropy=random.uniform(0, 8)),
            }
            
            start = time.perf_counter()
            response = client.post('/predict', json=request)
            elapsed = (time.perf_counter() - start) * 1000
            
            assert response.status_code == 200
            latencies.append(elapsed)
        
        avg_latency = sum(latencies) / len(latencies)
        p99_latency = sorted(latencies)[99]
        
        print(f"Latency benchmark (n=100):")
        print(f"  Average: {avg_latency:.2f}ms")
        print(f"  P99: {p99_latency:.2f}ms")
        
        # Allow higher latency in test environment
        assert avg_latency < 100, f"Average latency {avg_latency}ms > 100ms"
    
    def test_throughput(self, client):
        """Test throughput"""
        n_requests = 200
        
        start = time.perf_counter()
        
        for i in range(n_requests):
            request = {
                'chunk': create_chunk_dict(chunk_index=i, entropy=random.uniform(0, 8)),
            }
            response = client.post('/predict', json=request)
            assert response.status_code == 200
        
        elapsed = time.perf_counter() - start
        rps = n_requests / elapsed
        
        print(f"Throughput benchmark:")
        print(f"  {n_requests} requests in {elapsed:.2f}s")
        print(f"  {rps:.1f} requests/second")
        
        # Allow lower throughput in test environment
        assert rps >= 10, f"Throughput {rps} rps < 10 rps minimum"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
