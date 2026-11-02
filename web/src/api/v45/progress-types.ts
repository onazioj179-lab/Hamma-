/**
 * SPK V45 - Progress & Telemetry Types
 * Streamed progress and performance monitoring
 */

// ============================================================================
// PART 2 — PROGRESS + TELEMETRY TYPES
// ============================================================================

/**
 * Progress event emitted during compression/decompression
 */
export type ProgressEvent = {
  /** Event type identifier */
  type: 'progress';
  /** Current chunk being processed */
  chunkIndex: number;
  /** Total number of chunks */
  totalChunks: number;
  /** Current processing speed in MB/s */
  speedMBps: number;
  /** Estimated time remaining in seconds */
  etaSeconds: number;
};

/**
 * Extended progress event with additional metrics
 */
export type DetailedProgressEvent = ProgressEvent & {
  /** Bytes processed so far */
  bytesProcessed: number;
  /** Total bytes to process */
  totalBytes: number;
  /** Percentage complete (0-100) */
  percentComplete: number;
  /** Current file being processed */
  currentFile?: string;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** Current phase of operation */
  phase: ProgressPhase;
};

/**
 * Processing phase
 */
export type ProgressPhase =
  | 'initializing'
  | 'reading'
  | 'compressing'
  | 'writing'
  | 'finalizing'
  | 'encrypting'
  | 'extracting'
  | 'verifying'
  | 'complete'
  | 'error';

/**
 * Throughput telemetry for performance monitoring
 */
export type ThroughputTelemetry = {
  /** Speed per lane (worker) in MB/s */
  laneSpeed: number[];
  /** Average speed across all lanes in MB/s */
  averageSpeed: number;
  /** Total bytes processed */
  totalProcessedBytes: number;
};

/**
 * Extended throughput telemetry
 */
export type DetailedThroughputTelemetry = ThroughputTelemetry & {
  /** Peak speed achieved in MB/s */
  peakSpeed: number;
  /** Lowest speed recorded in MB/s */
  minSpeed: number;
  /** Speed variance for stability analysis */
  speedVariance: number;
  /** Compression ratio achieved */
  compressionRatio: number;
  /** Timestamp of measurement */
  timestamp: number;
};

/**
 * Worker load information
 */
export type WorkerLoad = {
  /** Worker identifier */
  workerId: string;
  /** Whether worker is currently processing */
  busy: boolean;
  /** Number of pending tasks */
  queueDepth: number;
};

/**
 * Extended worker status
 */
export type WorkerStatus = WorkerLoad & {
  /** Worker state */
  state: WorkerState;
  /** Last activity timestamp */
  lastActivity: number;
  /** Total chunks processed */
  chunksProcessed: number;
  /** Total bytes processed */
  bytesProcessed: number;
  /** Current task ID (if busy) */
  currentTaskId?: string;
  /** Error count */
  errorCount: number;
};

/**
 * Worker operational state
 */
export type WorkerState =
  | 'idle'
  | 'initializing'
  | 'processing'
  | 'flushing'
  | 'finalizing'
  | 'error'
  | 'terminated';

/**
 * System-wide telemetry
 */
export type SystemTelemetry = {
  /** Active worker count */
  activeWorkers: number;
  /** Total workers */
  totalWorkers: number;
  /** Memory usage in bytes */
  memoryUsage: number;
  /** Memory limit in bytes */
  memoryLimit: number;
  /** Buffer pool utilization (0-1) */
  bufferPoolUtilization: number;
  /** Backpressure indicator (0-1) */
  backpressure: number;
  /** Throughput telemetry */
  throughput: ThroughputTelemetry;
  /** Individual worker loads */
  workers: WorkerLoad[];
};

/**
 * Coordinator state
 */
export type CoordinatorState = {
  /** Current operation status */
  status: 'idle' | 'initializing' | 'running' | 'paused' | 'error' | 'complete';
  /** Active operation ID */
  operationId: string | null;
  /** Worker states */
  workers: WorkerLoad[];
  /** Current throughput */
  throughput: ThroughputTelemetry;
  /** Memory usage */
  memoryUsage: number;
  /** Memory limit */
  memoryLimit: number;
  /** Pending chunk count */
  pendingChunks: number;
  /** Completed chunk count */
  completedChunks: number;
  /** Total chunk count */
  totalChunks: number;
};

/**
 * Telemetry update event
 */
export type TelemetryUpdate = {
  /** Update type */
  type: 'telemetry';
  /** Timestamp */
  timestamp: number;
  /** Throughput data */
  throughput: ThroughputTelemetry;
  /** Worker loads */
  workers: WorkerLoad[];
  /** Memory usage */
  memoryUsage: number;
  /** Current speed in MB/s */
  currentSpeed: number;
  /** Average speed in MB/s */
  averageSpeed: number;
};

// ============================================================================
// Progress Event Utilities
// ============================================================================

/**
 * Create a progress event
 */
export function createProgressEvent(
  chunkIndex: number,
  totalChunks: number,
  bytesProcessed: number,
  elapsedMs: number
): ProgressEvent {
  const speedBps = elapsedMs > 0 ? (bytesProcessed / elapsedMs) * 1000 : 0;
  const speedMBps = speedBps / (1024 * 1024);
  const remainingChunks = totalChunks - chunkIndex;
  const avgTimePerChunk = chunkIndex > 0 ? elapsedMs / chunkIndex : 0;
  const etaSeconds = (remainingChunks * avgTimePerChunk) / 1000;

  return {
    type: 'progress',
    chunkIndex,
    totalChunks,
    speedMBps,
    etaSeconds,
  };
}

/**
 * Create detailed progress event
 */
export function createDetailedProgressEvent(
  chunkIndex: number,
  totalChunks: number,
  bytesProcessed: number,
  totalBytes: number,
  elapsedMs: number,
  currentFile?: string,
  phase: ProgressPhase = 'compressing'
): DetailedProgressEvent {
  const base = createProgressEvent(chunkIndex, totalChunks, bytesProcessed, elapsedMs);
  
  return {
    ...base,
    bytesProcessed,
    totalBytes,
    percentComplete: totalBytes > 0 ? (bytesProcessed / totalBytes) * 100 : 0,
    currentFile,
    elapsedMs,
    phase,
  };
}

/**
 * Calculate throughput telemetry from worker statuses
 */
export function calculateThroughput(workers: WorkerStatus[]): ThroughputTelemetry {
  const laneSpeed = workers.map(w => {
    if (w.lastActivity === 0) return 0;
    const elapsed = Date.now() - w.lastActivity;
    return elapsed > 0 ? (w.bytesProcessed / elapsed) * 1000 / (1024 * 1024) : 0;
  });

  const totalSpeed = laneSpeed.reduce((a, b) => a + b, 0);
  const averageSpeed = workers.length > 0 ? totalSpeed / workers.length : 0;
  const totalProcessedBytes = workers.reduce((a, w) => a + w.bytesProcessed, 0);

  return {
    laneSpeed,
    averageSpeed,
    totalProcessedBytes,
  };
}

/**
 * Format progress for display
 */
export function formatProgress(event: ProgressEvent): string {
  const percent = (event.chunkIndex / event.totalChunks) * 100;
  const speed = event.speedMBps.toFixed(1);
  const eta = formatEta(event.etaSeconds);
  return `${percent.toFixed(1)}% (${speed} MB/s, ${eta} remaining)`;
}

/**
 * Format ETA for display
 */
export function formatEta(seconds: number): string {
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format speed for display
 */
export function formatSpeed(mbps: number): string {
  if (mbps < 1) return `${(mbps * 1024).toFixed(0)} KB/s`;
  if (mbps < 1024) return `${mbps.toFixed(1)} MB/s`;
  return `${(mbps / 1024).toFixed(2)} GB/s`;
}
