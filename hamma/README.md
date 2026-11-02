# HAMMA - High-speed AI-powered Metadata-only Machine Acceleration

**Creator: Onazi Treasure (OJ)**

HAMMA is a Python-powered AI acceleration engine for SPK compression optimization.
It predicts the best compression modes, detects redundancy, and optimizes large datasets
without reading file content - only metadata.

## 🎯 Current Status (December 2025)

**Version: 2.0.0** - HAMMA EXTREME Self-Learning Layer Complete

| Component | Status | Tests |
|-----------|--------|-------|
| Core API (FastAPI) | ✅ Complete | 25/25 |
| HAMMA EXTREME | ✅ Complete | 41/41 |
| **Total** | **✅ All Working** | **66/66** |

## Features

### Core Features
- **<5ms response time** - Ultra-fast predictions for real-time optimization
- **100+ requests/second** - High throughput for large datasets
- **~50MB memory footprint** - Lightweight enough for 1GB devices
- **Metadata-only** - No file content access required
- **4 Core Models**:
  - EntropyPredictor: Compression ratio estimation
  - RedundancyPredictor: Duplicate detection via SimHash
  - ModeSelector: Optimal compression mode classification
  - StabilityModel: System health and resource management

### HAMMA EXTREME (Self-Learning Layer)
- **Online Learning** - Improves predictions over time without storing history
- **Extreme Compression** - Target 10TB → ~1GB for redundant datasets
- **State Persistence** - Saves/loads learned parameters across sessions
- **Stability Engine** - Prevents overfitting and parameter oscillation

## Quick Start

### Start the Server

```bash
cd singularity-pack/hamma
python -m uvicorn hamma.api.fastapi_app:app --host 0.0.0.0 --port 8777
```

Or use the server script:

```bash
python -m hamma.server --host 0.0.0.0 --port 8777
```

### API Endpoints

#### Core Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/predict` | POST | Single chunk prediction |
| `/predict/batch` | POST | Batch predictions |
| `/ws/predict` | WS | WebSocket streaming |
| `/health` | GET | Health check |
| `/profile` | GET | Performance metrics |

#### EXTREME Endpoints (Self-Learning)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/extreme/feedback` | POST | Submit learning feedback |
| `/extreme/target` | POST | Generate extreme compression settings |
| `/extreme/recommend` | POST | Get chunk-level recommendations |
| `/extreme/stats` | GET | Learning statistics |
| `/extreme/progress` | GET | Compression progress |
| `/extreme/save` | POST | Persist learned state |
| `/extreme/reset` | POST | Reset all learning |
| `/extreme/stability` | GET | Stability report |

### Request Example

```json
{
  "chunk": {
    "chunk_index": 42,
    "entropy_score": 4.5,
    "chunk_size": 2097152,
    "redundancy_signature": "abcd1234efgh5678",
    "histogram": []
  },
  "device_profile": {
    "cpu_cores": 8,
    "is_mobile": false,
    "ram_total_mb": 8192,
    "ram_available_mb": 4096,
    "ram_pressure": 0.5,
    "is_throttled": false
  }
}
```

### Response Example

```json
{
  "chunk_mode": "strong",
  "refinement_level": 2,
  "lane_boost": true,
  "expected_ratio": 3.5,
  "stability_flag": "safe",
  "memory_target": {
    "chunk_size": 4194304,
    "concurrency": 8
  },
  "anomaly_detected": false,
  "confidence": 0.85,
  "redundancy_cluster": null
}
```

## TypeScript Integration

```typescript
import { HammaClient, predictFallback } from './engine/hamma';

// Create client
const hamma = new HammaClient({
  endpoint: 'http://localhost:8777',
  timeout: 5000,
});

// Connect
await hamma.connect();

// Predict
const prediction = await hamma.predict({
  chunk_index: 0,
  entropy_score: 5.0,
  chunk_size: 1024 * 1024,
  redundancy_signature: 'abc123',
  histogram: [],
});

// Use fallback when server unavailable
const fallback = predictFallback(chunkMetadata);
```

## Model Details

### EntropyPredictor

Predicts compression ratio based on Shannon entropy (0-8).

| Entropy | Expected Ratio |
|---------|---------------|
| 0-2 | 4-8x |
| 2-4 | 2.5-4x |
| 4-6 | 1.5-2.5x |
| 6-8 | 1-1.5x |

### ModeSelector

Classifies chunks into compression modes:

- **fast**: Speed priority, acceptable ratio
- **strong**: Best ratio, slower
- **auto**: Balanced approach
- **skip-refine**: Skip refinement (random/encrypted data)

### RedundancyPredictor

Detects duplicate chunks using:
- Exact hash matching
- SimHash for near-duplicates (Hamming distance <= 4)

### StabilityModel

Monitors system health:
- Memory pressure (safe/warning/critical)
- Worker timing variance
- Error rates
- Thermal throttling

## Testing

```bash
cd singularity-pack
python -m pytest hamma/tests/test_hamma.py -v
```

## Performance Targets

| Metric | Target | Achieved |
|--------|--------|----------|
| Single prediction latency | <5ms | ✓ |
| Throughput | 100+ rps | ✓ |
| Memory footprint | ~50MB | ✓ |
| Batch (5000 chunks) | <30s | ✓ |

## Architecture

```
hamma/
├── __init__.py
├── server.py              # Entry point
├── api/
│   ├── __init__.py
│   ├── fastapi_app.py     # FastAPI application (v2.0 with EXTREME)
│   └── request_schemas.py # Pydantic models
├── models/
│   ├── __init__.py
│   ├── entropy_predictor.py
│   ├── redundancy_model.py
│   ├── mode_selector.py
│   └── stability_model.py
├── self_learning/         # HAMMA EXTREME (NEW)
│   ├── __init__.py
│   ├── model_state.py     # EntropyDistribution, RedundancyFingerprint, etc.
│   ├── trainer.py         # OnlineTrainer, IncrementalGradient
│   ├── persistence.py     # StatePersistence, CheckpointManager
│   ├── extreme_ratio.py   # ExtremeRatioController
│   └── stability_engine.py # StabilityEngine, OverfitDetector
└── tests/
    ├── __init__.py
    ├── test_hamma.py      # Core API tests (25)
    └── test_extreme.py    # EXTREME tests (41)
```

## HAMMA EXTREME Components

### Model State (`model_state.py`)
- **EntropyDistribution**: Rolling entropy→ratio correlations (17 buckets)
- **RedundancyFingerprint**: Signature clustering, hot prefix learning
- **CompressionCurve**: Chunk size efficiency, mode effectiveness tracking
- **HardwareCapability**: Learned hardware limits, pressure event tracking
- **ModelState**: Central container with serialization

### Online Trainer (`trainer.py`)
- **IncrementalGradient**: Online gradient descent with AdaGrad-style adaptive learning
- **AdaptiveModelTuner**: Tunes entropy predictor, mode selector, refinement predictor
- **OnlineTrainer**: Main training coordinator with warmup phase (100 samples)

### State Persistence (`persistence.py`)
- **StateSerializer**: JSON-compatible serialization for numpy arrays
- **CheckpointManager**: Atomic writes, versioning, gzip compression
- **StatePersistence**: High-level interface with export/import

### Extreme Ratio Controller (`extreme_ratio.py`)
- **CompressionGoal**: Target ratio configuration
- **ExtremeSettings**: Settings for extreme compression mode
- **RedundancyAnalyzer**: Dataset redundancy analysis
- **ExtremeRatioController**: `target()` and `recommend()` methods

### Stability Engine (`stability_engine.py`)
- **ParameterSmoother**: Exponential moving averages for stable updates
- **OverfitDetector**: Train/val gap detection, pattern concentration
- **OscillationDamper**: Prevents parameter swings during training
- **StabilityEngine**: Unified stability management

## What HAMMA EXTREME Learns (Metadata Only)

✅ **LEARNS FROM:**
- Chunk entropy values
- Redundancy signatures (hashes)
- Histogram distributions
- Compression mode effectiveness
- Hardware performance characteristics

❌ **NEVER STORES:**
- Raw file bytes
- File contents
- User data
- Actual byte sequences

## Testing

```bash
# Run all tests (66 total)
cd singularity-pack/hamma
python -m pytest tests/ -v

# Run only EXTREME tests (41)
python -m pytest tests/test_extreme.py -v

# Run only core tests (25)
python -m pytest tests/test_hamma.py -v
```

## Performance Targets

| Metric | Target | Achieved |
|--------|--------|----------|
| Single prediction latency | <5ms | ✓ |
| Throughput | 100+ rps | ✓ |
| Memory footprint | ~50MB | ✓ |
| Batch (5000 chunks) | <30s | ✓ |
| Learning warmup | 100 samples | ✓ |
| State save/load | <100ms | ✓ |

---

## 📋 Future Updates Checklist

### Completed ✅
- [x] Core HAMMA API with 4 models
- [x] FastAPI server with WebSocket support
- [x] HAMMA EXTREME self-learning layer
- [x] State persistence with versioning
- [x] Stability engine (smoother, overfit detector, damper)
- [x] 66 comprehensive tests

### Potential Next Steps 🔮
- [ ] Add GPU acceleration for batch predictions
- [ ] Implement distributed learning across multiple instances
- [ ] Add real-time dashboard for monitoring learning progress
- [ ] Create CLI tool for state management
- [ ] Add A/B testing for model comparison
- [ ] Implement model versioning and rollback
- [ ] Add WebSocket endpoint for EXTREME learning feedback
- [ ] Create Docker container for deployment

---

## License

Free for personal use. See LICENSE file.
