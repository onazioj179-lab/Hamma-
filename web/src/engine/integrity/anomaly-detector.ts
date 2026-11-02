/**
 * SPK AI-Powered Post-Compression Integrity Verification Engine - Anomaly Detector
 * Creator: OJ Treasure Onazi
 * 
 * AI-powered anomaly detection using metadata patterns, statistical analysis,
 * and predictive models to identify corrupt or suspicious chunks.
 */

import {
  AnomalyType,
  ChunkAnomalyScore,
  ChunkStatistics,
  ArchiveStatistics,
  AIAnalysisResult,
  AIVerificationConfig,
  DEFAULT_AI_VERIFICATION_CONFIG,
  VerificationAnomaly,
  IntegrityEvent,
  IntegrityEventHandler,
  MB,
} from '../core/types/integrity';

// ============================================================================
// PATTERN TYPES
// ============================================================================

export interface AnomalyPattern {
  name: string;
  description: string;
  weight: number;
  detector: (chunk: ChunkStatistics, archive: ArchiveStatistics) => number;
}

export interface HistoricalPattern {
  avgRatio: number;
  avgTime: number;
  ratioTrend: number[];
  timeTrend: number[];
  errorRate: number;
  stallRate: number;
}

// ============================================================================
// ANOMALY DETECTOR CONFIG
// ============================================================================

export interface AnomalyDetectorConfig extends AIVerificationConfig {
  /** Ratio deviation threshold for suspicion */
  ratioDeviationThreshold: number;
  
  /** Time deviation threshold (standard deviations) */
  timeDeviationThreshold: number;
  
  /** Retry count threshold for suspicion */
  retryThreshold: number;
  
  /** Stall count threshold */
  stallThreshold: number;
  
  /** Memory pressure threshold */
  memoryPressureThreshold: number;
  
  /** WASM error threshold */
  wasmErrorThreshold: number;
  
  /** Pattern history window size */
  patternWindowSize: number;
}

export const DEFAULT_ANOMALY_DETECTOR_CONFIG: AnomalyDetectorConfig = {
  ...DEFAULT_AI_VERIFICATION_CONFIG,
  ratioDeviationThreshold: 0.5,
  timeDeviationThreshold: 3.0,
  retryThreshold: 3,
  stallThreshold: 2,
  memoryPressureThreshold: 0.8,
  wasmErrorThreshold: 2,
  patternWindowSize: 50,
};

// ============================================================================
// ANOMALY DETECTOR
// ============================================================================

export class AIAnomalyDetector {
  private config: AnomalyDetectorConfig;
  private eventHandlers: Set<IntegrityEventHandler> = new Set();
  private patterns: AnomalyPattern[] = [];
  private historicalData: HistoricalPattern | null = null;

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    this.config = { ...DEFAULT_ANOMALY_DETECTOR_CONFIG, ...config };
    this.initializePatterns();
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: IntegrityEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: IntegrityEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: IntegrityEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // PATTERN INITIALIZATION
  // ==========================================================================

  private initializePatterns(): void {
    this.patterns = [
      // Pattern 1: Compression ratio anomaly
      {
        name: 'ratio-anomaly',
        description: 'Unusual compression ratio compared to average',
        weight: 0.25,
        detector: (chunk, archive) => {
          if (archive.avgCompressionRatio === 0) return 0;
          const deviation = Math.abs(chunk.compressionRatio - archive.avgCompressionRatio);
          const relativeDeviation = deviation / archive.avgCompressionRatio;
          return Math.min(1, relativeDeviation / this.config.ratioDeviationThreshold);
        },
      },

      // Pattern 2: Processing time anomaly
      {
        name: 'time-anomaly',
        description: 'Abnormal processing time',
        weight: 0.20,
        detector: (chunk, archive) => {
          if (archive.stdDevTime === 0) return 0;
          const zScore = Math.abs(chunk.processingTime - archive.avgProcessingTime) / archive.stdDevTime;
          return Math.min(1, zScore / this.config.timeDeviationThreshold);
        },
      },

      // Pattern 3: Retry suspicion
      {
        name: 'retry-anomaly',
        description: 'High worker retry count',
        weight: 0.20,
        detector: (chunk) => {
          return Math.min(1, chunk.workerRetries / this.config.retryThreshold);
        },
      },

      // Pattern 4: Stall suspicion
      {
        name: 'stall-anomaly',
        description: 'Worker stalls detected',
        weight: 0.15,
        detector: (chunk) => {
          return Math.min(1, chunk.workerStalls / this.config.stallThreshold);
        },
      },

      // Pattern 5: Memory pressure
      {
        name: 'memory-pressure',
        description: 'High memory pressure during compression',
        weight: 0.10,
        detector: (chunk) => {
          return chunk.memoryPressure > this.config.memoryPressureThreshold
            ? (chunk.memoryPressure - this.config.memoryPressureThreshold) / (1 - this.config.memoryPressureThreshold)
            : 0;
        },
      },

      // Pattern 6: WASM instability
      {
        name: 'wasm-instability',
        description: 'WASM errors during compression',
        weight: 0.10,
        detector: (chunk) => {
          return Math.min(1, chunk.wasmErrors / this.config.wasmErrorThreshold);
        },
      },
    ];
  }

  // ==========================================================================
  // MAIN ANALYSIS
  // ==========================================================================

  async analyzeArchive(archive: ArchiveStatistics): Promise<AIAnalysisResult> {
    const startTime = performance.now();
    
    // Compute baseline statistics
    this.computeBaseline(archive);

    // Score all chunks
    const scores: ChunkAnomalyScore[] = [];
    for (const chunk of archive.chunkStats) {
      const score = this.scoreChunk(chunk, archive);
      scores.push(score);
    }

    // Identify flagged and safe chunks
    const flaggedChunks: number[] = [];
    const safeChunks: number[] = [];

    for (const score of scores) {
      if (score.score >= this.config.anomalyThreshold) {
        flaggedChunks.push(score.chunkIndex);
      } else if (score.score <= this.config.lowRiskThreshold) {
        safeChunks.push(score.chunkIndex);
      }
    }

    // Calculate overall health score
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    const avgScore = scores.length > 0 ? totalScore / scores.length : 0;
    const healthScore = 1 - avgScore;

    // Calculate failure probability
    const highRiskCount = scores.filter(s => s.score >= 0.7).length;
    const failureProbability = archive.totalChunks > 0
      ? highRiskCount / archive.totalChunks
      : 0;

    // Determine verification strategy
    let strategy: 'full' | 'targeted' | 'lightweight';
    if (failureProbability > 0.1 || healthScore < 0.7) {
      strategy = 'full';
    } else if (flaggedChunks.length > archive.totalChunks * 0.05) {
      strategy = 'targeted';
    } else {
      strategy = 'lightweight';
    }

    // Estimate verification time
    const baseTimePerChunk = 10; // ms
    const fullTime = archive.totalChunks * baseTimePerChunk;
    const targetedTime = flaggedChunks.length * baseTimePerChunk * 2 + 
                         safeChunks.length * baseTimePerChunk * 0.1;
    const lightweightTime = archive.totalChunks * baseTimePerChunk * 0.2;

    const estimatedTime = strategy === 'full' ? fullTime
                        : strategy === 'targeted' ? targetedTime
                        : lightweightTime;

    // Confidence based on sample size and pattern consistency
    const confidence = this.calculateConfidence(scores, archive);

    const analysisTime = performance.now() - startTime;

    return {
      healthScore,
      failureProbability,
      flaggedChunks,
      safeChunks,
      predictions: scores,
      strategy,
      estimatedTime: estimatedTime + analysisTime,
      confidence,
    };
  }

  // ==========================================================================
  // CHUNK SCORING
  // ==========================================================================

  scoreChunk(chunk: ChunkStatistics, archive: ArchiveStatistics): ChunkAnomalyScore {
    const factors = {
      ratioSuspicion: 0,
      sizeSuspicion: 0,
      timingSuspicion: 0,
      retrySuspicion: 0,
      patternSuspicion: 0,
    };

    // Apply each pattern
    let weightedScore = 0;
    let totalWeight = 0;

    for (const pattern of this.patterns) {
      const patternScore = pattern.detector(chunk, archive);
      weightedScore += patternScore * pattern.weight;
      totalWeight += pattern.weight;

      // Map to factors
      switch (pattern.name) {
        case 'ratio-anomaly':
          factors.ratioSuspicion = patternScore;
          break;
        case 'time-anomaly':
          factors.timingSuspicion = patternScore;
          break;
        case 'retry-anomaly':
        case 'stall-anomaly':
          factors.retrySuspicion = Math.max(factors.retrySuspicion, patternScore);
          break;
        case 'memory-pressure':
        case 'wasm-instability':
          factors.patternSuspicion = Math.max(factors.patternSuspicion, patternScore);
          break;
      }
    }

    // Size suspicion from size deviation
    if (archive.avgCompressionRatio > 0) {
      const expectedSize = chunk.originalSize * archive.avgCompressionRatio;
      const sizeDeviation = Math.abs(chunk.compressedSize - expectedSize) / expectedSize;
      factors.sizeSuspicion = Math.min(1, sizeDeviation / 0.5);
      weightedScore += factors.sizeSuspicion * 0.15;
      totalWeight += 0.15;
    }

    const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

    // Predict anomaly types
    const predictedAnomalies = this.predictAnomalies(factors, finalScore);

    // Recommend action
    const recommendedAction = this.recommendAction(finalScore, predictedAnomalies);

    return {
      chunkIndex: chunk.chunkIndex,
      score: finalScore,
      factors,
      predictedAnomalies,
      recommendedAction,
    };
  }

  private predictAnomalies(
    factors: ChunkAnomalyScore['factors'],
    score: number
  ): AnomalyType[] {
    const anomalies: AnomalyType[] = [];

    if (factors.ratioSuspicion > 0.7) {
      anomalies.push('ratio-suspicious');
    }
    if (factors.sizeSuspicion > 0.7) {
      anomalies.push('size-mismatch');
    }
    if (factors.timingSuspicion > 0.7) {
      anomalies.push('corrupt-chunk');
    }
    if (factors.retrySuspicion > 0.7) {
      anomalies.push('corrupt-chunk');
    }
    if (factors.patternSuspicion > 0.7) {
      anomalies.push('corrupt-chunk');
    }

    // High overall score without specific pattern = potential hash mismatch
    if (score > 0.6 && anomalies.length === 0) {
      anomalies.push('hash-mismatch');
    }

    return anomalies;
  }

  private recommendAction(
    score: number,
    anomalies: AnomalyType[]
  ): ChunkAnomalyScore['recommendedAction'] {
    if (score < this.config.lowRiskThreshold) {
      return 'skip';
    }
    if (score < this.config.anomalyThreshold) {
      return 'verify-only';
    }
    if (anomalies.includes('corrupt-chunk') || anomalies.includes('hash-mismatch')) {
      return 'recompress-chunk';
    }
    if (anomalies.includes('ratio-suspicious') || anomalies.includes('size-mismatch')) {
      return 'recompress-chunk';
    }
    return 'verify-only';
  }

  // ==========================================================================
  // BASELINE COMPUTATION
  // ==========================================================================

  private computeBaseline(archive: ArchiveStatistics): void {
    const ratios = archive.chunkStats.map(c => c.compressionRatio);
    const times = archive.chunkStats.map(c => c.processingTime);

    // Compute trends for historical pattern
    const windowSize = Math.min(this.config.patternWindowSize, ratios.length);
    const ratioTrend: number[] = [];
    const timeTrend: number[] = [];

    for (let i = 0; i <= ratios.length - windowSize; i++) {
      const window = ratios.slice(i, i + windowSize);
      ratioTrend.push(window.reduce((a, b) => a + b, 0) / windowSize);
    }

    for (let i = 0; i <= times.length - windowSize; i++) {
      const window = times.slice(i, i + windowSize);
      timeTrend.push(window.reduce((a, b) => a + b, 0) / windowSize);
    }

    // Error and stall rates
    const totalRetries = archive.chunkStats.reduce((sum, c) => sum + c.workerRetries, 0);
    const totalStalls = archive.chunkStats.reduce((sum, c) => sum + c.workerStalls, 0);
    const errorRate = archive.totalChunks > 0 ? totalRetries / archive.totalChunks : 0;
    const stallRate = archive.totalChunks > 0 ? totalStalls / archive.totalChunks : 0;

    this.historicalData = {
      avgRatio: archive.avgCompressionRatio,
      avgTime: archive.avgProcessingTime,
      ratioTrend,
      timeTrend,
      errorRate,
      stallRate,
    };
  }

  // ==========================================================================
  // CONFIDENCE CALCULATION
  // ==========================================================================

  private calculateConfidence(
    scores: ChunkAnomalyScore[],
    archive: ArchiveStatistics
  ): number {
    // Base confidence from sample size
    const sampleConfidence = Math.min(1, archive.totalChunks / 100);

    // Consistency confidence (lower variance = higher confidence)
    const scoreValues = scores.map(s => s.score);
    const avgScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
    const variance = scoreValues.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scoreValues.length;
    const consistencyConfidence = 1 / (1 + variance);

    // Pattern quality confidence
    let patternConfidence = 0.5;
    if (this.historicalData) {
      const ratioTrendStability = this.computeTrendStability(this.historicalData.ratioTrend);
      const timeTrendStability = this.computeTrendStability(this.historicalData.timeTrend);
      patternConfidence = (ratioTrendStability + timeTrendStability) / 2;
    }

    // Weighted average
    return sampleConfidence * 0.3 + consistencyConfidence * 0.4 + patternConfidence * 0.3;
  }

  private computeTrendStability(trend: number[]): number {
    if (trend.length < 2) return 0.5;
    
    let changes = 0;
    for (let i = 1; i < trend.length; i++) {
      if (Math.abs(trend[i] - trend[i - 1]) > trend[i - 1] * 0.1) {
        changes++;
      }
    }
    return 1 - changes / (trend.length - 1);
  }

  // ==========================================================================
  // ANOMALY DETECTION
  // ==========================================================================

  async detectAnomalies(archive: ArchiveStatistics): Promise<VerificationAnomaly[]> {
    const analysis = await this.analyzeArchive(archive);
    const anomalies: VerificationAnomaly[] = [];

    for (const prediction of analysis.predictions) {
      if (prediction.score >= this.config.anomalyThreshold) {
        for (const anomalyType of prediction.predictedAnomalies) {
          anomalies.push({
            id: `anomaly-${prediction.chunkIndex}-${anomalyType}`,
            type: anomalyType,
            severity: this.scoreSeverity(prediction.score),
            location: { chunkIndex: prediction.chunkIndex },
            description: this.describeAnomaly(anomalyType, prediction),
            detectedAt: Date.now(),
            repairAttempted: false,
            repairSuccessful: false,
          });
        }
      }
    }

    // Emit anomaly events
    for (const anomaly of anomalies) {
      this.emit({ type: 'anomaly-detected', anomaly });
    }

    return anomalies;
  }

  private scoreSeverity(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 0.9) return 'critical';
    if (score >= 0.7) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  }

  private describeAnomaly(type: AnomalyType, prediction: ChunkAnomalyScore): string {
    const chunk = prediction.chunkIndex;
    const score = (prediction.score * 100).toFixed(1);

    switch (type) {
      case 'ratio-suspicious':
        return `Chunk ${chunk} has suspicious compression ratio (${score}% anomaly score)`;
      case 'size-mismatch':
        return `Chunk ${chunk} has unexpected size deviation (${score}% anomaly score)`;
      case 'corrupt-chunk':
        return `Chunk ${chunk} shows corruption indicators (${score}% anomaly score)`;
      case 'hash-mismatch':
        return `Chunk ${chunk} may have hash verification issues (${score}% anomaly score)`;
      default:
        return `Chunk ${chunk} has anomaly type ${type} (${score}% anomaly score)`;
    }
  }

  // ==========================================================================
  // MISSING CHUNK DETECTION
  // ==========================================================================

  detectMissingChunks(
    expectedCount: number,
    chunkStats: ChunkStatistics[]
  ): number[] {
    const presentChunks = new Set(chunkStats.map(c => c.chunkIndex));
    const missing: number[] = [];

    for (let i = 0; i < expectedCount; i++) {
      if (!presentChunks.has(i)) {
        missing.push(i);
      }
    }

    return missing;
  }

  // ==========================================================================
  // PATTERN-BASED SKIP LIST
  // ==========================================================================

  generateSkipList(analysis: AIAnalysisResult): number[] {
    if (!this.config.skipLowRisk) {
      return [];
    }

    return analysis.predictions
      .filter(p => p.score < this.config.lowRiskThreshold)
      .map(p => p.chunkIndex);
  }

  // ==========================================================================
  // TARGETED VERIFICATION LIST
  // ==========================================================================

  generateTargetedList(analysis: AIAnalysisResult): {
    priority: number[];
    normal: number[];
    skipCandidate: number[];
  } {
    const priority: number[] = [];
    const normal: number[] = [];
    const skipCandidate: number[] = [];

    for (const prediction of analysis.predictions) {
      if (prediction.score >= 0.7) {
        priority.push(prediction.chunkIndex);
      } else if (prediction.score >= this.config.anomalyThreshold) {
        normal.push(prediction.chunkIndex);
      } else if (prediction.score < this.config.lowRiskThreshold) {
        skipCandidate.push(prediction.chunkIndex);
      } else {
        normal.push(prediction.chunkIndex);
      }
    }

    return { priority, normal, skipCandidate };
  }

  // ==========================================================================
  // STATISTICS EXPORT
  // ==========================================================================

  getPatternStats(): {
    patterns: Array<{ name: string; weight: number }>;
    historical: HistoricalPattern | null;
  } {
    return {
      patterns: this.patterns.map(p => ({ name: p.name, weight: p.weight })),
      historical: this.historicalData,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createAnomalyDetector(
  config?: Partial<AnomalyDetectorConfig>
): AIAnomalyDetector {
  return new AIAnomalyDetector(config);
}
