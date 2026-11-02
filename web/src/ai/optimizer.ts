/**
 * SPK V46 - AI Optimizer
 * Main AI optimization controller
 * Coordinates telemetry, prediction, and training
 */

import type {
  AIConfig,
  AIOptimizerState,
  AIOptimizationOutput,
  AIRealTimeAdjustment,
  JobOutcome,
} from './types';
import { TelemetryCollector, getTelemetryCollector } from './telemetry';
import { PredictionEngine, getPredictionEngine } from './prediction';
import { TrainingDataStore, getTrainingDataStore } from './training';

/**
 * AI Optimizer - Main controller
 * Sits between Frontend/API and Coordinator
 * Never blocks the pipeline - only advises
 */
export class AIOptimizer {
  private config: AIConfig = {
    enabled: true,
    learningEnabled: true,
    aggressiveness: 0.5,
    minConfidence: 0.7,
    maxMemoryBudget: 50 * 1024 * 1024,
    realTimeAdjustments: true,
  };

  private fallbackConfig: AIOptimizationOutput = {
    chunkSize: 4 * 1024 * 1024,
    concurrentLanes: 4,
    workerCount: 4,
    wasmBatchSize: 8,
    ioBufferStrategy: 'balanced',
    compressionMode: 'auto',
    predictedTimeMs: 0,
    confidence: 0,
    reasoning: ['Fallback: Using default configuration'],
  };

  private state: AIOptimizerState = {
    enabled: true,
    status: 'idle',
    currentRecommendations: null,
    pendingAdjustments: [],
    lastUpdateMs: 0,
    optimizationsApplied: 0,
    estimatedGainPercent: 0,
  };

  private telemetry: TelemetryCollector;
  private prediction: PredictionEngine;
  private training: TrainingDataStore;
  private initialized = false;

  constructor() {
    this.telemetry = getTelemetryCollector();
    this.prediction = getPredictionEngine();
    this.training = getTrainingDataStore();
  }

  /**
   * Initialize AI optimizer
   */
  async initialize(config?: Partial<AIConfig>): Promise<void> {
    if (this.initialized) return;

    // Merge config
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.state.enabled = this.config.enabled;

    if (!this.config.enabled) {
      this.state.status = 'disabled';
      this.initialized = true;
      return;
    }

    try {
      // Initialize telemetry
      await this.telemetry.initialize();

      // Initialize training store
      const hardwareProfile = this.telemetry.getHardwareProfile();
      if (hardwareProfile) {
        await this.training.initialize(hardwareProfile);
      }

      this.state.status = 'idle';
      this.initialized = true;
      
      console.log('[AI] Optimizer initialized');
    } catch (error) {
      console.warn('[AI] Initialization failed, falling back to defaults:', error);
      this.state.status = 'error';
      this.initialized = true;
    }
  }

  /**
   * Get optimization recommendations for a job
   */
  getRecommendations(
    fileType: string,
    fileSize: number,
    fileCount: number
  ): AIOptimizationOutput {
    if (!this.config.enabled || this.state.status === 'error') {
      return this.fallbackConfig;
    }

    try {
      this.state.status = 'analyzing';

      // Update telemetry
      this.telemetry.updateFileInfo(fileType, fileSize);
      this.telemetry.updateArchiveInfo(fileCount, Math.ceil(fileSize / (4 * 1024 * 1024)));

      // Get historical performance if learning is enabled
      const history = this.config.learningEnabled
        ? this.training.getHistoricalPerformance()
        : undefined;

      // Get current signals
      const signals = this.telemetry.getSignals(history);

      // Generate predictions
      const recommendations = this.prediction.predict(signals);

      // Check confidence threshold
      if (recommendations.confidence < this.config.minConfidence) {
        console.log('[AI] Low confidence, using balanced defaults');
        return this.fallbackConfig;
      }

      this.state.currentRecommendations = recommendations;
      this.state.lastUpdateMs = Date.now();
      this.state.status = 'optimizing';

      return recommendations;
    } catch (error) {
      console.warn('[AI] Recommendation failed:', error);
      return this.fallbackConfig;
    }
  }

  /**
   * Start monitoring a job
   */
  startJobMonitoring(): void {
    this.telemetry.reset();
    this.state.status = 'monitoring';
    this.state.pendingAdjustments = [];
  }

  /**
   * Update telemetry during job
   */
  updateTelemetry(update: {
    chunkTimeMs?: number;
    workerLoadPercent?: number;
    wasmStall?: boolean;
    memoryUsage?: number;
    memoryLimit?: number;
    throughputBps?: number;
  }): void {
    if (!this.config.enabled) return;

    if (update.chunkTimeMs !== undefined) {
      this.telemetry.recordChunkTime(update.chunkTimeMs);
    }
    if (update.workerLoadPercent !== undefined) {
      this.telemetry.updateWorkerLoad(update.workerLoadPercent);
    }
    if (update.wasmStall) {
      this.telemetry.recordWasmStall();
    }
    if (update.memoryUsage !== undefined && update.memoryLimit !== undefined) {
      this.telemetry.updateMemoryUsage(update.memoryUsage, update.memoryLimit);
    }
    if (update.throughputBps !== undefined) {
      this.telemetry.updateThroughput(update.throughputBps);
    }

    // Check for real-time adjustments
    if (this.config.realTimeAdjustments && this.state.currentRecommendations) {
      this.checkForAdjustments();
    }
  }

  /**
   * Check if real-time adjustment is needed
   */
  private checkForAdjustments(): void {
    if (!this.state.currentRecommendations) return;

    const signals = this.telemetry.getSignals();
    const adjustment = this.prediction.generateAdjustment(
      signals,
      this.state.currentRecommendations
    );

    if (adjustment && adjustment.urgency >= this.config.aggressiveness) {
      this.state.pendingAdjustments.push(adjustment);
    }
  }

  /**
   * Get pending adjustments
   */
  getPendingAdjustments(): AIRealTimeAdjustment[] {
    const adjustments = [...this.state.pendingAdjustments];
    this.state.pendingAdjustments = [];
    return adjustments;
  }

  /**
   * Apply an adjustment
   */
  applyAdjustment(adjustment: AIRealTimeAdjustment): void {
    this.state.optimizationsApplied++;
    console.log(`[AI] Applied adjustment: ${adjustment.type} = ${adjustment.newValue}`);
  }

  /**
   * Complete job and record outcome
   */
  completeJob(outcome: {
    success: boolean;
    totalBytes: number;
    durationMs: number;
    compressionRatio: number;
    peakMemory: number;
    errorCount: number;
    stallCount: number;
  }): void {
    if (!this.config.enabled || !this.config.learningEnabled) {
      this.state.status = 'idle';
      return;
    }

    try {
      const signals = this.telemetry.getSignals();
      const config = this.state.currentRecommendations || this.fallbackConfig;

      const jobOutcome: JobOutcome = {
        success: outcome.success,
        actualDurationMs: outcome.durationMs,
        actualThroughputMBps: outcome.totalBytes / outcome.durationMs / 1024,
        actualRatio: outcome.compressionRatio,
        peakMemoryUsage: outcome.peakMemory,
        errorCount: outcome.errorCount,
        workerStallCount: outcome.stallCount,
      };

      // Record training sample
      this.training.recordSample(signals, config, jobOutcome);

      // Calculate estimated gain
      const stats = this.training.getStats();
      if (stats && stats.totalJobs > 1) {
        const currentThroughput = jobOutcome.actualThroughputMBps;
        const avgThroughput = stats.avgThroughputMBps;
        this.state.estimatedGainPercent = ((currentThroughput - avgThroughput) / avgThroughput) * 100;
      }

      console.log('[AI] Job recorded for training');
    } catch (error) {
      console.warn('[AI] Failed to record job:', error);
    }

    this.state.status = 'idle';
    this.state.currentRecommendations = null;
  }

  /**
   * Get current state
   */
  getState(): AIOptimizerState {
    return { ...this.state };
  }

  /**
   * Get configuration
   */
  getConfig(): AIConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AIConfig>): void {
    this.config = { ...this.config, ...config };
    this.state.enabled = this.config.enabled;
    
    if (!this.config.enabled) {
      this.state.status = 'disabled';
    } else if (this.state.status === 'disabled') {
      this.state.status = 'idle';
    }
  }

  /**
   * Reset optimization data
   * User-triggered action
   */
  resetOptimizationData(): void {
    const hardwareProfile = this.telemetry.getHardwareProfile();
    if (hardwareProfile) {
      this.training.reset(hardwareProfile);
    }
    this.state.estimatedGainPercent = 0;
    this.state.optimizationsApplied = 0;
    console.log('[AI] Optimization data reset');
  }

  /**
   * Get training statistics
   */
  getTrainingStats(): {
    sampleCount: number;
    totalJobs: number;
    avgThroughputMBps: number;
    successRate: number;
  } | null {
    const stats = this.training.getStats();
    if (!stats) return null;

    return {
      sampleCount: this.training.getSampleCount(),
      totalJobs: stats.totalJobs,
      avgThroughputMBps: stats.avgThroughputMBps,
      successRate: stats.successRate,
    };
  }

  /**
   * Check if optimizer is ready
   */
  isReady(): boolean {
    return this.initialized && this.config.enabled && this.state.status !== 'error';
  }
}

// Singleton instance
let optimizerInstance: AIOptimizer | null = null;

/**
 * Get AI optimizer instance
 */
export function getAIOptimizer(): AIOptimizer {
  if (!optimizerInstance) {
    optimizerInstance = new AIOptimizer();
  }
  return optimizerInstance;
}
