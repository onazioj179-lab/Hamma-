# SPK Hyper-Low-Memory Mode Implementation

**Creator:** OJ Treasure Onazi  
**Version:** 1.0.0  
**Date:** 2024  

## Overview

The SPK Hyper-Low-Memory Mode provides ultra-optimized compression capabilities for devices with 1GB RAM or less. This implementation enables massive file operations (MB → TB) through intelligent partitioning, micro-chunking, and aggressive memory management.

## Target Specifications

| Parameter | Value | Description |
|-----------|-------|-------------|
| TARGET_RAM | 1GB | Default memory target |
| SAFE_MARGIN | 150MB | Reserved for system/UI |
| SPK_MAX_RAM | 850MB | Available for SPK operations |
| PRESSURE_THRESHOLD | 80% | Triggers fallback mechanisms |
| CRITICAL_THRESHOLD | 90% | Reduces workers, forces smaller chunks |
| EMERGENCY_THRESHOLD | 95% | Emergency GC, single worker mode |

## Module Structure

```
web/src/engine/lowmem/
├── types.ts              # Core type definitions
├── memory-budget.ts      # Section 1: Memory Budget Controller
├── micro-chunk.ts        # Section 2: Micro-Chunk Pipeline
├── buffer-pool.ts        # Section 3: Zero-Copy Buffer Pool
├── streaming-reader.ts   # Section 4: Streaming File Reader
├── worker-profile.ts     # Section 5: Worker Profile Manager
├── low-mem-writer.ts     # Section 6: Low-Memory Archive Writer
├── low-mem-optimizer.ts  # Section 7: Low-RAM AI Optimizer
├── safety-enforcer.ts    # Section 8: Safety Limits Enforcer
└── index.ts              # Barrel exports
```

## Implementation Details

### Section 1: Memory Budget Controller (`memory-budget.ts`)

- **Purpose:** Monitor and manage RAM usage across the application
- **Key Features:**
  - Real-time memory tracking via `estimateRAM()`
  - Allocation/release tracking with unique IDs
  - Automatic pressure level detection (low → emergency)
  - Event-driven pressure change notifications
  - Emergency GC for critical situations

```typescript
const controller = getMemoryBudgetController(1 * GB);
const result = controller.allocate({
  id: 'chunk_1',
  bytes: 256 * KB,
  purpose: 'chunk',
  priority: 'normal'
});
if (result.success) {
  // Process chunk
  controller.release('chunk_1');
}
```

### Section 2: Ultra Micro-Chunk Pipeline (`micro-chunk.ts`)

- **Purpose:** Dynamic chunk sizing based on memory pressure
- **Chunk Modes:**
  - `nano`: 64KB - Extreme low memory
  - `micro`: 128KB - High memory pressure
  - `small`: 256KB - Default for low-RAM
  - `normal`: 1MB - Standard operation
  - `large`: 4MB - High memory available

```typescript
const pipeline = getMicroChunkPipeline(4);
for (const chunk of pipeline.createChunks(data, fileId)) {
  await processChunk(chunk);
}
```

### Section 3: Zero-Copy Buffer Pipeline (`buffer-pool.ts`)

- **Purpose:** Minimize memory allocations through pooling
- **Key Features:**
  - TypedArray views (zero-copy slicing)
  - Transferable ownership for worker messaging
  - WASM linear memory pointer wrapping
  - Automatic buffer eviction based on age
  - Hit/miss rate tracking

```typescript
const pool = getBufferPool();
const { buffer, release } = pool.acquire(256 * KB);
// Use buffer
release(); // Return to pool
```

### Section 4: Streaming File Reader (`streaming-reader.ts`)

- **Purpose:** Read → Send → Free → Repeat cycle
- **Key Features:**
  - Never holds entire file in memory
  - Adaptive chunk sizing under pressure
  - Supports File, Blob, and ReadableStream
  - Abort signal support
  - Progress callbacks

```typescript
const reader = getStreamingReader();
for await (const chunk of reader.streamFile(file)) {
  await compress(chunk.data);
  // Memory automatically freed after yield
}
```

### Section 5: Low-RAM Worker Profile (`worker-profile.ts`)

- **Purpose:** Manage worker pool with memory constraints
- **Profiles:**
  - `ultra_low`: 1 worker, 100MB limit, 1MB WASM
  - `low`: 2 workers, 150MB limit, 2MB WASM
  - `normal`: 4 workers, 200MB limit, 4MB WASM
  - `high`: 8 workers, 400MB limit, 8MB WASM

```typescript
const manager = getWorkerProfileManager('ultra_low');
await manager.initialize('/worker.js');
const result = await manager.submitTask('compress', data, 'normal');
```

### Section 6: Low-Memory Archive Writer (`low-mem-writer.ts`)

- **Purpose:** Write SPK archives with minimal RAM usage
- **Constraints:**
  - <50MB metadata RAM at any time
  - Frequent flush to storage (every 4MB or 5s)
  - Binary format for minimal overhead
  - Streaming write support
  - File System Access API when available

```typescript
const writer = getLowMemoryWriter();
await writer.initialize('archive.spk');
for (const chunk of chunks) {
  await writer.writeChunk(chunk.compressed, chunk.original);
}
const { blob } = await writer.finalize();
```

### Section 7: Low-RAM AI Optimizer (`low-mem-optimizer.ts`)

- **Purpose:** Simple heuristics for compression decisions
- **No ML Models:** Uses lookup tables for speed
- **Features:**
  - File extension → algorithm mapping
  - Size → chunk mode recommendations
  - Memory pressure → concurrency adjustment
  - Decision caching for performance

```typescript
const optimizer = getLowRAMAIOptimizer();
const result = optimizer.optimize({
  fileCount: 100,
  totalSize: 1 * GB,
  avgFileSize: 10 * MB,
  memoryAvailable: 500 * MB,
  memoryPressure: 'medium',
  currentChunkMode: 'small',
  currentWorkerCount: 2
});
```

### Section 8: Safety Limits Enforcer (`safety-enforcer.ts`)

- **Purpose:** Hard caps to prevent memory exhaustion
- **Default Limits:**
  - Max concurrent chunks: 4
  - Max workers: 2
  - Max WASM buffer: 32MB
  - Max metadata overhead: 30MB
- **Device Profiles:**
  - `ultra_low`: 512MB devices
  - `low`: 1GB devices
  - `medium`: 2GB devices
  - `standard`: 4GB+ devices
  - `test_extreme`: 256MB testing

```typescript
const enforcer = getSafetyEnforcer();
enforcer.autoDetectProfile();
if (enforcer.acquire('chunk')) {
  // Process chunk
  enforcer.release('chunk');
}
```

## Quick Start

```typescript
import {
  initializeLowMemoryMode,
  getLowMemoryStatus,
  resetLowMemoryMode
} from '@/engine/lowmem';

// Initialize with auto-detection
initializeLowMemoryMode({
  autoDetectProfile: true
});

// Check status
const status = getLowMemoryStatus();
console.log(`Memory: ${status.memory.usagePercent * 100}%`);
console.log(`Chunks: ${status.chunks.mode}`);
console.log(`Safety: ${status.safety.safeMode ? 'Safe Mode' : 'Normal'}`);

// Cleanup
resetLowMemoryMode();
```

## Event Handling

All modules emit events for monitoring:

```typescript
const controller = getMemoryBudgetController();
controller.on((event) => {
  switch (event.type) {
    case 'pressure-change':
      console.log(`Pressure: ${event.from} → ${event.to}`);
      break;
    case 'emergency-gc':
      console.log(`Emergency GC saved ${event.savedBytes} bytes`);
      break;
  }
});
```

## Testing Profile

For stress testing on low-end devices:

```typescript
import { createTestEnvironment, runSafetyStressTest } from '@/engine/lowmem';

const { enforcer, cleanup } = createTestEnvironment('test_extreme');
const results = await runSafetyStressTest(enforcer, 100);
console.log(`Passed: ${results.passed}, Blocked: ${results.blocked}`);
cleanup();
```

## Integration with Massive Module

The lowmem module complements the massive module:

- **Massive Module:** Handles 10TB+ archives with 5000+ files
- **LowMem Module:** Enables operation on 1GB RAM devices

Together they support massive archives on constrained devices through:
1. Massive partitioning for large file sets
2. Low-mem chunking for RAM management
3. Safety enforcement at both levels

## Performance Characteristics

| Scenario | Chunk Mode | Workers | Throughput |
|----------|------------|---------|------------|
| 512MB device | nano | 1 | ~10 MB/s |
| 1GB device | micro | 2 | ~20 MB/s |
| 2GB device | small | 4 | ~50 MB/s |
| 4GB+ device | normal | 8 | ~100 MB/s |

## Files Created

1. `types.ts` - ~500 lines
2. `memory-budget.ts` - ~450 lines
3. `micro-chunk.ts` - ~450 lines
4. `buffer-pool.ts` - ~400 lines
5. `streaming-reader.ts` - ~350 lines
6. `worker-profile.ts` - ~500 lines
7. `low-mem-writer.ts` - ~500 lines
8. `low-mem-optimizer.ts` - ~450 lines
9. `safety-enforcer.ts` - ~550 lines
10. `index.ts` - ~200 lines

**Total:** ~4,350 lines of TypeScript
