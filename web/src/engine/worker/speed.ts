/**
 * SPK V25 - Speed Calculator
 * Real-time throughput and ETA calculation with rolling average
 */

interface SpeedSample {
  bytes: number;
  timeMs: number;
  timestamp: number;
}

/**
 * High-precision speed calculator with rolling window
 */
export class SpeedCalculator {
  private samples: SpeedSample[] = [];
  private readonly windowSize: number; // samples to keep
  private readonly windowTimeMs: number; // max age of samples
  private totalBytes: number = 0;
  private totalTimeMs: number = 0;
  
  constructor(windowSize: number = 20, windowTimeMs: number = 5000) {
    this.windowSize = windowSize;
    this.windowTimeMs = windowTimeMs;
  }
  
  /**
   * Add a new sample
   */
  addSample(bytes: number, timeMs: number): void {
    const now = performance.now();
    
    this.samples.push({
      bytes,
      timeMs,
      timestamp: now,
    });
    
    this.totalBytes += bytes;
    this.totalTimeMs += timeMs;
    
    // Prune old samples
    this.pruneOldSamples(now);
  }
  
  /**
   * Remove samples outside the window
   */
  private pruneOldSamples(now: number): void {
    // Remove by count
    while (this.samples.length > this.windowSize) {
      const removed = this.samples.shift()!;
      this.totalBytes -= removed.bytes;
      this.totalTimeMs -= removed.timeMs;
    }
    
    // Remove by age
    const cutoff = now - this.windowTimeMs;
    while (this.samples.length > 0 && this.samples[0].timestamp < cutoff) {
      const removed = this.samples.shift()!;
      this.totalBytes -= removed.bytes;
      this.totalTimeMs -= removed.timeMs;
    }
  }
  
  /**
   * Get current speed in bytes per second
   */
  getCurrentSpeed(): number {
    if (this.samples.length === 0 || this.totalTimeMs === 0) {
      return 0;
    }
    
    // Calculate weighted average giving more weight to recent samples
    let weightedBytes = 0;
    let weightedTime = 0;
    const now = performance.now();
    
    for (const sample of this.samples) {
      // Weight decreases linearly with age
      const age = now - sample.timestamp;
      const weight = Math.max(0, 1 - age / this.windowTimeMs);
      
      weightedBytes += sample.bytes * weight;
      weightedTime += sample.timeMs * weight;
    }
    
    if (weightedTime === 0) {
      return 0;
    }
    
    // Convert to bytes per second
    return (weightedBytes / weightedTime) * 1000;
  }
  
  /**
   * Get simple average speed (non-weighted)
   */
  getAverageSpeed(): number {
    if (this.totalTimeMs === 0) {
      return 0;
    }
    return (this.totalBytes / this.totalTimeMs) * 1000;
  }
  
  /**
   * Get ETA in seconds for remaining bytes
   */
  getETA(remainingBytes: number): number {
    const speed = this.getCurrentSpeed();
    
    if (speed === 0 || remainingBytes <= 0) {
      return 0;
    }
    
    return remainingBytes / speed;
  }
  
  /**
   * Get instantaneous speed from last sample
   */
  getInstantSpeed(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    
    const last = this.samples[this.samples.length - 1];
    if (last.timeMs === 0) {
      return 0;
    }
    
    return (last.bytes / last.timeMs) * 1000;
  }
  
  /**
   * Get speed statistics
   */
  getStats(): {
    currentSpeed: number;
    averageSpeed: number;
    instantSpeed: number;
    sampleCount: number;
    totalBytes: number;
    totalTimeMs: number;
  } {
    return {
      currentSpeed: this.getCurrentSpeed(),
      averageSpeed: this.getAverageSpeed(),
      instantSpeed: this.getInstantSpeed(),
      sampleCount: this.samples.length,
      totalBytes: this.totalBytes,
      totalTimeMs: this.totalTimeMs,
    };
  }
  
  /**
   * Reset calculator
   */
  reset(): void {
    this.samples = [];
    this.totalBytes = 0;
    this.totalTimeMs = 0;
  }
}

/**
 * Throttled progress emitter
 * Ensures UI updates at consistent intervals without overwhelming
 */
export class ThrottledEmitter {
  private lastEmit: number = 0;
  private pendingData: any = null;
  private intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  
  constructor(intervalMs: number = 75) {
    this.intervalMs = intervalMs;
  }
  
  /**
   * Emit data, throttled to interval
   */
  emit<T>(data: T, callback: (data: T) => void): void {
    const now = performance.now();
    const elapsed = now - this.lastEmit;
    
    if (elapsed >= this.intervalMs) {
      // Emit immediately
      this.lastEmit = now;
      callback(data);
      
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    } else {
      // Store for delayed emit
      this.pendingData = data;
      
      if (!this.timer) {
        this.timer = setTimeout(() => {
          if (this.pendingData !== null) {
            this.lastEmit = performance.now();
            callback(this.pendingData);
            this.pendingData = null;
          }
          this.timer = null;
        }, this.intervalMs - elapsed);
      }
    }
  }
  
  /**
   * Force emit pending data
   */
  flush<T>(callback: (data: T) => void): void {
    if (this.pendingData !== null) {
      callback(this.pendingData);
      this.pendingData = null;
    }
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  
  /**
   * Reset emitter
   */
  reset(): void {
    this.lastEmit = 0;
    this.pendingData = null;
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
