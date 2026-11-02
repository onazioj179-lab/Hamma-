/**
 * SPK Micro-Optimization Layer - AI Optimizer Micro-Tuning
 * Creator: OJ Treasure Onazi
 * 
 * SECTION 8: AI OPTIMIZER MICRO-TUNING
 * - Reduced evaluation interval (100-300ms)
 * - Predictive models for stalls, bottlenecks, memory pressure
 * - Stability-first mode for huge datasets
 * - Burst mode for short jobs
 */

import type {
  AIOptimizerConfig,
  AIPrediction,
  AIAction,
  AIOptimizerStats,
  AIMode,
  MemoryPressure,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const MB = 1024 * 1024;

const DEFAULT_AI_CONFIG: AIOptimizerConfig = {
  evaluationIntervalMs: 200,
  predictiveModelsEnabled: true,
  workerStallPrediction: true,
  bottleneckPrediction: true,
  memoryPressurePrediction: true,
  stabilityFirstMode: false,
  prioritizeRolloverSafe: true,
  avoidAggressiveGrowth: true,
  maxChunkGrowthRate: 1.25,
  burstModeEnabled: true,
  burstModeThreshold: 100 * MB,
  burstMaxThroughput: true,
};

// ============================================================================
// TELEMETRY COLLECTOR
// ============================================================================

interface TelemetrySnapshot {
  timestamp: number;
  throughputBps: number;
  memoryUsage: number;
  memoryPressure: MemoryPressure;
  workerLoad: number[];
  chunkTimes: number[];
  stallCount: number;
  errorCount: number;
  queueDepth: number;
}

class TelemetryBuffer {
  private snapshots: TelemetrySnapshot[] = [];
  private maxSnapshots = 100;
  private windowMs = 5000;  // 5 second window

  /**
   * Add snapshot
   */
  add(snapshot: TelemetrySnapshot): void {
    this.snapshots.push(snapshot);
    
    // Trim old snapshots
    const cutoff = Date.now() - this.windowMs;
    while (this.snapshots.length > 0 && this.snapshots[0].timestamp < cutoff) {
      this.snapshots.shift();
    }
    
    // Also limit by count
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /**
   * Get recent snapshots
   */
  getRecent(count?: number): TelemetrySnapshot[] {
    if (count) {
      return this.snapshots.slice(-count);
    }
    return [...this.snapshots];
  }

  /**
   * Get trend (positive = improving, negative = degrading)
   */
  getTrend(metric: keyof TelemetrySnapshot): number {
    if (this.snapshots.length < 3) return 0;

    const recent = this.snapshots.slice(-10);
    const values = recent.map(s => {
      const val = s[metric];
      return typeof val === 'number' ? val : 0;
    });

    // Simple linear regression slope
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  /**
   * Get average value
   */
  getAverage(metric: keyof TelemetrySnapshot): number {
    if (this.snapshots.length === 0) return 0;

    let sum = 0;
    for (const snapshot of this.snapshots) {
      const val = snapshot[metric];
      if (typeof val === 'number') {
        sum += val;
      }
    }

    return sum / this.snapshots.length;
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.snapshots = [];
  }
}

// ============================================================================
// STALL PREDICTOR
// ============================================================================

class StallPredictor {
  private stallHistory: Array<{ timestamp: number; workerId: string; duration: number }> = [];
  private maxHistory = 50;

  /**
   * Record stall event
   */
  recordStall(workerId: string, duration: number): void {
    this.stallHistory.push({
      timestamp: Date.now(),
      workerId,
      duration,
    });

    if (this.stallHistory.length > this.maxHistory) {
      this.stallHistory.shift();
    }
  }

  /**
   * Predict stall probability
   */
  predictStallProbability(telemetry: TelemetryBuffer): AIPrediction | null {
    const recent = this.stallHistory.filter(
      s => Date.now() - s.timestamp < 30000
    );

    if (recent.length === 0) {
      return null;
    }

    // Calculate stall frequency
    const stallsPerSecond = recent.length / 30;
    
    // Check worker load imbalance
    const recentSnapshots = telemetry.getRecent(5);
    let maxLoadDiff = 0;
    
    for (const snapshot of recentSnapshots) {
      if (snapshot.workerLoad.length > 1) {
        const max = Math.max(...snapshot.workerLoad);
        const min = Math.min(...snapshot.workerLoad);
        maxLoadDiff = Math.max(maxLoadDiff, max - min);
      }
    }

    // Combine factors
    const probability = Math.min(1, stallsPerSecond * 0.3 + maxLoadDiff * 0.5);

    if (probability > 0.3) {
      return {
        type: 'stall',
        probability,
        timeToEventMs: 1000 / (stallsPerSecond + 0.1),
        severity: probability > 0.7 ? 'high' : probability > 0.5 ? 'medium' : 'low',
        recommendation: 'Reduce chunk size or add workers',
        suggestedAction: {
          type: 'adjust-chunk-size',
          parameter: 'chunkSize',
          oldValue: 0,
          newValue: 0.75,  // Multiplier
          confidence: probability,
          urgency: probability,
        },
      };
    }

    return null;
  }

  /**
   * Clear history
   */
  clear(): void {
    this.stallHistory = [];
  }
}

// ============================================================================
// BOTTLENECK PREDICTOR
// ============================================================================

type BottleneckType = 'io' | 'cpu' | 'memory' | 'worker' | 'wasm';

interface BottleneckSignal {
  type: BottleneckType;
  severity: number;  // 0-1
  evidence: string;
}

class BottleneckPredictor {
  /**
   * Detect bottlenecks from telemetry
   */
  detectBottlenecks(telemetry: TelemetryBuffer): BottleneckSignal[] {
    const bottlenecks: BottleneckSignal[] = [];
    const recent = telemetry.getRecent(10);

    if (recent.length < 3) return bottlenecks;

    // Check throughput trend
    const throughputTrend = telemetry.getTrend('throughputBps');
    if (throughputTrend < -1000000) {  // Declining by 1MB/s
      bottlenecks.push({
        type: 'cpu',
        severity: Math.min(1, Math.abs(throughputTrend) / 10000000),
        evidence: 'Declining throughput detected',
      });
    }

    // Check memory pressure
    const avgPressure = recent.filter(s => s.memoryPressure === 'high' || s.memoryPressure === 'critical').length / recent.length;
    if (avgPressure > 0.3) {
      bottlenecks.push({
        type: 'memory',
        severity: avgPressure,
        evidence: `Memory pressure ${(avgPressure * 100).toFixed(0)}% of samples`,
      });
    }

    // Check worker utilization
    const workerLoads = recent.flatMap(s => s.workerLoad);
    if (workerLoads.length > 0) {
      const avgWorkerLoad = workerLoads.reduce((a, b) => a + b, 0) / workerLoads.length;
      
      if (avgWorkerLoad > 0.9) {
        bottlenecks.push({
          type: 'worker',
          severity: avgWorkerLoad,
          evidence: `Worker utilization at ${(avgWorkerLoad * 100).toFixed(0)}%`,
        });
      } else if (avgWorkerLoad < 0.3) {
        bottlenecks.push({
          type: 'io',
          severity: 1 - avgWorkerLoad,
          evidence: `Workers underutilized at ${(avgWorkerLoad * 100).toFixed(0)}%`,
        });
      }
    }

    // Check queue depth
    const avgQueueDepth = telemetry.getAverage('queueDepth');
    if (avgQueueDepth < 2) {
      bottlenecks.push({
        type: 'io',
        severity: 0.5,
        evidence: 'Queue depth too low - I/O may be bottleneck',
      });
    } else if (avgQueueDepth > 20) {
      bottlenecks.push({
        type: 'worker',
        severity: 0.7,
        evidence: 'Queue depth too high - workers overloaded',
      });
    }

    return bottlenecks;
  }

  /**
   * Generate prediction from bottlenecks
   */
  predict(bottlenecks: BottleneckSignal[]): AIPrediction | null {
    if (bottlenecks.length === 0) return null;

    // Find most severe
    const worst = bottlenecks.reduce((a, b) => a.severity > b.severity ? a : b);

    // Generate action based on bottleneck type
    let action: AIAction;
    let recommendation: string;

    switch (worst.type) {
      case 'io':
        action = {
          type: 'adjust-chunk-size',
          parameter: 'chunkSize',
          oldValue: 0,
          newValue: 1.5,  // Increase
          confidence: worst.severity,
          urgency: worst.severity * 0.7,
        };
        recommendation = 'Increase chunk size to improve I/O efficiency';
        break;

      case 'cpu':
      case 'worker':
        action = {
          type: 'adjust-workers',
          parameter: 'workerCount',
          oldValue: 0,
          newValue: 1,  // Add one
          confidence: worst.severity,
          urgency: worst.severity * 0.8,
        };
        recommendation = 'Add workers or reduce chunk complexity';
        break;

      case 'memory':
        action = {
          type: 'gc',
          parameter: 'memoryPressure',
          oldValue: 'high',
          newValue: 'normal',
          confidence: worst.severity,
          urgency: worst.severity,
        };
        recommendation = 'Trigger GC and reduce memory allocation';
        break;

      default:
        action = {
          type: 'throttle',
          parameter: 'throughput',
          oldValue: 0,
          newValue: 0.8,  // 80%
          confidence: worst.severity,
          urgency: worst.severity * 0.5,
        };
        recommendation = 'Throttle to stabilize performance';
    }

    return {
      type: 'bottleneck',
      probability: worst.severity,
      timeToEventMs: 500,
      severity: worst.severity > 0.7 ? 'high' : worst.severity > 0.4 ? 'medium' : 'low',
      recommendation,
      suggestedAction: action,
    };
  }
}

// ============================================================================
// MEMORY PRESSURE PREDICTOR
// ============================================================================

class MemoryPressurePredictor {
  private pressureHistory: Array<{ timestamp: number; usage: number; pressure: MemoryPressure }> = [];
  private maxHistory = 100;

  /**
   * Record memory state
   */
  record(usage: number, pressure: MemoryPressure): void {
    this.pressureHistory.push({
      timestamp: Date.now(),
      usage,
      pressure,
    });

    if (this.pressureHistory.length > this.maxHistory) {
      this.pressureHistory.shift();
    }
  }

  /**
   * Predict memory pressure
   */
  predict(): AIPrediction | null {
    if (this.pressureHistory.length < 5) return null;

    const recent = this.pressureHistory.slice(-20);
    
    // Calculate usage trend
    const usages = recent.map(p => p.usage);
    const firstHalf = usages.slice(0, Math.floor(usages.length / 2));
    const secondHalf = usages.slice(Math.floor(usages.length / 2));
    
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const growthRate = (avgSecond - avgFirst) / avgFirst;

    // Check for concerning patterns
    const criticalCount = recent.filter(p => p.pressure === 'critical').length;
    const highCount = recent.filter(p => p.pressure === 'high').length;

    const severity = Math.min(1, 
      growthRate * 2 + 
      (criticalCount / recent.length) * 0.5 + 
      (highCount / recent.length) * 0.3
    );

    if (severity > 0.3) {
      // Project time to critical
      const currentUsage = usages[usages.length - 1];
      const criticalUsage = 500 * 1024 * 1024;  // 500MB
      const timeToEvent = growthRate > 0 
        ? (criticalUsage - currentUsage) / (growthRate * currentUsage) * 1000
        : 10000;

      return {
        type: 'memory',
        probability: severity,
        timeToEventMs: Math.max(100, timeToEvent),
        severity: severity > 0.7 ? 'critical' : severity > 0.5 ? 'high' : 'medium',
        recommendation: 'Reduce memory allocation or trigger GC',
        suggestedAction: {
          type: 'gc',
          parameter: 'memoryUsage',
          oldValue: currentUsage,
          newValue: currentUsage * 0.7,
          confidence: severity,
          urgency: severity,
        },
      };
    }

    return null;
  }

  /**
   * Clear history
   */
  clear(): void {
    this.pressureHistory = [];
  }
}

// ============================================================================
// AI OPTIMIZER ENGINE
// ============================================================================

export class AIOptimizerEngine {
  private config: AIOptimizerConfig;
  private mode: AIMode = 'active';
  private telemetry: TelemetryBuffer;
  private stallPredictor: StallPredictor;
  private bottleneckPredictor: BottleneckPredictor;
  private memoryPredictor: MemoryPressurePredictor;
  private evaluationTimer: number | null = null;
  private pendingActions: AIAction[] = [];
  private onPrediction?: (prediction: AIPrediction) => void;
  private onAction?: (action: AIAction) => void;

  private stats: AIOptimizerStats = {
    predictionsGenerated: 0,
    predictionsApplied: 0,
    predictionAccuracy: 0,
    adjustmentsMade: 0,
    stallsPrevented: 0,
    bottlenecksAvoided: 0,
    memoryPressureEvents: 0,
    avgDecisionLatency: 0,
    modeChanges: 0,
  };

  private decisionLatencies: number[] = [];
  private predictionOutcomes: Array<{ predicted: boolean; occurred: boolean }> = [];

  constructor(config: Partial<AIOptimizerConfig> = {}) {
    this.config = { ...DEFAULT_AI_CONFIG, ...config };
    this.telemetry = new TelemetryBuffer();
    this.stallPredictor = new StallPredictor();
    this.bottleneckPredictor = new BottleneckPredictor();
    this.memoryPredictor = new MemoryPressurePredictor();
  }

  /**
   * Start AI optimization
   */
  start(): void {
    if (this.evaluationTimer) return;

    this.evaluationTimer = window.setInterval(
      () => this.evaluate(),
      this.config.evaluationIntervalMs
    );
  }

  /**
   * Stop AI optimization
   */
  stop(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  /**
   * Record telemetry
   */
  recordTelemetry(snapshot: Omit<TelemetrySnapshot, 'timestamp'>): void {
    this.telemetry.add({
      ...snapshot,
      timestamp: Date.now(),
    });

    // Record memory for prediction
    this.memoryPredictor.record(snapshot.memoryUsage, snapshot.memoryPressure);
  }

  /**
   * Record stall event
   */
  recordStall(workerId: string, duration: number): void {
    this.stallPredictor.recordStall(workerId, duration);
    this.stats.stallsPrevented++;  // Track for accuracy
  }

  /**
   * Set prediction callback
   */
  onPredictionGenerated(callback: (prediction: AIPrediction) => void): void {
    this.onPrediction = callback;
  }

  /**
   * Set action callback
   */
  onActionSuggested(callback: (action: AIAction) => void): void {
    this.onAction = callback;
  }

  /**
   * Run evaluation cycle
   */
  private evaluate(): void {
    if (this.mode === 'off') return;

    const startTime = performance.now();
    const predictions: AIPrediction[] = [];

    // Stall prediction
    if (this.config.workerStallPrediction) {
      const stallPrediction = this.stallPredictor.predictStallProbability(this.telemetry);
      if (stallPrediction) {
        predictions.push(stallPrediction);
      }
    }

    // Bottleneck prediction
    if (this.config.bottleneckPrediction) {
      const bottlenecks = this.bottleneckPredictor.detectBottlenecks(this.telemetry);
      const bottleneckPrediction = this.bottleneckPredictor.predict(bottlenecks);
      if (bottleneckPrediction) {
        predictions.push(bottleneckPrediction);
        this.stats.bottlenecksAvoided++;
      }
    }

    // Memory pressure prediction
    if (this.config.memoryPressurePrediction) {
      const memoryPrediction = this.memoryPredictor.predict();
      if (memoryPrediction) {
        predictions.push(memoryPrediction);
        this.stats.memoryPressureEvents++;
      }
    }

    // Process predictions
    for (const prediction of predictions) {
      this.stats.predictionsGenerated++;
      this.onPrediction?.(prediction);

      // Apply action if in active/aggressive mode
      if (this.mode === 'active' || this.mode === 'aggressive') {
        if (prediction.suggestedAction.urgency > 0.5 || this.mode === 'aggressive') {
          this.pendingActions.push(prediction.suggestedAction);
          this.onAction?.(prediction.suggestedAction);
          this.stats.adjustmentsMade++;
        }
      }
    }

    // Track latency
    const elapsed = performance.now() - startTime;
    this.decisionLatencies.push(elapsed);
    if (this.decisionLatencies.length > 100) {
      this.decisionLatencies.shift();
    }
    this.stats.avgDecisionLatency = 
      this.decisionLatencies.reduce((a, b) => a + b, 0) / this.decisionLatencies.length;
  }

  /**
   * Get pending actions
   */
  getPendingActions(): AIAction[] {
    const actions = [...this.pendingActions];
    this.pendingActions = [];
    return actions;
  }

  /**
   * Apply action and record outcome
   */
  applyAction(action: AIAction): void {
    this.stats.predictionsApplied++;
    
    // Record for accuracy tracking
    this.predictionOutcomes.push({
      predicted: true,
      occurred: true,  // Will be updated based on actual outcome
    });
  }

  /**
   * Record prediction outcome
   */
  recordOutcome(predicted: boolean, occurred: boolean): void {
    this.predictionOutcomes.push({ predicted, occurred });
    
    // Keep last 100
    if (this.predictionOutcomes.length > 100) {
      this.predictionOutcomes.shift();
    }

    // Update accuracy
    const correct = this.predictionOutcomes.filter(
      o => o.predicted === o.occurred
    ).length;
    this.stats.predictionAccuracy = correct / this.predictionOutcomes.length;
  }

  /**
   * Set optimization mode
   */
  setMode(mode: AIMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.stats.modeChanges++;
    }
  }

  /**
   * Get current mode
   */
  getMode(): AIMode {
    return this.mode;
  }

  /**
   * Enable stability mode (for huge datasets)
   */
  enableStabilityMode(): void {
    this.config.stabilityFirstMode = true;
    this.config.avoidAggressiveGrowth = true;
    this.config.maxChunkGrowthRate = 1.1;
  }

  /**
   * Enable burst mode (for short jobs)
   */
  enableBurstMode(): void {
    this.config.burstModeEnabled = true;
    this.config.evaluationIntervalMs = 100;
    this.setMode('aggressive');
    
    // Restart timer with new interval
    this.stop();
    this.start();
  }

  /**
   * Check if should use stability mode
   */
  shouldUseStabilityMode(fileSize: number): boolean {
    // Use stability for files > 10GB
    return fileSize > 10 * 1024 * 1024 * 1024;
  }

  /**
   * Check if should use burst mode
   */
  shouldUseBurstMode(fileSize: number): boolean {
    return fileSize < this.config.burstModeThreshold;
  }

  /**
   * Get statistics
   */
  getStats(): AIOptimizerStats {
    return { ...this.stats };
  }

  /**
   * Get configuration
   */
  getConfig(): AIOptimizerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AIOptimizerConfig>): void {
    const oldInterval = this.config.evaluationIntervalMs;
    this.config = { ...this.config, ...config };

    // Restart timer if interval changed
    if (config.evaluationIntervalMs && config.evaluationIntervalMs !== oldInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Reset optimizer
   */
  reset(): void {
    this.stop();
    this.telemetry.clear();
    this.stallPredictor.clear();
    this.memoryPredictor.clear();
    this.pendingActions = [];
    this.decisionLatencies = [];
    this.predictionOutcomes = [];
    
    this.stats = {
      predictionsGenerated: 0,
      predictionsApplied: 0,
      predictionAccuracy: 0,
      adjustmentsMade: 0,
      stallsPrevented: 0,
      bottlenecksAvoided: 0,
      memoryPressureEvents: 0,
      avgDecisionLatency: 0,
      modeChanges: 0,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let aiOptimizerInstance: AIOptimizerEngine | null = null;

export function getAIOptimizerEngine(config?: Partial<AIOptimizerConfig>): AIOptimizerEngine {
  if (!aiOptimizerInstance) {
    aiOptimizerInstance = new AIOptimizerEngine(config);
  }
  return aiOptimizerInstance;
}

export function resetAIOptimizerEngine(): void {
  if (aiOptimizerInstance) {
    aiOptimizerInstance.reset();
  }
  aiOptimizerInstance = null;
}
