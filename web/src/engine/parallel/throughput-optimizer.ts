/**
 * SPK Ultra-Parallel Throughput Engine - Throughput Optimizer
 * Creator: OJ Treasure Onazi
 * 
 * AI-powered throughput maximization with dynamic lane scaling,
 * memory governance, and adaptive mode switching.
 */

import {
  ThroughputConfig,
  DEFAULT_THROUGHPUT_CONFIG,
  ThroughputMetrics,
  ThroughputMode,
  ThroughputTarget,
  THROUGHPUT_TARGETS,
  ParallelEvent,
  ParallelEventHandler,
  MB,
  GB,
  getThroughputTarget,
} from './types';

// ============================================================================
// THROUGHPUT HISTORY
// ============================================================================

interface ThroughputSample {
  timestamp: number;
  throughput: number;
  activeLanes: number;
  memoryUsage: number;
  saturation: number;
}

// ============================================================================
// OPTIMIZER STATE
// ============================================================================

interface OptimizerState {
  currentMode: ThroughputMode;
  currentTarget: ThroughputTarget;
  history: ThroughputSample[];
  peakThroughput: number;
  avgThroughput: number;
  scaleUpCooldown: number;
  scaleDownCooldown: number;
  lastScaleAction: number;
  memoryPressure: number;
  cpuPressure: number;
}

// ============================================================================
// THROUGHPUT OPTIMIZER
// ============================================================================

export class ThroughputOptimizer {
  private config: ThroughputConfig;
  private state: OptimizerState;
  private eventHandlers: Set<ParallelEventHandler> = new Set();
  private measurementTimer: ReturnType<typeof setInterval> | null = null;
  private bytesProcessed = BigInt(0);
  private lastMeasurement = 0;
  private lastBytes = BigInt(0);
  private totalChunks = 0;
  private completedChunks = 0;
  private activeLanes = 0;
  private totalLanes = 0;

  constructor(config: Partial<ThroughputConfig> = {}) {
    this.config = { ...DEFAULT_THROUGHPUT_CONFIG, ...config };
    
    const cores = typeof navigator !== 'undefined' 
      ? (navigator.hardwareConcurrency || 4) 
      : 4;
    
    this.state = {
      currentMode: this.config.mode,
      currentTarget: getThroughputTarget(cores),
      history: [],
      peakThroughput: 0,
      avgThroughput: 0,
      scaleUpCooldown: 0,
      scaleDownCooldown: 0,
      lastScaleAction: 0,
      memoryPressure: 0,
      cpuPressure: 0,
    };
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: ParallelEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: ParallelEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: ParallelEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  initialize(totalChunks: number, initialLanes: number): void {
    this.totalChunks = totalChunks;
    this.totalLanes = initialLanes;
    this.completedChunks = 0;
    this.bytesProcessed = BigInt(0);
    this.lastBytes = BigInt(0);
    this.lastMeasurement = performance.now();
    this.state.history = [];
    
    this.startMeasuring();
  }

  // ==========================================================================
  // MEASUREMENT
  // ==========================================================================

  private startMeasuring(): void {
    if (this.measurementTimer) return;

    this.measurementTimer = setInterval(() => {
      this.measure();
    }, this.config.measurementWindow);
  }

  private stopMeasuring(): void {
    if (this.measurementTimer) {
      clearInterval(this.measurementTimer);
      this.measurementTimer = null;
    }
  }

  private measure(): void {
    const now = performance.now();
    const elapsed = (now - this.lastMeasurement) / 1000; // seconds
    
    if (elapsed === 0) return;

    const bytesDelta = this.bytesProcessed - this.lastBytes;
    const throughput = Number(bytesDelta) / elapsed;

    const sample: ThroughputSample = {
      timestamp: now,
      throughput,
      activeLanes: this.activeLanes,
      memoryUsage: this.getMemoryUsage(),
      saturation: this.calculateSaturation(),
    };

    this.state.history.push(sample);
    
    // Trim history
    if (this.state.history.length > this.config.historySize) {
      this.state.history.shift();
    }

    // Update stats
    if (throughput > this.state.peakThroughput) {
      this.state.peakThroughput = throughput;
    }

    this.state.avgThroughput = this.calculateAverageThroughput();

    // Check for scaling
    if (this.config.dynamicScaling) {
      this.checkScaling(throughput);
    }

    // Update cooldowns
    if (this.state.scaleUpCooldown > 0) this.state.scaleUpCooldown -= this.config.measurementWindow;
    if (this.state.scaleDownCooldown > 0) this.state.scaleDownCooldown -= this.config.measurementWindow;

    this.lastMeasurement = now;
    this.lastBytes = this.bytesProcessed;

    // Emit metrics
    this.emit({ type: 'throughput-update', metrics: this.getMetrics() });

    // Check saturation
    if (sample.saturation < 0.3) {
      this.emit({ type: 'saturation-warning', saturation: sample.saturation });
    }
  }

  private getMemoryUsage(): number {
    if (typeof performance !== 'undefined' && (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory) {
      return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    }
    return 0;
  }

  private calculateSaturation(): number {
    if (this.totalLanes === 0) return 0;
    return this.activeLanes / this.totalLanes;
  }

  private calculateAverageThroughput(): number {
    if (this.state.history.length === 0) return 0;
    const sum = this.state.history.reduce((s, h) => s + h.throughput, 0);
    return sum / this.state.history.length;
  }

  // ==========================================================================
  // SCALING DECISIONS
  // ==========================================================================

  private checkScaling(currentThroughput: number): void {
    const now = performance.now();
    const targetThroughput = this.config.targetThroughput;
    const ratio = currentThroughput / targetThroughput;

    // Scale up if under threshold and not cooling down
    if (ratio >= this.config.scaleUpThreshold && this.state.scaleUpCooldown <= 0) {
      // Check memory before scaling
      if (this.state.memoryPressure < 0.8) {
        this.recommendScaleUp();
        this.state.scaleUpCooldown = 5000; // 5s cooldown
        this.state.lastScaleAction = now;
      }
    }

    // Scale down if over threshold and not cooling down
    if (ratio < this.config.scaleDownThreshold && this.state.scaleDownCooldown <= 0) {
      this.recommendScaleDown();
      this.state.scaleDownCooldown = 3000; // 3s cooldown
      this.state.lastScaleAction = now;
    }
  }

  private recommendScaleUp(): void {
    const newLanes = Math.min(this.totalLanes + 2, this.state.currentTarget.recommendedLanes * 2);
    if (newLanes > this.totalLanes) {
      this.emit({ type: 'scale-up', newLanes });
    }
  }

  private recommendScaleDown(): void {
    const removeCandidates: string[] = [];
    // Would need to identify which lanes to remove
    this.emit({ type: 'scale-down', removedLanes: removeCandidates });
  }

  // ==========================================================================
  // UPDATE METHODS
  // ==========================================================================

  recordCompletion(bytes: number): void {
    this.bytesProcessed += BigInt(bytes);
    this.completedChunks++;
  }

  setActiveLanes(count: number): void {
    this.activeLanes = count;
  }

  setTotalLanes(count: number): void {
    this.totalLanes = count;
  }

  setMemoryPressure(pressure: number): void {
    this.state.memoryPressure = pressure;
    if (pressure > 0.9) {
      this.emit({ 
        type: 'memory-pressure', 
        current: this.getMemoryUsage(), 
        limit: this.config.maxMemory 
      });
    }
  }

  // ==========================================================================
  // MODE CONTROL
  // ==========================================================================

  setMode(mode: ThroughputMode): void {
    this.state.currentMode = mode;
    
    // Adjust config based on mode
    switch (mode) {
      case 'conservative':
        this.config.dynamicScaling = false;
        this.config.scaleUpThreshold = 0.95;
        break;
      case 'balanced':
        this.config.dynamicScaling = true;
        this.config.scaleUpThreshold = 0.9;
        break;
      case 'aggressive':
        this.config.dynamicScaling = true;
        this.config.scaleUpThreshold = 0.8;
        break;
      case 'turbo':
        this.config.dynamicScaling = true;
        this.config.scaleUpThreshold = 0.7;
        break;
    }
  }

  getMode(): ThroughputMode {
    return this.state.currentMode;
  }

  // ==========================================================================
  // METRICS
  // ==========================================================================

  getMetrics(): ThroughputMetrics {
    const bytesRemaining = BigInt(this.totalChunks - this.completedChunks) * 
                          BigInt(4 * MB); // Estimate

    const estimatedCompletion = this.state.avgThroughput > 0
      ? Number(bytesRemaining) / this.state.avgThroughput * 1000
      : Infinity;

    return {
      currentThroughput: this.state.history.length > 0 
        ? this.state.history[this.state.history.length - 1].throughput 
        : 0,
      peakThroughput: this.state.peakThroughput,
      avgThroughput: this.state.avgThroughput,
      history: this.state.history.map(h => h.throughput),
      activeLanes: this.activeLanes,
      idleLanes: this.totalLanes - this.activeLanes,
      saturation: this.calculateSaturation(),
      estimatedCompletion,
      bytesRemaining,
      memoryUsage: this.getMemoryUsage(),
    };
  }

  getTarget(): ThroughputTarget {
    return this.state.currentTarget;
  }

  // ==========================================================================
  // PREDICTIONS
  // ==========================================================================

  predictOptimalLaneCount(): number {
    if (this.state.history.length < 5) {
      return this.state.currentTarget.recommendedLanes;
    }

    // Analyze throughput vs lane count relationship
    const dataPoints: Array<{ lanes: number; throughput: number }> = [];
    for (const sample of this.state.history) {
      dataPoints.push({
        lanes: sample.activeLanes,
        throughput: sample.throughput,
      });
    }

    // Find optimal point (highest throughput per lane)
    let bestEfficiency = 0;
    let optimalLanes = this.totalLanes;

    for (const point of dataPoints) {
      if (point.lanes > 0) {
        const efficiency = point.throughput / point.lanes;
        if (efficiency > bestEfficiency) {
          bestEfficiency = efficiency;
          optimalLanes = point.lanes;
        }
      }
    }

    // Scale based on target
    const targetRatio = this.config.targetThroughput / this.state.avgThroughput;
    return Math.ceil(optimalLanes * targetRatio);
  }

  shouldScaleUp(): boolean {
    if (!this.config.dynamicScaling) return false;
    if (this.state.scaleUpCooldown > 0) return false;
    if (this.state.memoryPressure > 0.8) return false;

    const ratio = this.state.avgThroughput / this.config.targetThroughput;
    return ratio >= this.config.scaleUpThreshold && this.totalLanes < this.state.currentTarget.recommendedLanes * 2;
  }

  shouldScaleDown(): boolean {
    if (!this.config.dynamicScaling) return false;
    if (this.state.scaleDownCooldown > 0) return false;

    const ratio = this.state.avgThroughput / this.config.targetThroughput;
    return ratio < this.config.scaleDownThreshold && this.totalLanes > 2;
  }

  // ==========================================================================
  // RECOMMENDATIONS
  // ==========================================================================

  getRecommendations(): {
    chunkSize: number;
    laneCount: number;
    bufferDepth: number;
    mode: ThroughputMode;
  } {
    const memoryAvailable = this.config.maxMemory - this.getMemoryUsage();
    
    // Chunk size based on memory
    let chunkSize = 4 * MB;
    if (memoryAvailable > 1 * GB) {
      chunkSize = 8 * MB;
    } else if (memoryAvailable < 256 * MB) {
      chunkSize = 1 * MB;
    }

    // Lane count based on throughput
    const optimalLanes = this.predictOptimalLaneCount();
    const laneCount = Math.min(
      optimalLanes,
      Math.floor(memoryAvailable / (chunkSize * 2))
    );

    // Buffer depth
    const bufferDepth = Math.max(3, Math.floor(memoryAvailable / (chunkSize * laneCount)));

    // Mode recommendation
    let mode: ThroughputMode = 'balanced';
    if (this.state.memoryPressure > 0.7) {
      mode = 'conservative';
    } else if (this.state.avgThroughput > this.state.currentTarget.maxThroughput * 0.8) {
      mode = 'aggressive';
    }

    return {
      chunkSize,
      laneCount,
      bufferDepth,
      mode,
    };
  }

  // ==========================================================================
  // WASM WARMUP
  // ==========================================================================

  needsWarmup(): boolean {
    // Check if throughput is significantly below target in early samples
    if (this.state.history.length < 5) return false;
    
    const early = this.state.history.slice(0, 5);
    const avgEarly = early.reduce((s, h) => s + h.throughput, 0) / early.length;
    
    return avgEarly < this.config.minThroughput;
  }

  getWarmupChunksNeeded(): number {
    const target = getThroughputTarget(
      typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4
    );
    return target.recommendedLanes * 2;
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  reset(): void {
    this.stopMeasuring();
    this.state = {
      currentMode: this.config.mode,
      currentTarget: this.state.currentTarget,
      history: [],
      peakThroughput: 0,
      avgThroughput: 0,
      scaleUpCooldown: 0,
      scaleDownCooldown: 0,
      lastScaleAction: 0,
      memoryPressure: 0,
      cpuPressure: 0,
    };
    this.bytesProcessed = BigInt(0);
    this.lastBytes = BigInt(0);
    this.totalChunks = 0;
    this.completedChunks = 0;
  }

  shutdown(): void {
    this.stopMeasuring();
    this.eventHandlers.clear();
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createThroughputOptimizer(
  config?: Partial<ThroughputConfig>
): ThroughputOptimizer {
  return new ThroughputOptimizer(config);
}
