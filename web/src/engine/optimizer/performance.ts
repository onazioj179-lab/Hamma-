/**
 * SPK V34 - Performance Optimizer Layer
 * 
 * Provides dynamic performance tuning:
 * - Auto-adjust chunk size based on throughput
 * - Auto-control concurrency to prevent worker overload
 * - Predictive speed model with rolling averages
 * - Adaptive buffer sizing
 * - Real-time latency smoothing for consistent UI
 */

// ============================================================================
// TYPES
// ============================================================================

export interface PerformanceMetrics {
  throughput: number;           // bytes per second
  latency: number;              // ms per chunk
  chunkSize: number;            // current chunk size
  concurrency: number;          // active worker count
  memoryUsage: number;          // estimated memory in bytes
  cpuUtilization: number;       // 0-1 estimate
  queueDepth: number;           // pending chunks
  smoothedSpeed: number;        // rolling average speed
  predictedEta: number;         // predicted time remaining
}

export interface OptimizationConfig {
  targetThroughput: number;     // target bytes/sec (0 = auto)
  maxMemory: number;            // max memory in bytes
  maxConcurrency: number;       // max parallel workers
  minChunkSize: number;         // minimum chunk size
  maxChunkSize: number;         // maximum chunk size
  adaptiveEnabled: boolean;     // enable auto-tuning
  smoothingFactor: number;      // EMA smoothing (0-1)
}

export interface SpeedSample {
  timestamp: number;
  bytesProcessed: number;
  durationMs: number;
  chunkSize: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: OptimizationConfig = {
  targetThroughput: 0,                    // Auto
  maxMemory: 300 * 1024 * 1024,           // 300MB
  maxConcurrency: navigator.hardwareConcurrency || 4,
  minChunkSize: 64 * 1024,                // 64KB
  maxChunkSize: 16 * 1024 * 1024,         // 16MB
  adaptiveEnabled: true,
  smoothingFactor: 0.3,
};

const SPEED_SAMPLE_WINDOW = 20;           // Keep last 20 samples
const THROUGHPUT_SAMPLE_WINDOW = 10;      // For throughput calculation
const LATENCY_THRESHOLD_MS = 500;         // Target max latency per chunk
const MIN_SAMPLES_FOR_ADAPTATION = 5;     // Min samples before adapting

// ============================================================================
// ROLLING AVERAGE CALCULATOR
// ============================================================================

class RollingAverage {
  private samples: number[] = [];
  private maxSamples: number;
  
  constructor(maxSamples: number = 20) {
    this.maxSamples = maxSamples;
  }
  
  add(value: number): void {
    this.samples.push(value);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }
  
  get average(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }
  
  get count(): number {
    return this.samples.length;
  }
  
  clear(): void {
    this.samples = [];
  }
}

// ============================================================================
// EXPONENTIAL MOVING AVERAGE
// ============================================================================

class ExponentialMovingAverage {
  private value: number | null = null;
  private alpha: number;
  
  constructor(alpha: number = 0.3) {
    this.alpha = alpha;
  }
  
  update(newValue: number): number {
    if (this.value === null) {
      this.value = newValue;
    } else {
      this.value = this.alpha * newValue + (1 - this.alpha) * this.value;
    }
    return this.value;
  }
  
  get current(): number {
    return this.value ?? 0;
  }
  
  reset(): void {
    this.value = null;
  }
}

// ============================================================================
// PERFORMANCE OPTIMIZER
// ============================================================================

export class PerformanceOptimizer {
  private config: OptimizationConfig;
  private speedSamples: SpeedSample[] = [];
  private throughputAvg = new RollingAverage(THROUGHPUT_SAMPLE_WINDOW);
  private latencyAvg = new RollingAverage(SPEED_SAMPLE_WINDOW);
  private smoothedSpeed = new ExponentialMovingAverage();
  
  private currentChunkSize: number;
  private currentConcurrency: number;
  private totalBytesProcessed = 0;
  private totalDurationMs = 0;
  private startTime = 0;
  
  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentChunkSize = 4 * 1024 * 1024; // Start at 4MB
    this.currentConcurrency = Math.min(2, this.config.maxConcurrency);
  }
  
  /**
   * Start optimization session
   */
  start(): void {
    this.startTime = performance.now();
    this.totalBytesProcessed = 0;
    this.totalDurationMs = 0;
    this.speedSamples = [];
    this.throughputAvg.clear();
    this.latencyAvg.clear();
    this.smoothedSpeed.reset();
  }
  
  /**
   * Record a completed chunk
   */
  recordChunk(bytesProcessed: number, durationMs: number): void {
    const sample: SpeedSample = {
      timestamp: performance.now(),
      bytesProcessed,
      durationMs,
      chunkSize: this.currentChunkSize,
    };
    
    this.speedSamples.push(sample);
    if (this.speedSamples.length > SPEED_SAMPLE_WINDOW) {
      this.speedSamples.shift();
    }
    
    this.totalBytesProcessed += bytesProcessed;
    this.totalDurationMs += durationMs;
    
    // Update averages
    const speed = durationMs > 0 ? bytesProcessed / (durationMs / 1000) : 0;
    this.throughputAvg.add(speed);
    this.latencyAvg.add(durationMs);
    this.smoothedSpeed.update(speed);
    
    // Adapt if enabled
    if (this.config.adaptiveEnabled && 
        this.speedSamples.length >= MIN_SAMPLES_FOR_ADAPTATION) {
      this.adaptParameters();
    }
  }
  
  /**
   * Adapt chunk size and concurrency based on performance
   */
  private adaptParameters(): void {
    const avgLatency = this.latencyAvg.average;
    const avgThroughput = this.throughputAvg.average;
    
    // Adjust chunk size based on latency
    if (avgLatency > LATENCY_THRESHOLD_MS * 1.5) {
      // Chunks taking too long - reduce size
      this.currentChunkSize = Math.max(
        this.config.minChunkSize,
        Math.floor(this.currentChunkSize * 0.75)
      );
    } else if (avgLatency < LATENCY_THRESHOLD_MS * 0.5 && avgThroughput > 0) {
      // Chunks finishing fast - increase size for efficiency
      this.currentChunkSize = Math.min(
        this.config.maxChunkSize,
        Math.floor(this.currentChunkSize * 1.25)
      );
    }
    
    // Adjust concurrency based on throughput trend
    const recentSamples = this.speedSamples.slice(-5);
    if (recentSamples.length >= 5) {
      const recentAvg = recentSamples.reduce((s, x) => s + x.bytesProcessed / x.durationMs, 0) / 5;
      const olderSamples = this.speedSamples.slice(-10, -5);
      
      if (olderSamples.length >= 5) {
        const olderAvg = olderSamples.reduce((s, x) => s + x.bytesProcessed / x.durationMs, 0) / 5;
        
        // If throughput is improving and we have headroom, increase concurrency
        if (recentAvg > olderAvg * 1.1 && this.currentConcurrency < this.config.maxConcurrency) {
          this.currentConcurrency = Math.min(
            this.currentConcurrency + 1,
            this.config.maxConcurrency
          );
        }
        // If throughput is declining, reduce concurrency
        else if (recentAvg < olderAvg * 0.8 && this.currentConcurrency > 1) {
          this.currentConcurrency = Math.max(1, this.currentConcurrency - 1);
        }
      }
    }
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    const elapsedMs = performance.now() - this.startTime;
    const currentThroughput = elapsedMs > 0 
      ? this.totalBytesProcessed / (elapsedMs / 1000) 
      : 0;
    
    return {
      throughput: currentThroughput,
      latency: this.latencyAvg.average,
      chunkSize: this.currentChunkSize,
      concurrency: this.currentConcurrency,
      memoryUsage: this.estimateMemoryUsage(),
      cpuUtilization: this.estimateCpuUtilization(),
      queueDepth: 0, // Set externally
      smoothedSpeed: this.smoothedSpeed.current,
      predictedEta: 0, // Calculated externally based on remaining bytes
    };
  }
  
  /**
   * Get recommended chunk size
   */
  getRecommendedChunkSize(): number {
    return this.currentChunkSize;
  }
  
  /**
   * Get recommended concurrency level
   */
  getRecommendedConcurrency(): number {
    return this.currentConcurrency;
  }
  
  /**
   * Get smoothed speed for UI display
   */
  getSmoothedSpeed(): number {
    return this.smoothedSpeed.current;
  }
  
  /**
   * Calculate predicted ETA
   */
  predictEta(remainingBytes: number): number {
    const speed = this.smoothedSpeed.current;
    if (speed <= 0) return Infinity;
    return remainingBytes / speed;
  }
  
  /**
   * Estimate current memory usage
   */
  private estimateMemoryUsage(): number {
    // Estimate based on chunk size and concurrency
    // Each worker can have ~2 chunks in flight (input + output)
    return this.currentChunkSize * this.currentConcurrency * 2;
  }
  
  /**
   * Estimate CPU utilization (0-1)
   */
  private estimateCpuUtilization(): number {
    // Rough estimate based on throughput vs theoretical max
    const maxThroughput = 500 * 1024 * 1024; // 500MB/s theoretical
    return Math.min(1, this.smoothedSpeed.current / maxThroughput);
  }
  
  /**
   * Check if memory budget allows operation
   */
  hasMemoryBudget(requiredBytes: number): boolean {
    return this.estimateMemoryUsage() + requiredBytes <= this.config.maxMemory;
  }
  
  /**
   * Get optimal buffer size for streaming
   */
  getOptimalBufferSize(): number {
    // Based on throughput, aim for ~100ms of data
    const targetBufferMs = 100;
    const bytesPerMs = this.smoothedSpeed.current / 1000;
    const optimalSize = Math.floor(bytesPerMs * targetBufferMs);
    
    // Clamp to reasonable bounds
    return Math.max(
      64 * 1024,  // Min 64KB
      Math.min(optimalSize, 4 * 1024 * 1024) // Max 4MB
    );
  }
  
  /**
   * Reset optimizer state
   */
  reset(): void {
    this.start();
    this.currentChunkSize = 4 * 1024 * 1024;
    this.currentConcurrency = Math.min(2, this.config.maxConcurrency);
  }
}

// ============================================================================
// LATENCY SMOOTHER FOR UI
// ============================================================================

export class LatencySmoother {
  private targetFps = 60;
  private lastUpdate = 0;
  private pendingUpdate: PerformanceMetrics | null = null;
  private animationFrame: number | null = null;
  private onUpdate: ((metrics: PerformanceMetrics) => void) | null = null;
  
  constructor(targetFps: number = 60) {
    this.targetFps = targetFps;
  }
  
  /**
   * Set update callback
   */
  setCallback(callback: (metrics: PerformanceMetrics) => void): void {
    this.onUpdate = callback;
  }
  
  /**
   * Queue metrics update (rate-limited)
   */
  queueUpdate(metrics: PerformanceMetrics): void {
    this.pendingUpdate = metrics;
    
    if (!this.animationFrame) {
      this.animationFrame = requestAnimationFrame(() => this.flush());
    }
  }
  
  /**
   * Flush pending update
   */
  private flush(): void {
    this.animationFrame = null;
    
    const now = performance.now();
    const minInterval = 1000 / this.targetFps;
    
    if (now - this.lastUpdate >= minInterval && this.pendingUpdate && this.onUpdate) {
      this.lastUpdate = now;
      this.onUpdate(this.pendingUpdate);
      this.pendingUpdate = null;
    } else if (this.pendingUpdate) {
      // Reschedule
      this.animationFrame = requestAnimationFrame(() => this.flush());
    }
  }
  
  /**
   * Stop smoother
   */
  stop(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.pendingUpdate = null;
  }
}

// ============================================================================
// THROUGHPUT PREDICTOR
// ============================================================================

export class ThroughputPredictor {
  private samples: { time: number; bytes: number }[] = [];
  private windowMs = 5000; // 5 second window
  
  /**
   * Add sample
   */
  addSample(bytes: number): void {
    const now = performance.now();
    this.samples.push({ time: now, bytes });
    
    // Remove old samples
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter(s => s.time >= cutoff);
  }
  
  /**
   * Get predicted throughput
   */
  predict(): number {
    if (this.samples.length < 2) return 0;
    
    const firstSample = this.samples[0];
    const lastSample = this.samples[this.samples.length - 1];
    
    const totalBytes = this.samples.reduce((s, x) => s + x.bytes, 0);
    const durationMs = lastSample.time - firstSample.time;
    
    if (durationMs <= 0) return 0;
    
    return totalBytes / (durationMs / 1000);
  }
  
  /**
   * Get confidence (0-1) in prediction
   */
  getConfidence(): number {
    // More samples = more confidence
    return Math.min(1, this.samples.length / 10);
  }
  
  /**
   * Reset predictor
   */
  reset(): void {
    this.samples = [];
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let performanceOptimizer: PerformanceOptimizer | null = null;

export function getPerformanceOptimizer(
  config?: Partial<OptimizationConfig>
): PerformanceOptimizer {
  if (!performanceOptimizer || config) {
    performanceOptimizer = new PerformanceOptimizer(config);
  }
  return performanceOptimizer;
}

export function resetPerformanceOptimizer(): void {
  performanceOptimizer = null;
}
