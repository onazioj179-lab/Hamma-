/**
 * SPK V29 - Real-Time Telemetry System
 * 
 * High-frequency performance monitoring:
 * - 10-30Hz UI updates
 * - Rolling speed averages
 * - Memory usage tracking
 * - ETA calculation
 * - Worker load monitoring
 * 
 * Zero-allocation hot path
 */

import {
  type JobId,
  type ChunkSeq,
  type JobProgress,
  type JobTelemetry,
  type ChunkTiming,
  type SpeedSample,
  TELEMETRY_INTERVAL_MS,
} from './types';

// ============================================================================
// SPEED CALCULATOR
// ============================================================================

/**
 * High-precision speed calculator with rolling window
 */
export class SpeedCalculator {
  private samples: SpeedSample[] = [];
  private readonly windowSize: number;
  private readonly windowTimeMs: number;
  
  // Cached calculations (avoid allocation)
  private _instantSpeed = 0;
  private _rollingSpeed = 0;
  private _lastUpdate = 0;
  
  constructor(windowSize: number = 50, windowTimeMs: number = 5000) {
    this.windowSize = windowSize;
    this.windowTimeMs = windowTimeMs;
  }
  
  /**
   * Add sample (zero-allocation if not pruning)
   */
  addSample(bytes: number): void {
    const now = performance.now();
    
    // Add sample
    this.samples.push({
      timestamp: now,
      bytes,
    });
    
    // Prune old samples
    this.prune(now);
    
    // Update cached values
    this.updateCache(now);
  }
  
  /**
   * Prune old samples
   */
  private prune(now: number): void {
    // By count
    while (this.samples.length > this.windowSize) {
      this.samples.shift();
    }
    
    // By age
    const cutoff = now - this.windowTimeMs;
    while (this.samples.length > 0 && this.samples[0].timestamp < cutoff) {
      this.samples.shift();
    }
  }
  
  /**
   * Update cached speed values
   */
  private updateCache(now: number): void {
    if (this.samples.length < 2) {
      this._instantSpeed = 0;
      this._rollingSpeed = 0;
      return;
    }
    
    // Instant speed (last 2 samples)
    const last = this.samples[this.samples.length - 1];
    const prev = this.samples[this.samples.length - 2];
    const instantDt = (last.timestamp - prev.timestamp) / 1000;
    this._instantSpeed = instantDt > 0 ? last.bytes / instantDt : 0;
    
    // Rolling average (weighted)
    let weightedBytes = 0;
    let weightedTime = 0;
    
    for (const sample of this.samples) {
      const age = now - sample.timestamp;
      const weight = Math.max(0, 1 - age / this.windowTimeMs);
      weightedBytes += sample.bytes * weight;
      weightedTime += weight;
    }
    
    if (weightedTime > 0) {
      // Estimate actual time span
      const first = this.samples[0];
      const dt = (now - first.timestamp) / 1000;
      this._rollingSpeed = dt > 0 ? (weightedBytes / weightedTime) * (1 / dt) * this.samples.length : 0;
    }
    
    this._lastUpdate = now;
  }
  
  /**
   * Get instant speed (bytes/sec)
   */
  getInstantSpeed(): number {
    return this._instantSpeed;
  }
  
  /**
   * Get rolling average speed (bytes/sec)
   */
  getRollingSpeed(): number {
    return this._rollingSpeed;
  }
  
  /**
   * Get ETA in seconds
   */
  getETA(remainingBytes: number): number {
    const speed = this._rollingSpeed || this._instantSpeed;
    return speed > 0 ? remainingBytes / speed : Infinity;
  }
  
  /**
   * Reset calculator
   */
  reset(): void {
    this.samples = [];
    this._instantSpeed = 0;
    this._rollingSpeed = 0;
    this._lastUpdate = 0;
  }
  
  /**
   * Get sample count
   */
  getSampleCount(): number {
    return this.samples.length;
  }
}

// ============================================================================
// MEMORY MONITOR
// ============================================================================

/**
 * Memory usage tracker
 */
export class MemoryMonitor {
  private currentUsage = 0;
  private peakUsage = 0;
  private samples: { timestamp: number; usage: number }[] = [];
  private readonly maxSamples = 100;
  
  /**
   * Record memory allocation
   */
  allocate(bytes: number): void {
    this.currentUsage += bytes;
    this.peakUsage = Math.max(this.peakUsage, this.currentUsage);
    this.recordSample();
  }
  
  /**
   * Record memory deallocation
   */
  deallocate(bytes: number): void {
    this.currentUsage = Math.max(0, this.currentUsage - bytes);
    this.recordSample();
  }
  
  /**
   * Set absolute usage
   */
  setUsage(bytes: number): void {
    this.currentUsage = bytes;
    this.peakUsage = Math.max(this.peakUsage, bytes);
    this.recordSample();
  }
  
  private recordSample(): void {
    this.samples.push({
      timestamp: Date.now(),
      usage: this.currentUsage,
    });
    
    while (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }
  
  /**
   * Get current usage
   */
  getCurrentUsage(): number {
    return this.currentUsage;
  }
  
  /**
   * Get peak usage
   */
  getPeakUsage(): number {
    return this.peakUsage;
  }
  
  /**
   * Get usage trend (bytes/sec)
   */
  getUsageTrend(): number {
    if (this.samples.length < 2) return 0;
    
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.timestamp - first.timestamp) / 1000;
    
    return dt > 0 ? (last.usage - first.usage) / dt : 0;
  }
  
  /**
   * Reset monitor
   */
  reset(): void {
    this.currentUsage = 0;
    this.peakUsage = 0;
    this.samples = [];
  }
}

// ============================================================================
// CHUNK TIMING TRACKER
// ============================================================================

/**
 * Track individual chunk timings
 */
export class ChunkTimingTracker {
  private timings: Map<ChunkSeq, ChunkTiming> = new Map();
  private readonly maxTimings: number;
  
  constructor(maxTimings: number = 100) {
    this.maxTimings = maxTimings;
  }
  
  /**
   * Record chunk timing
   */
  record(timing: ChunkTiming): void {
    this.timings.set(timing.seq, timing);
    
    // Prune old entries
    if (this.timings.size > this.maxTimings) {
      const oldest = Math.min(...this.timings.keys());
      this.timings.delete(oldest);
    }
  }
  
  /**
   * Get recent timings
   */
  getRecent(count: number = 10): ChunkTiming[] {
    const entries = Array.from(this.timings.entries());
    entries.sort((a, b) => b[0] - a[0]); // Sort by seq desc
    return entries.slice(0, count).map(e => e[1]);
  }
  
  /**
   * Get average timing
   */
  getAverage(): { readMs: number; compressMs: number; totalMs: number } {
    if (this.timings.size === 0) {
      return { readMs: 0, compressMs: 0, totalMs: 0 };
    }
    
    let readMs = 0;
    let compressMs = 0;
    let totalMs = 0;
    
    for (const timing of this.timings.values()) {
      readMs += timing.readMs;
      compressMs += timing.compressMs;
      totalMs += timing.totalMs;
    }
    
    const count = this.timings.size;
    return {
      readMs: readMs / count,
      compressMs: compressMs / count,
      totalMs: totalMs / count,
    };
  }
  
  /**
   * Get throughput (bytes/sec)
   */
  getThroughput(): number {
    if (this.timings.size === 0) return 0;
    
    let totalBytes = 0;
    let totalMs = 0;
    
    for (const timing of this.timings.values()) {
      totalBytes += timing.size;
      totalMs += timing.totalMs;
    }
    
    return totalMs > 0 ? (totalBytes / totalMs) * 1000 : 0;
  }
  
  /**
   * Reset tracker
   */
  reset(): void {
    this.timings.clear();
  }
}

// ============================================================================
// TELEMETRY AGGREGATOR
// ============================================================================

/**
 * Aggregate all telemetry for a job
 */
export class TelemetryAggregator {
  private jobId: JobId | null = null;
  private startTime = 0;
  
  private speedCalc = new SpeedCalculator();
  private memoryMonitor = new MemoryMonitor();
  private chunkTracker = new ChunkTimingTracker();
  
  // Progress state
  private bytesProcessed = 0;
  private totalBytes = 0;
  private chunksProcessed = 0;
  private totalChunks = 0;
  private compressionRatio = 1;
  private phase: JobProgress['phase'] = 'reading';
  
  // Worker load (0-100%)
  private workerLoad = 0;
  private pendingChunks = 0;
  private maxPendingChunks = 8;
  
  /**
   * Start tracking a job
   */
  startJob(jobId: JobId, totalBytes: number, totalChunks: number): void {
    this.reset();
    this.jobId = jobId;
    this.totalBytes = totalBytes;
    this.totalChunks = totalChunks;
    this.startTime = Date.now();
  }
  
  /**
   * Record chunk processed
   */
  recordChunk(
    seq: ChunkSeq,
    originalSize: number,
    compressedSize: number,
    readMs: number,
    compressMs: number
  ): void {
    this.bytesProcessed += originalSize;
    this.chunksProcessed++;
    
    // Update speed
    this.speedCalc.addSample(originalSize);
    
    // Update compression ratio
    if (this.bytesProcessed > 0) {
      const totalCompressed = this.bytesProcessed * this.compressionRatio;
      const newTotalCompressed = totalCompressed + compressedSize - originalSize * this.compressionRatio;
      this.compressionRatio = (newTotalCompressed + compressedSize) / (this.bytesProcessed);
    }
    
    // Track timing
    this.chunkTracker.record({
      seq,
      readMs,
      compressMs,
      totalMs: readMs + compressMs,
      size: originalSize,
    });
  }
  
  /**
   * Update phase
   */
  setPhase(phase: JobProgress['phase']): void {
    this.phase = phase;
  }
  
  /**
   * Update memory usage
   */
  updateMemory(bytes: number): void {
    this.memoryMonitor.setUsage(bytes);
  }
  
  /**
   * Update worker load
   */
  updateWorkerLoad(pendingChunks: number, maxPending: number = 8): void {
    this.pendingChunks = pendingChunks;
    this.maxPendingChunks = maxPending;
    this.workerLoad = Math.min(100, (pendingChunks / maxPending) * 100);
  }
  
  /**
   * Get current progress
   */
  getProgress(): JobProgress {
    return {
      phase: this.phase,
      bytesProcessed: this.bytesProcessed,
      totalBytes: this.totalBytes,
      chunksProcessed: this.chunksProcessed,
      totalChunks: this.totalChunks,
      compressionRatio: this.compressionRatio,
      percent: this.totalBytes > 0 ? (this.bytesProcessed / this.totalBytes) * 100 : 0,
    };
  }
  
  /**
   * Get current telemetry
   */
  getTelemetry(): JobTelemetry {
    const remaining = this.totalBytes - this.bytesProcessed;
    
    return {
      instantSpeed: this.speedCalc.getInstantSpeed(),
      rollingAvgSpeed: this.speedCalc.getRollingSpeed(),
      eta: this.speedCalc.getETA(remaining),
      chunkTimings: this.chunkTracker.getRecent(10),
      workerLoad: this.workerLoad,
      wasmThroughput: this.chunkTracker.getThroughput(),
      memoryUsage: this.memoryMonitor.getCurrentUsage(),
      memoryPeak: this.memoryMonitor.getPeakUsage(),
      timestamp: Date.now(),
    };
  }
  
  /**
   * Get elapsed time in ms
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
  
  /**
   * Reset aggregator
   */
  reset(): void {
    this.jobId = null;
    this.startTime = 0;
    this.bytesProcessed = 0;
    this.totalBytes = 0;
    this.chunksProcessed = 0;
    this.totalChunks = 0;
    this.compressionRatio = 1;
    this.phase = 'reading';
    this.workerLoad = 0;
    this.pendingChunks = 0;
    
    this.speedCalc.reset();
    this.memoryMonitor.reset();
    this.chunkTracker.reset();
  }
}

// ============================================================================
// TELEMETRY EMITTER
// ============================================================================

export type TelemetryCallback = (
  jobId: JobId,
  progress: JobProgress,
  telemetry: JobTelemetry
) => void;

/**
 * Rate-limited telemetry emitter
 */
export class TelemetryEmitter {
  private aggregator: TelemetryAggregator;
  private callback: TelemetryCallback | null = null;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastEmit = 0;
  
  constructor(intervalMs: number = TELEMETRY_INTERVAL_MS) {
    this.aggregator = new TelemetryAggregator();
    this.intervalMs = intervalMs;
  }
  
  /**
   * Start emitting for a job
   */
  start(
    jobId: JobId,
    totalBytes: number,
    totalChunks: number,
    callback: TelemetryCallback
  ): void {
    this.stop();
    
    this.aggregator.startJob(jobId, totalBytes, totalChunks);
    this.callback = callback;
    
    this.timer = setInterval(() => {
      this.emit(jobId);
    }, this.intervalMs);
  }
  
  /**
   * Stop emitting
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.callback = null;
  }
  
  /**
   * Emit current telemetry
   */
  private emit(jobId: JobId): void {
    if (!this.callback) return;
    
    const now = performance.now();
    if (now - this.lastEmit < this.intervalMs * 0.9) return; // Rate limit
    
    this.lastEmit = now;
    
    const progress = this.aggregator.getProgress();
    const telemetry = this.aggregator.getTelemetry();
    
    this.callback(jobId, progress, telemetry);
  }
  
  /**
   * Force immediate emit
   */
  flush(jobId: JobId): void {
    this.lastEmit = 0;
    this.emit(jobId);
  }
  
  /**
   * Get aggregator for updates
   */
  getAggregator(): TelemetryAggregator {
    return this.aggregator;
  }
}

// ============================================================================
// FORMAT UTILITIES
// ============================================================================

/**
 * Format bytes to human-readable
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format speed to human-readable
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';
  
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(3, Math.floor(Math.log(bytesPerSecond) / Math.log(k)));
  
  return `${parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format ETA to human-readable
 */
export function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--';
  
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format duration in ms to human-readable
 */
export function formatDuration(ms: number): string {
  return formatETA(ms / 1000);
}

/**
 * Format percentage
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format compression ratio
 */
export function formatRatio(ratio: number): string {
  if (ratio >= 1) {
    return `1:${ratio.toFixed(2)}`;
  }
  return `${(1 / ratio).toFixed(2)}:1`;
}
