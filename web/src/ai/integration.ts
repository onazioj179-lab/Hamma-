/**
 * SPK V46 - AI Coordinator Integration
 * Integration layer between AI optimizer and coordinator
 */

import type {
  AIOptimizationOutput,
  AIRealTimeAdjustment,
  AIConfig,
} from './types';
import { getAIOptimizer, AIOptimizer } from './optimizer';

/**
 * Coordinator integration for AI optimizer
 * Applies AI recommendations to pipeline configuration
 */
export class AICoordinatorIntegration {
  private optimizer: AIOptimizer;
  private currentConfig: AIOptimizationOutput | null = null;
  private adjustmentQueue: AIRealTimeAdjustment[] = [];
  private onConfigChange?: (config: AIOptimizationOutput) => void;

  constructor() {
    this.optimizer = getAIOptimizer();
  }

  /**
   * Initialize integration
   */
  async initialize(aiConfig?: Partial<AIConfig>): Promise<void> {
    await this.optimizer.initialize(aiConfig);
  }

  /**
   * Set callback for config changes
   */
  onConfigUpdate(callback: (config: AIOptimizationOutput) => void): void {
    this.onConfigChange = callback;
  }

  /**
   * Get optimized configuration for a job
   */
  getOptimizedConfig(
    files: Array<{ type: string; size: number }>
  ): AIOptimizationOutput {
    // Aggregate file info
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const primaryType = this.getPrimaryFileType(files);
    const fileCount = files.length;

    // Get AI recommendations
    const config = this.optimizer.getRecommendations(primaryType, totalSize, fileCount);
    
    this.currentConfig = config;
    return config;
  }

  /**
   * Determine primary file type from files
   */
  private getPrimaryFileType(files: Array<{ type: string; size: number }>): string {
    if (files.length === 0) return 'application/octet-stream';
    if (files.length === 1) return files[0].type || 'application/octet-stream';

    // Find most common type weighted by size
    const typeWeights = new Map<string, number>();
    
    files.forEach(f => {
      const type = f.type || 'application/octet-stream';
      typeWeights.set(type, (typeWeights.get(type) || 0) + f.size);
    });

    let primaryType = 'application/octet-stream';
    let maxWeight = 0;
    
    typeWeights.forEach((weight, type) => {
      if (weight > maxWeight) {
        maxWeight = weight;
        primaryType = type;
      }
    });

    return primaryType;
  }

  /**
   * Start job monitoring
   */
  startJob(): void {
    this.optimizer.startJobMonitoring();
    this.adjustmentQueue = [];
  }

  /**
   * Report progress from coordinator
   */
  reportProgress(metrics: {
    chunkTimeMs?: number;
    workerLoadPercent?: number;
    wasmStall?: boolean;
    memoryUsage?: number;
    memoryLimit?: number;
    throughputBps?: number;
  }): void {
    this.optimizer.updateTelemetry(metrics);

    // Check for pending adjustments
    const adjustments = this.optimizer.getPendingAdjustments();
    if (adjustments.length > 0) {
      this.adjustmentQueue.push(...adjustments);
      this.processAdjustments();
    }
  }

  /**
   * Process pending adjustments
   */
  private processAdjustments(): void {
    if (!this.currentConfig || this.adjustmentQueue.length === 0) return;

    // Process highest urgency adjustment
    this.adjustmentQueue.sort((a, b) => b.urgency - a.urgency);
    const adjustment = this.adjustmentQueue.shift();
    
    if (!adjustment) return;

    // Apply adjustment to current config
    const newConfig = this.applyAdjustment(this.currentConfig, adjustment);
    
    if (newConfig) {
      this.currentConfig = newConfig;
      this.optimizer.applyAdjustment(adjustment);
      
      if (this.onConfigChange) {
        this.onConfigChange(newConfig);
      }
    }
  }

  /**
   * Apply adjustment to config
   */
  private applyAdjustment(
    config: AIOptimizationOutput,
    adjustment: AIRealTimeAdjustment
  ): AIOptimizationOutput | null {
    const newConfig = { ...config };

    switch (adjustment.type) {
      case 'chunk-size':
        newConfig.chunkSize = adjustment.newValue as number;
        break;
      case 'worker-count':
        newConfig.workerCount = adjustment.newValue as number;
        break;
      case 'concurrency':
        newConfig.concurrentLanes = adjustment.newValue as number;
        break;
      case 'batch-size':
        newConfig.wasmBatchSize = adjustment.newValue as number;
        break;
      case 'memory-limit':
        // Memory limit is handled externally
        return null;
      case 'mode-switch':
        newConfig.compressionMode = adjustment.newValue as 'fast' | 'strong' | 'auto';
        break;
      default:
        return null;
    }

    newConfig.reasoning = [
      ...(config.reasoning || []),
      `[Adjusted] ${adjustment.reason}`,
    ];

    return newConfig;
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
    this.optimizer.completeJob(outcome);
    this.currentConfig = null;
    this.adjustmentQueue = [];
  }

  /**
   * Get current AI status for UI
   */
  getStatus(): {
    enabled: boolean;
    status: string;
    optimizing: boolean;
    confidence: number;
    estimatedGainPercent: number;
  } {
    const state = this.optimizer.getState();
    
    return {
      enabled: state.enabled,
      status: state.status,
      optimizing: state.status === 'optimizing' || state.status === 'monitoring',
      confidence: state.currentRecommendations?.confidence || 0,
      estimatedGainPercent: state.estimatedGainPercent,
    };
  }

  /**
   * Check if AI optimization is available
   */
  isAvailable(): boolean {
    return this.optimizer.isReady();
  }

  /**
   * Enable/disable AI optimization
   */
  setEnabled(enabled: boolean): void {
    this.optimizer.updateConfig({ enabled });
  }

  /**
   * Reset optimization data
   */
  resetData(): void {
    this.optimizer.resetOptimizationData();
  }

  /**
   * Get training statistics for UI
   */
  getTrainingStats(): {
    jobsAnalyzed: number;
    avgSpeedMBps: number;
    successRate: number;
  } | null {
    const stats = this.optimizer.getTrainingStats();
    if (!stats) return null;

    return {
      jobsAnalyzed: stats.totalJobs,
      avgSpeedMBps: Math.round(stats.avgThroughputMBps * 10) / 10,
      successRate: Math.round(stats.successRate * 100),
    };
  }
}

// Singleton instance
let integrationInstance: AICoordinatorIntegration | null = null;

/**
 * Get AI coordinator integration instance
 */
export function getAIIntegration(): AICoordinatorIntegration {
  if (!integrationInstance) {
    integrationInstance = new AICoordinatorIntegration();
  }
  return integrationInstance;
}
