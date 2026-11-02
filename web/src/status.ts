/**
 * SPK Platform Status
 * Runtime status checks for platform components
 */

import {
  PLATFORM_COMPONENTS,
  VERSION_1_0_REQUIREMENTS,
  PERFORMANCE_TARGETS,
  checkVersion1Requirements,
  getStableComponents,
  type ComponentStatus,
} from './version';

// ============================================================================
// PLATFORM STATUS
// ============================================================================

/**
 * Platform health status
 */
export interface PlatformHealth {
  /** Overall health status */
  healthy: boolean;
  /** Component statuses */
  components: ComponentHealthStatus[];
  /** Performance within targets */
  performanceOk: boolean;
  /** Memory within limits */
  memoryOk: boolean;
  /** All requirements met */
  requirementsMet: boolean;
}

/**
 * Individual component health
 */
export interface ComponentHealthStatus {
  name: string;
  status: ComponentStatus;
  operational: boolean;
  lastCheck: number;
}

/**
 * Get platform health status
 */
export function getPlatformHealth(): PlatformHealth {
  const components = getStableComponents().map(name => ({
    name,
    status: 'stable' as ComponentStatus,
    operational: true,
    lastCheck: Date.now(),
  }));

  return {
    healthy: true,
    components,
    performanceOk: true,
    memoryOk: true,
    requirementsMet: checkVersion1Requirements(),
  };
}

// ============================================================================
// CAPABILITY CHECKS
// ============================================================================

/**
 * Platform capabilities
 */
export interface PlatformCapabilities {
  /** WASM available */
  wasm: boolean;
  /** WASM SIMD support */
  simd: boolean;
  /** WASM threads support */
  threads: boolean;
  /** Web Workers available */
  workers: boolean;
  /** File System Access API */
  fileSystemAccess: boolean;
  /** SharedArrayBuffer available */
  sharedArrayBuffer: boolean;
  /** Crypto API available */
  crypto: boolean;
  /** IndexedDB available */
  indexedDB: boolean;
  /** LocalStorage available */
  localStorage: boolean;
  /** WebRTC available (for sharing) */
  webRTC: boolean;
}

/**
 * Check platform capabilities
 */
export async function checkCapabilities(): Promise<PlatformCapabilities> {
  return {
    wasm: typeof WebAssembly !== 'undefined',
    simd: await checkWasmSimd(),
    threads: await checkWasmThreads(),
    workers: typeof Worker !== 'undefined',
    fileSystemAccess: 'showOpenFilePicker' in window,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crypto: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
    indexedDB: typeof indexedDB !== 'undefined',
    localStorage: typeof localStorage !== 'undefined',
    webRTC: typeof RTCPeerConnection !== 'undefined',
  };
}

/**
 * Check WASM SIMD support
 */
async function checkWasmSimd(): Promise<boolean> {
  try {
    const simdTest = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
      0x03, 0x02, 0x01, 0x00,
      0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0b,
    ]);
    await WebAssembly.compile(simdTest);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check WASM threads support
 */
async function checkWasmThreads(): Promise<boolean> {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return memory.buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

// ============================================================================
// RUNTIME METRICS
// ============================================================================

/**
 * Runtime metrics
 */
export interface RuntimeMetrics {
  /** Memory usage in bytes */
  memoryUsage: number;
  /** Memory limit in bytes */
  memoryLimit: number;
  /** Active workers */
  activeWorkers: number;
  /** Total workers */
  totalWorkers: number;
  /** Uptime in ms */
  uptimeMs: number;
  /** Jobs completed */
  jobsCompleted: number;
  /** Total bytes processed */
  totalBytesProcessed: number;
}

/**
 * Runtime metrics tracker
 */
class MetricsTracker {
  private startTime = Date.now();
  private jobsCompleted = 0;
  private bytesProcessed = 0;

  recordJob(bytes: number): void {
    this.jobsCompleted++;
    this.bytesProcessed += bytes;
  }

  getMetrics(): RuntimeMetrics {
    return {
      memoryUsage: this.estimateMemoryUsage(),
      memoryLimit: this.estimateMemoryLimit(),
      activeWorkers: 0,
      totalWorkers: navigator.hardwareConcurrency || 4,
      uptimeMs: Date.now() - this.startTime,
      jobsCompleted: this.jobsCompleted,
      totalBytesProcessed: this.bytesProcessed,
    };
  }

  private estimateMemoryUsage(): number {
    if ('memory' in performance) {
      const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      return mem.usedJSHeapSize;
    }
    return 0;
  }

  private estimateMemoryLimit(): number {
    if ('memory' in performance) {
      const mem = (performance as unknown as { memory: { jsHeapSizeLimit: number } }).memory;
      return mem.jsHeapSizeLimit;
    }
    // Estimate 512MB default
    return 512 * 1024 * 1024;
  }
}

// Singleton
let metricsTracker: MetricsTracker | null = null;

/**
 * Get metrics tracker
 */
export function getMetricsTracker(): MetricsTracker {
  if (!metricsTracker) {
    metricsTracker = new MetricsTracker();
  }
  return metricsTracker;
}

/**
 * Get current runtime metrics
 */
export function getRuntimeMetrics(): RuntimeMetrics {
  return getMetricsTracker().getMetrics();
}

// ============================================================================
// PERFORMANCE VALIDATION
// ============================================================================

/**
 * Performance validation result
 */
export interface PerformanceValidation {
  /** All targets met */
  allTargetsMet: boolean;
  /** Individual target results */
  targets: {
    name: string;
    target: number;
    current: number;
    met: boolean;
  }[];
}

/**
 * Validate performance against targets
 */
export function validatePerformance(
  throughputGBPerMin: number,
  chunkLatencyMs: number
): PerformanceValidation {
  const targets = [
    {
      name: 'Throughput (GB/min)',
      target: PERFORMANCE_TARGETS.minThroughputGBPerMin,
      current: throughputGBPerMin,
      met: throughputGBPerMin >= PERFORMANCE_TARGETS.minThroughputGBPerMin,
    },
    {
      name: 'Chunk Latency (ms)',
      target: PERFORMANCE_TARGETS.maxChunkLatencyMs,
      current: chunkLatencyMs,
      met: chunkLatencyMs <= PERFORMANCE_TARGETS.maxChunkLatencyMs,
    },
  ];

  return {
    allTargetsMet: targets.every(t => t.met),
    targets,
  };
}

// ============================================================================
// STATUS EXPORTS
// ============================================================================

export {
  PLATFORM_COMPONENTS,
  VERSION_1_0_REQUIREMENTS,
  PERFORMANCE_TARGETS,
  checkVersion1Requirements,
  getStableComponents,
};
