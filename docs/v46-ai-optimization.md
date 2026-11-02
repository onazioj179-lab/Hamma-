# SPK V46 - AI-Driven Optimization Layer

## Overview

Version 46 adds an AI-driven optimization layer that monitors the compression pipeline, predicts ideal settings, improves throughput, and ensures fully automated backend tuning.

**Key Principle**: All compression/decompression remains fully **lossless and deterministic**. AI is used ONLY for optimization, not transformation.

## Safety Rules

1. **AI NEVER inspects or analyzes user file contents**
2. **AI only uses metadata** (sizes, speeds, timings)
3. **Compression remains 100% lossless and bit-perfect**
4. **All optimization is optional and can be disabled**
5. **If AI fails, pipeline falls back to deterministic defaults**

## Privacy

- Training data is **private and local only**
- **Never uploaded** to any server
- **Deletable by user** via "Reset optimization data"

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  "Optimizing for your device..." / "Adaptive mode active"       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AI OPTIMIZER                                │
│  ┌───────────────┐  ┌─────────────────┐  ┌───────────────────┐  │
│  │   Telemetry   │──│   Prediction    │──│  Training Store   │  │
│  │   Collector   │  │    Engine       │  │   (Local Only)    │  │
│  └───────────────┘  └─────────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Recommendations only - never blocks)
┌─────────────────────────────────────────────────────────────────┐
│                      COORDINATOR                                 │
│  Applies settings gradually to avoid instability                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   WORKERS + WASM ENGINE                          │
│  Lossless, bit-perfect compression/decompression                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## AI Input Signals (Telemetry)

The AI receives real-time telemetry containing **ONLY metadata** - never user content:

| Signal | Description |
|--------|-------------|
| `fileType` | MIME type of file |
| `fileSize` | Size in bytes |
| `avgChunkTimeMs` | Average chunk processing time |
| `workerLoadPercent` | Worker load (0-100%) |
| `wasmStallCount` | Number of WASM stall events |
| `memoryUsage` | Current memory usage |
| `throughputBps` | Current throughput |
| `fileCount` | Number of files |
| `chunkCount` | Total chunks |
| `hardware` | Device profile |
| `history` | Past job performance |

---

## AI Outputs

The AI outputs tuning instructions:

| Output | Description |
|--------|-------------|
| `chunkSize` | Recommended chunk size (1MB - 64MB) |
| `concurrentLanes` | Number of concurrent lanes |
| `workerCount` | Number of workers |
| `wasmBatchSize` | WASM batch size |
| `ioBufferStrategy` | I/O strategy (minimal/balanced/aggressive/streaming) |
| `compressionMode` | Mode selection (auto/fast/strong) |
| `predictedTimeMs` | Estimated job time |
| `confidence` | Prediction confidence (0-1) |

---

## Training Data (Local Only)

AI learns on-device from:
- User's hardware profile
- Previous compression jobs
- Timing telemetry
- Success/failure patterns

Training data is:
- ✅ **Private** - stored only in browser localStorage
- ✅ **Local** - never leaves the device
- ✅ **Never uploaded** - no network transmission
- ✅ **Deletable** - "Reset optimization data" setting

---

## Usage

### React Hook

```typescript
import { useAIOptimization } from '@/ai';

function CompressionComponent() {
  const {
    status,           // Current AI status
    trainingStats,    // Learning statistics
    toggleAI,         // Enable/disable AI
    resetData,        // Clear training data
    getOptimizedConfig,
    startJob,
    reportProgress,
    completeJob,
  } = useAIOptimization();

  // Start compression with AI optimization
  const handleCompress = async (files: File[]) => {
    const config = getOptimizedConfig(files);
    startJob();
    
    // ... compression with progress reporting
    reportProgress({ chunkTimeMs: 50, workerLoadPercent: 75 });
    
    // Complete job
    completeJob({
      success: true,
      totalBytes: 1000000,
      durationMs: 5000,
      compressionRatio: 2.5,
      peakMemory: 100000000,
      errorCount: 0,
      stallCount: 0,
    });
  };

  return (
    <div>
      {status.active && <span>{status.statusMessage}</span>}
      <button onClick={toggleAI}>
        {status.enabled ? 'Disable AI' : 'Enable AI'}
      </button>
    </div>
  );
}
```

### Direct API

```typescript
import { getAIOptimizer } from '@/ai';

const optimizer = getAIOptimizer();
await optimizer.initialize();

// Get recommendations
const config = optimizer.getRecommendations('application/pdf', 10000000, 1);

// Start monitoring
optimizer.startJobMonitoring();

// Update telemetry during job
optimizer.updateTelemetry({
  chunkTimeMs: 50,
  workerLoadPercent: 75,
  throughputBps: 100000000,
});

// Complete job
optimizer.completeJob({
  success: true,
  totalBytes: 10000000,
  durationMs: 1000,
  compressionRatio: 2.0,
  peakMemory: 50000000,
  errorCount: 0,
  stallCount: 0,
});
```

---

## Real-Time Adjustments

AI can recommend adjustments during job execution:

```typescript
// Automatic adjustment scenarios:
if (memoryPressure > 0.85) {
  // Reduce chunk size
}

if (wasmIdle && lowWorkerLoad) {
  // Increase concurrency
}

if (workerOverload) {
  // Reduce worker count
}
```

Adjustments are applied **gradually** to avoid instability.

---

## Large Job Handling (1-10 TB)

AI optimizes for:
- Batch jobs (up to 5,000 files)
- Selective extraction
- Preview speed
- Memory budget enforcement
- Recovery strategy selection

---

## Files

| File | Purpose |
|------|---------|
| `ai/types.ts` | Type definitions |
| `ai/telemetry.ts` | Telemetry collection |
| `ai/prediction.ts` | Prediction engine |
| `ai/training.ts` | Local training store |
| `ai/optimizer.ts` | Main AI controller |
| `ai/integration.ts` | Coordinator integration |
| `ai/hooks.ts` | React hooks |
| `ai/index.ts` | Module exports |

---

## Version

```
V46_VERSION = '46.0.0'
V46_CODENAME = 'Intelligent Optimization'
```
