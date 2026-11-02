/**
 * SPK V46 - Local Training Data Store
 * Private, local-only storage for AI learning
 * Never uploaded - deletable by user
 */

import type {
  LocalTrainingData,
  TrainingSample,
  AggregatedStats,
  AITelemetrySignals,
  AIOptimizationOutput,
  JobOutcome,
  HardwareProfile,
  HistoricalPerformance,
  FileTypeStats,
} from './types';

const STORAGE_KEY = 'spk-ai-training-data';
const STORAGE_VERSION = 1;
const MAX_SAMPLES = 500;

/**
 * Local training data store
 * All data is private and local only
 */
export class TrainingDataStore {
  private data: LocalTrainingData | null = null;
  private initialized = false;

  /**
   * Initialize store
   */
  async initialize(hardwareProfile: HardwareProfile): Promise<void> {
    if (this.initialized) return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      
      if (stored) {
        const parsed = JSON.parse(stored) as LocalTrainingData;
        
        // Check version compatibility
        if (parsed.version === STORAGE_VERSION) {
          this.data = parsed;
          this.data.hardwareProfile = hardwareProfile; // Update hardware profile
        } else {
          // Version mismatch, reset data
          this.data = this.createEmptyData(hardwareProfile);
        }
      } else {
        this.data = this.createEmptyData(hardwareProfile);
      }
      
      this.initialized = true;
    } catch (error) {
      console.warn('[AI Training] Failed to load training data:', error);
      this.data = this.createEmptyData(hardwareProfile);
      this.initialized = true;
    }
  }

  /**
   * Create empty data structure
   */
  private createEmptyData(hardwareProfile: HardwareProfile): LocalTrainingData {
    return {
      version: STORAGE_VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      samples: [],
      hardwareProfile,
      aggregatedStats: {
        totalJobs: 0,
        totalBytesProcessed: 0,
        avgCompressionRatio: 1,
        avgThroughputMBps: 0,
        successRate: 1,
        bestSettings: {},
      },
    };
  }

  /**
   * Record a training sample from completed job
   */
  recordSample(
    input: AITelemetrySignals,
    config: AIOptimizationOutput,
    outcome: JobOutcome
  ): void {
    if (!this.data) return;

    const sample: TrainingSample = {
      id: `sample-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      input,
      config,
      outcome,
    };

    // Add sample
    this.data.samples.push(sample);

    // Trim if over limit (keep most recent)
    if (this.data.samples.length > MAX_SAMPLES) {
      this.data.samples = this.data.samples.slice(-MAX_SAMPLES);
    }

    // Update aggregated stats
    this.updateAggregatedStats(outcome);

    // Update timestamp
    this.data.updatedAt = Date.now();

    // Persist
    this.persist();
  }

  /**
   * Update aggregated statistics
   */
  private updateAggregatedStats(outcome: JobOutcome): void {
    if (!this.data) return;

    const stats = this.data.aggregatedStats;
    const n = stats.totalJobs;

    // Incremental average updates
    stats.totalJobs++;
    stats.avgCompressionRatio = (stats.avgCompressionRatio * n + outcome.actualRatio) / (n + 1);
    stats.avgThroughputMBps = (stats.avgThroughputMBps * n + outcome.actualThroughputMBps) / (n + 1);
    stats.successRate = (stats.successRate * n + (outcome.success ? 1 : 0)) / (n + 1);
    stats.totalBytesProcessed += outcome.actualThroughputMBps * outcome.actualDurationMs / 1000 * 1024 * 1024;

    // Update best settings if this job was fast and successful
    if (outcome.success && outcome.actualThroughputMBps > stats.avgThroughputMBps * 1.2) {
      const recentSample = this.data.samples[this.data.samples.length - 1];
      if (recentSample) {
        stats.bestSettings = {
          chunkSize: recentSample.config.chunkSize,
          workerCount: recentSample.config.workerCount,
          concurrentLanes: recentSample.config.concurrentLanes,
          compressionMode: recentSample.config.compressionMode,
        };
      }
    }
  }

  /**
   * Get historical performance data
   */
  getHistoricalPerformance(): HistoricalPerformance | undefined {
    if (!this.data || this.data.samples.length === 0) {
      return undefined;
    }

    const stats = this.data.aggregatedStats;
    
    // Find best chunk size and worker count from successful samples
    const successfulSamples = this.data.samples.filter(s => s.outcome.success);
    
    let bestChunkSize = 4 * 1024 * 1024;
    let bestWorkerCount = 4;
    
    if (successfulSamples.length > 0) {
      // Sort by throughput and take top performers
      const topPerformers = successfulSamples
        .sort((a, b) => b.outcome.actualThroughputMBps - a.outcome.actualThroughputMBps)
        .slice(0, Math.min(10, successfulSamples.length));
      
      // Mode of chunk sizes
      const chunkCounts = new Map<number, number>();
      const workerCounts = new Map<number, number>();
      
      topPerformers.forEach(s => {
        chunkCounts.set(s.config.chunkSize, (chunkCounts.get(s.config.chunkSize) || 0) + 1);
        workerCounts.set(s.config.workerCount, (workerCounts.get(s.config.workerCount) || 0) + 1);
      });
      
      let maxCount = 0;
      chunkCounts.forEach((count, size) => {
        if (count > maxCount) {
          maxCount = count;
          bestChunkSize = size;
        }
      });
      
      maxCount = 0;
      workerCounts.forEach((count, workers) => {
        if (count > maxCount) {
          maxCount = count;
          bestWorkerCount = workers;
        }
      });
    }

    // Build file type performance map
    const fileTypePerformance = this.buildFileTypePerformance();

    return {
      avgCompressionRatio: stats.avgCompressionRatio,
      avgThroughputMBps: stats.avgThroughputMBps,
      bestChunkSize,
      bestWorkerCount,
      totalJobs: stats.totalJobs,
      successRate: stats.successRate,
      fileTypePerformance,
    };
  }

  /**
   * Build file type performance map
   */
  private buildFileTypePerformance(): Map<string, FileTypeStats> {
    if (!this.data) return new Map();

    const typeMap = new Map<string, Array<{
      ratio: number;
      chunkSize: number;
      mode: 'fast' | 'strong' | 'auto';
      speedMBps: number;
    }>>();

    // Group samples by file type
    this.data.samples.forEach(sample => {
      if (!sample.outcome.success) return;
      
      const type = sample.input.fileType;
      if (!typeMap.has(type)) {
        typeMap.set(type, []);
      }
      
      typeMap.get(type)!.push({
        ratio: sample.outcome.actualRatio,
        chunkSize: sample.config.chunkSize,
        mode: sample.config.compressionMode,
        speedMBps: sample.outcome.actualThroughputMBps,
      });
    });

    // Convert to FileTypeStats
    const result = new Map<string, FileTypeStats>();
    
    typeMap.forEach((samples, fileType) => {
      if (samples.length === 0) return;
      
      const avgRatio = samples.reduce((a, s) => a + s.ratio, 0) / samples.length;
      const avgSpeedMBps = samples.reduce((a, s) => a + s.speedMBps, 0) / samples.length;
      
      // Find best settings
      const chunkCounts = new Map<number, number>();
      const modeCounts = new Map<string, number>();
      
      samples.forEach(s => {
        chunkCounts.set(s.chunkSize, (chunkCounts.get(s.chunkSize) || 0) + 1);
        modeCounts.set(s.mode, (modeCounts.get(s.mode) || 0) + 1);
      });
      
      let bestChunkSize = 4 * 1024 * 1024;
      let maxCount = 0;
      chunkCounts.forEach((count, size) => {
        if (count > maxCount) {
          maxCount = count;
          bestChunkSize = size;
        }
      });
      
      let bestMode: 'fast' | 'strong' | 'auto' = 'auto';
      maxCount = 0;
      modeCounts.forEach((count, mode) => {
        if (count > maxCount) {
          maxCount = count;
          bestMode = mode as 'fast' | 'strong' | 'auto';
        }
      });

      result.set(fileType, {
        fileType,
        sampleCount: samples.length,
        avgRatio,
        bestChunkSize,
        bestMode,
        avgSpeedMBps,
      });
    });

    return result;
  }

  /**
   * Persist data to local storage
   */
  private persist(): void {
    if (!this.data) return;
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (error) {
      console.warn('[AI Training] Failed to persist training data:', error);
    }
  }

  /**
   * Get aggregated stats
   */
  getStats(): AggregatedStats | null {
    return this.data?.aggregatedStats || null;
  }

  /**
   * Get sample count
   */
  getSampleCount(): number {
    return this.data?.samples.length || 0;
  }

  /**
   * Reset all training data
   * User-triggered action
   */
  reset(hardwareProfile: HardwareProfile): void {
    this.data = this.createEmptyData(hardwareProfile);
    this.persist();
    console.log('[AI Training] Training data reset');
  }

  /**
   * Export training data (for debugging)
   */
  export(): LocalTrainingData | null {
    return this.data;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let storeInstance: TrainingDataStore | null = null;

/**
 * Get training data store instance
 */
export function getTrainingDataStore(): TrainingDataStore {
  if (!storeInstance) {
    storeInstance = new TrainingDataStore();
  }
  return storeInstance;
}
