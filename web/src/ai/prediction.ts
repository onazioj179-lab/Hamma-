/**
 * SPK V46 - AI Prediction Engine
 * Predicts optimal pipeline configuration
 * Uses ONLY metadata - never user content
 */

import type {
  AITelemetrySignals,
  AIOptimizationOutput,
  AIRealTimeAdjustment,
  IOBufferStrategy,
} from './types';

/**
 * AI Prediction Engine
 * Analyzes telemetry and predicts optimal settings
 */
export class PredictionEngine {
  private readonly constraints = {
    minChunkSize: 1 * 1024 * 1024,
    maxChunkSize: 64 * 1024 * 1024,
    minWorkers: 1,
    maxWorkers: 16,
    minLanes: 1,
    maxLanes: 32,
    maxMemoryPercent: 0.75,
    minConfidence: 0.5,
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

  /**
   * Generate optimization recommendations
   */
  predict(signals: AITelemetrySignals): AIOptimizationOutput {
    try {
      const reasoning: string[] = [];
      
      // Predict chunk size
      const chunkSize = this.predictChunkSize(signals, reasoning);
      
      // Predict worker count
      const workerCount = this.predictWorkerCount(signals, reasoning);
      
      // Predict concurrent lanes
      const concurrentLanes = this.predictConcurrentLanes(signals, workerCount, reasoning);
      
      // Predict WASM batch size
      const wasmBatchSize = this.predictWasmBatchSize(signals, reasoning);
      
      // Predict I/O buffer strategy
      const ioBufferStrategy = this.predictIOStrategy(signals, reasoning);
      
      // Predict compression mode
      const compressionMode = this.predictCompressionMode(signals, reasoning);
      
      // Predict total time
      const predictedTimeMs = this.predictTotalTime(signals, chunkSize, workerCount);
      
      // Calculate confidence
      const confidence = this.calculateConfidence(signals);

      return {
        chunkSize,
        concurrentLanes,
        workerCount,
        wasmBatchSize,
        ioBufferStrategy,
        compressionMode,
        predictedTimeMs,
        confidence,
        reasoning,
      };
    } catch (error) {
      console.warn('[AI] Prediction failed, using fallback:', error);
      return this.fallbackConfig;
    }
  }

  /**
   * Predict optimal chunk size
   */
  private predictChunkSize(signals: AITelemetrySignals, reasoning: string[]): number {
    let chunkSize = 4 * 1024 * 1024; // Default 4MB
    
    const { hardware, fileSize, fileType, history, memoryUsage, memoryLimit } = signals;
    
    // Adjust based on file size
    if (fileSize < 10 * 1024 * 1024) {
      // Small files: smaller chunks
      chunkSize = 1 * 1024 * 1024;
      reasoning.push('Small file detected: using 1MB chunks');
    } else if (fileSize > 1024 * 1024 * 1024) {
      // Large files: larger chunks for efficiency
      chunkSize = 16 * 1024 * 1024;
      reasoning.push('Large file detected: using 16MB chunks');
    }

    // Adjust based on memory pressure
    const memoryPercent = memoryUsage / memoryLimit;
    if (memoryPercent > 0.7) {
      chunkSize = Math.max(this.constraints.minChunkSize, chunkSize / 2);
      reasoning.push('High memory pressure: reducing chunk size');
    }

    // Adjust based on device type
    if (hardware.deviceType === 'mobile') {
      chunkSize = Math.min(chunkSize, 2 * 1024 * 1024);
      reasoning.push('Mobile device: limiting chunk size to 2MB');
    }

    // Use historical best if available
    if (history && history.bestChunkSize && history.totalJobs > 10) {
      const historicalWeight = Math.min(history.totalJobs / 100, 0.5);
      chunkSize = Math.round(chunkSize * (1 - historicalWeight) + history.bestChunkSize * historicalWeight);
      reasoning.push(`Blending with historical best (${history.bestChunkSize / 1024 / 1024}MB)`);
    }

    // Adjust for file type
    if (fileType.startsWith('video/') || fileType.startsWith('image/')) {
      // Media files: already compressed, use larger chunks
      chunkSize = Math.max(chunkSize, 8 * 1024 * 1024);
      reasoning.push('Media file: using larger chunks');
    } else if (fileType.startsWith('text/') || fileType.includes('json')) {
      // Text files: compress well, use moderate chunks
      chunkSize = Math.min(chunkSize, 4 * 1024 * 1024);
      reasoning.push('Text file: using moderate chunks');
    }

    // Clamp to constraints
    return Math.max(this.constraints.minChunkSize, Math.min(this.constraints.maxChunkSize, chunkSize));
  }

  /**
   * Predict optimal worker count
   */
  private predictWorkerCount(signals: AITelemetrySignals, reasoning: string[]): number {
    const { hardware, fileSize, wasmStallCount, history } = signals;
    
    // Start with CPU cores
    let workers = Math.max(1, Math.floor(hardware.cpuCores * 0.75));
    
    // Adjust based on device type
    switch (hardware.deviceType) {
      case 'mobile':
        workers = Math.min(workers, 2);
        reasoning.push('Mobile: limiting to 2 workers');
        break;
      case 'tablet':
        workers = Math.min(workers, 4);
        reasoning.push('Tablet: limiting to 4 workers');
        break;
      case 'laptop':
        workers = Math.min(workers, 6);
        break;
    }

    // Adjust based on file size
    if (fileSize < 10 * 1024 * 1024) {
      workers = Math.min(workers, 2);
      reasoning.push('Small file: reducing workers');
    }

    // Adjust based on stall events
    if (wasmStallCount > 5) {
      workers = Math.max(1, workers - 1);
      reasoning.push('WASM stalls detected: reducing workers');
    }

    // Use historical best if available
    if (history && history.bestWorkerCount && history.totalJobs > 10) {
      workers = Math.round((workers + history.bestWorkerCount) / 2);
      reasoning.push(`Blending with historical best (${history.bestWorkerCount} workers)`);
    }

    return Math.max(this.constraints.minWorkers, Math.min(this.constraints.maxWorkers, workers));
  }

  /**
   * Predict concurrent lanes
   */
  private predictConcurrentLanes(signals: AITelemetrySignals, workerCount: number, reasoning: string[]): number {
    const { hardware, workerLoadPercent } = signals;
    
    // Base on worker count
    let lanes = workerCount * 2;
    
    // Adjust based on worker load
    if (workerLoadPercent > 80) {
      lanes = Math.min(lanes, workerCount);
      reasoning.push('High worker load: matching lanes to workers');
    } else if (workerLoadPercent < 40) {
      lanes = Math.min(workerCount * 3, this.constraints.maxLanes);
      reasoning.push('Low worker load: increasing lanes');
    }

    // Adjust based on I/O tier
    if (hardware.ioSpeedTier < 5) {
      lanes = Math.min(lanes, workerCount);
      reasoning.push('Low I/O speed: limiting lanes');
    }

    return Math.max(this.constraints.minLanes, Math.min(this.constraints.maxLanes, lanes));
  }

  /**
   * Predict WASM batch size
   */
  private predictWasmBatchSize(signals: AITelemetrySignals, reasoning: string[]): number {
    const { hardware, avgChunkTimeMs, wasmStallCount } = signals;
    
    let batchSize = 8; // Default
    
    // Adjust based on chunk processing time
    if (avgChunkTimeMs > 100) {
      batchSize = 4;
      reasoning.push('Slow chunk processing: smaller batches');
    } else if (avgChunkTimeMs < 20) {
      batchSize = 16;
      reasoning.push('Fast chunk processing: larger batches');
    }

    // Adjust based on stalls
    if (wasmStallCount > 3) {
      batchSize = Math.max(2, batchSize / 2);
      reasoning.push('WASM stalls: reducing batch size');
    }

    // Adjust for SIMD
    if (hardware.simdSupported) {
      batchSize = Math.min(batchSize * 2, 32);
      reasoning.push('SIMD supported: increasing batch size');
    }

    return batchSize;
  }

  /**
   * Predict I/O buffer strategy
   */
  private predictIOStrategy(signals: AITelemetrySignals, reasoning: string[]): IOBufferStrategy {
    const { hardware, fileSize, memoryUsage, memoryLimit } = signals;
    
    const memoryPercent = memoryUsage / memoryLimit;
    
    // Memory-constrained
    if (memoryPercent > 0.7 || hardware.deviceType === 'mobile') {
      reasoning.push('Memory constrained: minimal I/O strategy');
      return 'minimal';
    }
    
    // Very large files
    if (fileSize > 10 * 1024 * 1024 * 1024) {
      reasoning.push('Very large file: streaming I/O strategy');
      return 'streaming';
    }
    
    // High-end device with headroom
    if (hardware.deviceType === 'desktop' && memoryPercent < 0.4) {
      reasoning.push('Desktop with memory headroom: aggressive I/O strategy');
      return 'aggressive';
    }
    
    reasoning.push('Using balanced I/O strategy');
    return 'balanced';
  }

  /**
   * Predict compression mode
   */
  private predictCompressionMode(signals: AITelemetrySignals, reasoning: string[]): 'fast' | 'strong' | 'auto' {
    const { fileType, fileSize, hardware, history } = signals;
    
    // Check file type history
    if (history?.fileTypePerformance) {
      const typeStats = history.fileTypePerformance.get(fileType);
      if (typeStats && typeStats.sampleCount > 5) {
        reasoning.push(`Using historical best mode for ${fileType}: ${typeStats.bestMode}`);
        return typeStats.bestMode;
      }
    }

    // Already-compressed media
    if (
      fileType.startsWith('video/') ||
      fileType.startsWith('audio/') ||
      fileType.includes('zip') ||
      fileType.includes('rar') ||
      fileType.includes('7z')
    ) {
      reasoning.push('Pre-compressed content: using fast mode');
      return 'fast';
    }

    // Text and documents
    if (fileType.startsWith('text/') || fileType.includes('json') || fileType.includes('xml')) {
      reasoning.push('Text content: using strong mode');
      return 'strong';
    }

    // Large files on weak devices
    if (fileSize > 500 * 1024 * 1024 && hardware.cpuSpeedTier < 5) {
      reasoning.push('Large file on slower device: using fast mode');
      return 'fast';
    }

    // Default to auto
    reasoning.push('Using auto mode');
    return 'auto';
  }

  /**
   * Predict total job time
   */
  private predictTotalTime(signals: AITelemetrySignals, chunkSize: number, workerCount: number): number {
    const { fileSize, avgChunkTimeMs, throughputBps, history } = signals;
    
    if (fileSize === 0) return 0;
    
    // Calculate chunks needed
    const chunkCount = Math.ceil(fileSize / chunkSize);
    
    // Estimate based on chunk time if available
    if (avgChunkTimeMs > 0) {
      const parallelChunks = Math.ceil(chunkCount / workerCount);
      return parallelChunks * avgChunkTimeMs;
    }
    
    // Estimate based on throughput if available
    if (throughputBps > 0) {
      return (fileSize / throughputBps) * 1000;
    }
    
    // Use historical average if available
    if (history && history.avgThroughputMBps > 0) {
      return (fileSize / (history.avgThroughputMBps * 1024 * 1024)) * 1000;
    }
    
    // Rough estimate: 50MB/s
    return (fileSize / (50 * 1024 * 1024)) * 1000;
  }

  /**
   * Calculate prediction confidence
   */
  private calculateConfidence(signals: AITelemetrySignals): number {
    let confidence = 0.5; // Base confidence
    
    // Boost for hardware detection
    if (signals.hardware.cpuCores > 0) confidence += 0.1;
    if (signals.hardware.simdSupported !== undefined) confidence += 0.05;
    
    // Boost for telemetry data
    if (signals.avgChunkTimeMs > 0) confidence += 0.1;
    if (signals.throughputBps > 0) confidence += 0.1;
    
    // Boost for history
    if (signals.history) {
      if (signals.history.totalJobs > 10) confidence += 0.1;
      if (signals.history.totalJobs > 50) confidence += 0.05;
    }
    
    return Math.min(1, confidence);
  }

  /**
   * Generate real-time adjustment
   */
  generateAdjustment(currentSignals: AITelemetrySignals, currentConfig: AIOptimizationOutput): AIRealTimeAdjustment | null {
    const { memoryUsage, memoryLimit, wasmStallCount, workerLoadPercent, throughputBps } = currentSignals;
    
    // Check memory pressure
    const memoryPercent = memoryUsage / memoryLimit;
    if (memoryPercent > 0.85) {
      return {
        type: 'chunk-size',
        newValue: Math.max(this.constraints.minChunkSize, currentConfig.chunkSize / 2),
        urgency: 0.9,
        reason: 'Critical memory pressure detected',
      };
    }

    // Check for WASM idle
    if (wasmStallCount === 0 && workerLoadPercent < 30 && throughputBps > 0) {
      return {
        type: 'concurrency',
        newValue: Math.min(this.constraints.maxLanes, currentConfig.concurrentLanes + 2),
        urgency: 0.4,
        reason: 'WASM underutilized, increasing concurrency',
      };
    }

    // Check for overload
    if (wasmStallCount > 5 && workerLoadPercent > 90) {
      return {
        type: 'worker-count',
        newValue: Math.max(this.constraints.minWorkers, currentConfig.workerCount - 1),
        urgency: 0.7,
        reason: 'Worker overload detected',
      };
    }

    return null;
  }
}

// Singleton instance
let engineInstance: PredictionEngine | null = null;

/**
 * Get prediction engine instance
 */
export function getPredictionEngine(): PredictionEngine {
  if (!engineInstance) {
    engineInstance = new PredictionEngine();
  }
  return engineInstance;
}
