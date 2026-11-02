/**
 * SPK AI-Powered Post-Compression Integrity Verification Engine - Main Verifier
 * Creator: OJ Treasure Onazi
 * 
 * Coordinates the complete integrity verification pipeline:
 * chunk validation, metadata validation, footer validation,
 * anomaly detection, and auto-repair.
 */

import {
  ArchiveVerificationResult,
  VerificationStatus,
  VerificationStep,
  StepResult,
  VerificationAnomaly,
  ArchiveStatistics,
  ChunkStatistics,
  AIVerificationConfig,
  DEFAULT_AI_VERIFICATION_CONFIG,
  IntegrityEvent,
  IntegrityEventHandler,
  VerificationProgress,
  VerificationSummary,
  MB,
} from '../core/types/integrity';

import { 
  ChunkValidator, 
  ChunkValidatorConfig,
  createChunkValidator 
} from './chunk-validator';

import { 
  MetadataValidator, 
  MetadataValidatorConfig,
  ArchiveMetadata,
  createMetadataValidator 
} from './metadata-validator';

import { 
  FooterValidator, 
  FooterValidatorConfig,
  FooterData,
  createFooterValidator 
} from './footer-validator';

import { 
  AIAnomalyDetector, 
  AnomalyDetectorConfig,
  createAnomalyDetector 
} from './anomaly-detector';

import { 
  RepairEngine, 
  RepairEngineConfig,
  RepairContext,
  createRepairEngine 
} from './repair-engine';

// ============================================================================
// VERIFIER CONFIG
// ============================================================================

export interface IntegrityVerifierConfig {
  /** AI verification settings */
  ai: AIVerificationConfig;
  
  /** Chunk validator settings */
  chunkValidator: Partial<ChunkValidatorConfig>;
  
  /** Metadata validator settings */
  metadataValidator: Partial<MetadataValidatorConfig>;
  
  /** Footer validator settings */
  footerValidator: Partial<FooterValidatorConfig>;
  
  /** Anomaly detector settings */
  anomalyDetector: Partial<AnomalyDetectorConfig>;
  
  /** Repair engine settings */
  repairEngine: Partial<RepairEngineConfig>;
  
  /** Enable parallel verification */
  parallelVerification: boolean;
  
  /** Max parallel verifications */
  maxParallel: number;
  
  /** Stop on first critical error */
  failFast: boolean;
  
  /** Enable progress reporting */
  reportProgress: boolean;
  
  /** Progress report interval (ms) */
  progressInterval: number;
}

export const DEFAULT_VERIFIER_CONFIG: IntegrityVerifierConfig = {
  ai: DEFAULT_AI_VERIFICATION_CONFIG,
  chunkValidator: {},
  metadataValidator: {},
  footerValidator: {},
  anomalyDetector: {},
  repairEngine: {},
  parallelVerification: true,
  maxParallel: 8,
  failFast: false,
  reportProgress: true,
  progressInterval: 100,
};

// ============================================================================
// ARCHIVE INPUT
// ============================================================================

export interface ArchiveInput {
  /** Archive ID */
  id: string;
  
  /** Archive buffer */
  buffer: ArrayBuffer;
  
  /** Pre-parsed metadata (optional) */
  metadata?: ArchiveMetadata;
  
  /** Pre-parsed footer (optional) */
  footer?: FooterData;
  
  /** Chunk statistics from compression */
  chunkStats?: ChunkStatistics[];
  
  /** Compressor function for repairs */
  compressor?: (data: Uint8Array, level: number) => Promise<Uint8Array>;
  
  /** Decompressor function for repairs */
  decompressor?: (data: Uint8Array) => Promise<Uint8Array>;
}

// ============================================================================
// INTEGRITY VERIFIER
// ============================================================================

export class IntegrityVerifier {
  private config: IntegrityVerifierConfig;
  private chunkValidator: ChunkValidator;
  private metadataValidator: MetadataValidator;
  private footerValidator: FooterValidator;
  private anomalyDetector: AIAnomalyDetector;
  private repairEngine: RepairEngine;
  private eventHandlers: Set<IntegrityEventHandler> = new Set();
  private currentProgress: VerificationProgress | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<IntegrityVerifierConfig> = {}) {
    this.config = { 
      ...DEFAULT_VERIFIER_CONFIG, 
      ...config,
      ai: { ...DEFAULT_AI_VERIFICATION_CONFIG, ...config.ai },
    };

    this.chunkValidator = createChunkValidator(this.config.chunkValidator);
    this.metadataValidator = createMetadataValidator(this.config.metadataValidator);
    this.footerValidator = createFooterValidator(this.config.footerValidator);
    this.anomalyDetector = createAnomalyDetector(this.config.anomalyDetector);
    this.repairEngine = createRepairEngine(this.config.repairEngine);
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
  // MAIN VERIFICATION
  // ==========================================================================

  async verify(input: ArchiveInput): Promise<ArchiveVerificationResult> {
    const result: ArchiveVerificationResult = {
      archiveId: input.id,
      status: 'in-progress',
      startTime: performance.now(),
      steps: new Map(),
      totalChunks: 0,
      verifiedChunks: 0,
      failedChunks: 0,
      repairedChunks: 0,
      totalFiles: 0,
      verifiedFiles: 0,
      failedFiles: 0,
      anomalies: [],
      anomalyScore: 0,
      repairsAttempted: 0,
      repairsSuccessful: 0,
      repairHistory: [],
      metadataValid: false,
      footerValid: false,
      archiveReady: false,
      downloadAllowed: false,
    };

    // Emit start event
    this.emit({
      type: 'verification-start',
      archiveId: input.id,
      totalChunks: input.metadata?.totalChunks || 0,
    });

    // Start progress reporting
    this.startProgressReporting(result);

    try {
      // Step 1: Footer Validation
      await this.runStep('footer-validation', result, async () => {
        return this.verifyFooter(input, result);
      });

      if (this.shouldStop(result)) {
        return this.finalize(result);
      }

      // Step 2: Metadata Validation
      await this.runStep('metadata-block', result, async () => {
        return this.verifyMetadata(input, result);
      });

      if (this.shouldStop(result)) {
        return this.finalize(result);
      }

      // Step 3: Chunk Count Validation
      await this.runStep('chunk-count', result, async () => {
        return this.verifyChunkCount(input, result);
      });

      // Step 4: AI Analysis (predictive)
      let aiAnalysis = null;
      if (this.config.ai.enablePrediction && input.chunkStats) {
        aiAnalysis = await this.runAIAnalysis(input, result);
      }

      // Step 5: Chunk Hash Validation
      await this.runStep('chunk-hashes', result, async () => {
        return this.verifyChunkHashes(input, result, aiAnalysis);
      });

      // Step 6: Chunk Size Validation
      await this.runStep('chunk-sizes', result, async () => {
        return this.verifyChunkSizes(input, result);
      });

      // Step 7: Sequential Offset Validation
      await this.runStep('sequential-offsets', result, async () => {
        return this.verifyOffsets(input, result);
      });

      // Step 8: File Boundary Validation
      await this.runStep('file-boundaries', result, async () => {
        return this.verifyFileBoundaries(input, result);
      });

      // Step 9: Reconstructability Check
      await this.runStep('reconstructability', result, async () => {
        return this.verifyReconstructability(input, result);
      });

      // Step 10: Compression Ratio Validation
      await this.runStep('compression-ratio', result, async () => {
        return this.verifyCompressionRatio(input, result);
      });

      // Step 11: Auto-repair if needed
      if (this.config.ai.autoRepair && result.anomalies.length > 0) {
        await this.performRepairs(input, result);
      }

    } catch (error) {
      result.status = 'failed';
      result.anomalies.push({
        id: `error-${Date.now()}`,
        type: 'reconstruction-failure',
        severity: 'critical',
        location: {},
        description: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        detectedAt: Date.now(),
        repairAttempted: false,
        repairSuccessful: false,
      });
    }

    return this.finalize(result);
  }

  // ==========================================================================
  // STEP EXECUTION
  // ==========================================================================

  private async runStep(
    step: VerificationStep,
    result: ArchiveVerificationResult,
    executor: () => Promise<StepResult>
  ): Promise<void> {
    this.updateProgress('verifying', step);
    this.emit({ type: 'verification-step', step, status: 'in-progress' });

    try {
      const stepResult = await executor();
      result.steps.set(step, stepResult);
      this.emit({ type: 'verification-step', step, status: stepResult.status });
    } catch (error) {
      const failedResult: StepResult = {
        step,
        status: 'failed',
        startTime: performance.now(),
        endTime: performance.now(),
        passed: false,
        details: error instanceof Error ? error.message : 'Unknown error',
      };
      result.steps.set(step, failedResult);
      this.emit({ type: 'verification-step', step, status: 'failed' });
    }
  }

  // ==========================================================================
  // FOOTER VERIFICATION
  // ==========================================================================

  private async verifyFooter(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<StepResult> {
    const startTime = performance.now();

    const footerResult = await this.footerValidator.validate(
      input.buffer,
      BigInt(input.buffer.byteLength)
    );

    result.footerValid = footerResult.valid;
    
    // Add anomalies
    for (const anomaly of footerResult.anomalies) {
      result.anomalies.push(anomaly);
      this.emit({ type: 'anomaly-detected', anomaly });
    }

    // Store parsed footer
    if (footerResult.footer && !input.footer) {
      input.footer = footerResult.footer;
    }

    return {
      step: 'footer-validation',
      status: footerResult.valid ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: footerResult.valid,
      details: footerResult.valid 
        ? 'Footer validation passed' 
        : `Footer validation failed: ${footerResult.errors.map(e => e.message).join(', ')}`,
    };
  }

  // ==========================================================================
  // METADATA VERIFICATION
  // ==========================================================================

  private async verifyMetadata(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<StepResult> {
    const startTime = performance.now();

    // Extract metadata from archive
    let metadataBuffer: ArrayBuffer;
    if (input.footer) {
      const offset = Number(input.footer.metadataOffset);
      const size = input.footer.metadataSize;
      metadataBuffer = input.buffer.slice(offset, offset + size);
    } else {
      // Try to find metadata
      return {
        step: 'metadata-block',
        status: 'failed',
        startTime,
        endTime: performance.now(),
        passed: false,
        details: 'Cannot locate metadata block without footer',
      };
    }

    const metadataResult = await this.metadataValidator.validate(metadataBuffer);

    result.metadataValid = metadataResult.valid;
    
    if (metadataResult.metadata) {
      input.metadata = metadataResult.metadata;
      result.totalChunks = metadataResult.metadata.totalChunks;
      result.totalFiles = metadataResult.metadata.totalFiles;
    }

    // Add anomalies
    for (const anomaly of metadataResult.anomalies) {
      result.anomalies.push(anomaly);
      this.emit({ type: 'anomaly-detected', anomaly });
    }

    return {
      step: 'metadata-block',
      status: metadataResult.valid ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: metadataResult.valid,
      details: metadataResult.valid 
        ? 'Metadata validation passed' 
        : `Metadata validation failed: ${metadataResult.errors.map(e => e.message).join(', ')}`,
    };
  }

  // ==========================================================================
  // CHUNK VALIDATIONS
  // ==========================================================================

  private async verifyChunkCount(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<StepResult> {
    const startTime = performance.now();

    if (!input.metadata) {
      return {
        step: 'chunk-count',
        status: 'skipped',
        startTime,
        endTime: performance.now(),
        passed: false,
        details: 'Metadata not available',
      };
    }

    const validation = this.chunkValidator.validateChunkCount(
      input.metadata.totalChunks,
      input.metadata.chunks.length,
      input.metadata.chunks.map(c => c.index)
    );

    // Create anomalies for missing chunks
    for (const missing of validation.missingChunks) {
      const anomaly: VerificationAnomaly = {
        id: `missing-chunk-${missing}`,
        type: 'missing-chunk',
        severity: 'critical',
        location: { chunkIndex: missing },
        description: `Chunk ${missing} is missing from archive`,
        detectedAt: Date.now(),
        repairAttempted: false,
        repairSuccessful: false,
      };
      result.anomalies.push(anomaly);
      this.emit({ type: 'anomaly-detected', anomaly });
    }

    return {
      step: 'chunk-count',
      status: validation.valid ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: validation.valid,
      details: validation.valid 
        ? `All ${input.metadata.totalChunks} chunks present` 
        : `Missing: ${validation.missingChunks.length}, Duplicates: ${validation.duplicateChunks.length}`,
      affectedItems: [...validation.missingChunks, ...validation.duplicateChunks],
    };
  }

  private async verifyChunkHashes(
    input: ArchiveInput,
    result: ArchiveVerificationResult,
    aiAnalysis: { safeChunks: number[] } | null
  ): Promise<StepResult> {
    const startTime = performance.now();

    if (!input.metadata) {
      return {
        step: 'chunk-hashes',
        status: 'skipped',
        startTime,
        endTime: performance.now(),
        passed: false,
        details: 'Metadata not available',
      };
    }

    // Set baseline for chunk validator
    if (input.chunkStats) {
      const avgRatio = input.chunkStats.reduce((s, c) => s + c.compressionRatio, 0) / input.chunkStats.length;
      const avgSize = input.chunkStats.reduce((s, c) => s + c.compressedSize, 0) / input.chunkStats.length;
      this.chunkValidator.setBaselineStatistics(avgRatio, avgSize, input.chunkStats);
    }

    // Determine which chunks to verify
    const skipSet = new Set(aiAnalysis?.safeChunks || []);
    const chunksToVerify = this.config.ai.skipLowRisk
      ? input.metadata.chunks.filter(c => !skipSet.has(c.index))
      : input.metadata.chunks;

    let verified = 0;
    let failed = 0;
    const failedChunks: number[] = [];

    // Verify chunks (could be parallelized)
    for (const chunkMeta of chunksToVerify) {
      // Get chunk data from archive
      const chunkData = new Uint8Array(
        input.buffer,
        Number(chunkMeta.offset),
        chunkMeta.compressedSize
      );

      const validation = await this.chunkValidator.validateChunk(
        chunkMeta.index,
        chunkData,
        chunkMeta.hash,
        chunkMeta.compressedSize,
        chunkMeta.offset,
        chunkMeta.offset
      );

      if (validation.status === 'passed') {
        verified++;
      } else {
        failed++;
        failedChunks.push(chunkMeta.index);
        
        for (const anomalyType of validation.anomalies) {
          const anomaly: VerificationAnomaly = {
            id: `chunk-${chunkMeta.index}-${anomalyType}`,
            type: anomalyType,
            severity: anomalyType === 'hash-mismatch' ? 'critical' : 'high',
            location: { chunkIndex: chunkMeta.index },
            description: `Chunk ${chunkMeta.index} failed ${anomalyType} validation`,
            detectedAt: Date.now(),
            repairAttempted: false,
            repairSuccessful: false,
          };
          result.anomalies.push(anomaly);
          this.emit({ type: 'anomaly-detected', anomaly });
        }
      }

      result.verifiedChunks = verified + (aiAnalysis?.safeChunks.length || 0);
      this.emit({
        type: 'verification-progress',
        archiveId: input.id,
        verified: result.verifiedChunks,
        total: result.totalChunks,
      });
    }

    result.failedChunks = failed;

    return {
      step: 'chunk-hashes',
      status: failed === 0 ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: failed === 0,
      details: `Verified: ${verified}, Skipped: ${skipSet.size}, Failed: ${failed}`,
      affectedItems: failedChunks,
    };
  }

  private async verifyChunkSizes(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<StepResult> {
    const startTime = performance.now();

    if (!input.metadata) {
      return {
        step: 'chunk-sizes',
        status: 'skipped',
        startTime,
        endTime: performance.now(),
        passed: false,
        details: 'Metadata not available',
      };
    }

    const chunks = input.metadata.chunks.map(c => ({
      index: c.index,
      compressedSize: c.compressedSize,
      originalSize: c.originalSize,
    }));

    const validation = this.chunkValidator.validateChunkSizes(
      chunks,
      input.metadata.chunkSize,
      1024
    );

    // Create anomalies
    for (const idx of validation.suspiciousRatios) {
      const anomaly: VerificationAnomaly = {
        id: `size-ratio-${idx}`,
        type: 'ratio-suspicious',
        severity: 'medium',
        location: { chunkIndex: idx },
        description: `Chunk ${idx} has suspicious compression ratio`,
        detectedAt: Date.now(),
        repairAttempted: false,
        repairSuccessful: false,
      };
      result.anomalies.push(anomaly);
    }

    return {
      step: 'chunk-sizes',
      status: validation.valid ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: validation.valid,
      details: validation.valid 
        ? 'All chunk sizes valid' 
        : `Oversized: ${validation.oversizedChunks.length}, Suspicious ratios: ${validation.suspiciousRatios.length}`,
      affectedItems: [...validation.oversizedChunks, ...validation.suspiciousRatios],
    };
  }

  private async verifyOffsets(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<StepResult> {
    const startTime = performance.now();

    if (!input.metadata) {
      return {
        step: 'sequential-offsets',
        status: 'skipped',
        startTime,
        endTime: performance.now(),
        passed: false,
        details: 'Metadata not available',
      };
    }

    const chunks = input.metadata.chunks.map(c => ({
      index: c.index,
      size: c.compressedSize,
      offset: c.offset,
    }));

    const validation = this.chunkValidator.validateChunkOffsets(chunks);

    // Create anomalies
    for (const gap of validation.gaps) {
      const anomaly: VerificationAnomaly = {
        id: `offset-gap-${gap.afterChunk}`,
        type: 'offset-gap',
        severity: 'high',
        location: { chunkIndex: gap.afterChunk },
        description: `Gap of ${gap.gapSize} bytes after chunk ${gap.afterChunk}`,
        detectedAt: Date.now(),
        repairAttempted: false,
        repairSuccessful: false,
      };
      result.anomalies.push(anomaly);
    }

    for (const overlap of validation.overlaps) {
      const anomaly: VerificationAnomaly = {
        id: `offset-overlap-${overlap.chunks[0]}-${overlap.chunks[1]}`,
        type: 'offset-overlap',
        severity: 'critical',
        location: { chunkIndex: overlap.chunks[0] },
        description: `Overlap of ${overlap.overlapSize} bytes between chunks ${overlap.chunks[0]} and ${overlap.chunks[1]}`,
        detectedAt: Date.now(),
        repairAttempted: false,
        repairSuccessful: false,
      };
      result.anomalies.push(anomaly);
    }

    return {
      step: 'sequential-offsets',
      status: validation.valid ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: validation.valid,
      details: validation.valid 
        ? 'All offsets sequential' 
        : `Gaps: ${validation.gaps.length}, Overlaps: ${validation.overlaps.length}`,
    };
  }

  private async verifyFileBoundaries(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<StepResult> {
    const startTime = performance.now();

    if (!input.metadata) {
      return {
        step: 'file-boundaries',
        status: 'skipped',
        startTime,
        endTime: performance.now(),
        passed: false,
        details: 'Metadata not available',
      };
    }

    let valid = true;
    const issues: string[] = [];

    for (let i = 0; i < input.metadata.files.length; i++) {
      const file = input.metadata.files[i];
      
      if (file.startChunk >= input.metadata.totalChunks) {
        valid = false;
        issues.push(`File ${file.path}: startChunk ${file.startChunk} out of range`);
      }
      
      if (file.endChunk >= input.metadata.totalChunks) {
        valid = false;
        issues.push(`File ${file.path}: endChunk ${file.endChunk} out of range`);
      }
      
      if (file.startChunk > file.endChunk) {
        valid = false;
        issues.push(`File ${file.path}: startChunk > endChunk`);
      }
    }

    result.verifiedFiles = valid ? input.metadata.files.length : 0;
    result.failedFiles = valid ? 0 : input.metadata.files.length;

    return {
      step: 'file-boundaries',
      status: valid ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: valid,
      details: valid 
        ? `All ${input.metadata.files.length} file boundaries valid` 
        : issues.join('; '),
    };
  }

  private async verifyReconstructability(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<StepResult> {
    const startTime = performance.now();

    // Check if all components needed for reconstruction are present
    const canReconstruct = 
      result.footerValid &&
      result.metadataValid &&
      result.failedChunks === 0;

    return {
      step: 'reconstructability',
      status: canReconstruct ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: canReconstruct,
      details: canReconstruct 
        ? 'Archive can be fully reconstructed' 
        : 'Archive cannot be reconstructed due to missing or corrupt data',
    };
  }

  private async verifyCompressionRatio(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<StepResult> {
    const startTime = performance.now();

    if (!input.metadata) {
      return {
        step: 'compression-ratio',
        status: 'skipped',
        startTime,
        endTime: performance.now(),
        passed: false,
        details: 'Metadata not available',
      };
    }

    const originalSize = Number(input.metadata.totalOriginalSize);
    const compressedSize = Number(input.metadata.totalCompressedSize);
    const ratio = compressedSize / originalSize;

    // Suspicious if compressed > 150% of original
    const valid = ratio <= 1.5;

    return {
      step: 'compression-ratio',
      status: valid ? 'passed' : 'failed',
      startTime,
      endTime: performance.now(),
      passed: valid,
      details: `Compression ratio: ${(ratio * 100).toFixed(1)}% (${(originalSize / MB).toFixed(1)}MB → ${(compressedSize / MB).toFixed(1)}MB)`,
    };
  }

  // ==========================================================================
  // AI ANALYSIS
  // ==========================================================================

  private async runAIAnalysis(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<{ safeChunks: number[] } | null> {
    if (!input.chunkStats || !input.metadata) return null;

    this.updateProgress('analyzing', null);

    const archiveStats = this.buildArchiveStatistics(input);
    const analysis = await this.anomalyDetector.analyzeArchive(archiveStats);

    // Store anomaly score
    result.anomalyScore = 1 - analysis.healthScore;

    // Add predicted anomalies
    const anomalies = await this.anomalyDetector.detectAnomalies(archiveStats);
    for (const anomaly of anomalies) {
      result.anomalies.push(anomaly);
    }

    return { safeChunks: analysis.safeChunks };
  }

  private buildArchiveStatistics(input: ArchiveInput): ArchiveStatistics {
    const chunkStats = input.chunkStats || [];
    const metadata = input.metadata!;

    const ratios = chunkStats.map(c => c.compressionRatio);
    const times = chunkStats.map(c => c.processingTime);

    const avgRatio = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1);
    const avgTime = times.reduce((a, b) => a + b, 0) / (times.length || 1);

    const variance = ratios.reduce((sum, r) => sum + Math.pow(r - avgRatio, 2), 0) / (ratios.length || 1);
    const stdDevRatio = Math.sqrt(variance);

    const timeVariance = times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / (times.length || 1);
    const stdDevTime = Math.sqrt(timeVariance);

    return {
      totalChunks: metadata.totalChunks,
      totalFiles: metadata.totalFiles,
      totalCompressedSize: metadata.totalCompressedSize,
      totalOriginalSize: metadata.totalOriginalSize,
      avgCompressionRatio: avgRatio,
      avgProcessingTime: avgTime,
      stdDevRatio,
      stdDevTime,
      workerCrashes: 0,
      memoryPressureEvents: 0,
      chunkStats,
    };
  }

  // ==========================================================================
  // REPAIRS
  // ==========================================================================

  private async performRepairs(
    input: ArchiveInput,
    result: ArchiveVerificationResult
  ): Promise<void> {
    this.updateProgress('repairing', null);

    const context: RepairContext = {
      archiveId: input.id,
      metadata: input.metadata,
      footer: input.footer,
      anomalies: result.anomalies.filter(a => !a.repairAttempted),
      originalData: input.buffer,
      compressor: input.compressor,
      decompressor: input.decompressor,
    };

    const repairResult = await this.repairEngine.repair(context);

    result.repairsAttempted = repairResult.repairsAttempted;
    result.repairsSuccessful = repairResult.repairsSuccessful;
    result.repairHistory = repairResult.records;
    result.repairedChunks = repairResult.repairedChunks.length;

    // Update failed chunks count after repairs
    result.failedChunks -= repairResult.repairedChunks.length;
  }

  // ==========================================================================
  // PROGRESS REPORTING
  // ==========================================================================

  private startProgressReporting(result: ArchiveVerificationResult): void {
    if (!this.config.reportProgress) return;

    this.currentProgress = {
      phase: 'analyzing',
      currentStep: null,
      chunksVerified: 0,
      totalChunks: result.totalChunks,
      filesVerified: 0,
      totalFiles: result.totalFiles,
      anomaliesFound: 0,
      repairsAttempted: 0,
      estimatedRemaining: 0,
      message: 'Starting verification...',
    };

    this.progressTimer = setInterval(() => {
      if (this.currentProgress) {
        this.currentProgress.chunksVerified = result.verifiedChunks;
        this.currentProgress.anomaliesFound = result.anomalies.length;
        this.currentProgress.repairsAttempted = result.repairsAttempted;
      }
    }, this.config.progressInterval);
  }

  private stopProgressReporting(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    this.currentProgress = null;
  }

  private updateProgress(
    phase: VerificationProgress['phase'],
    step: VerificationStep | null
  ): void {
    if (this.currentProgress) {
      this.currentProgress.phase = phase;
      this.currentProgress.currentStep = step;
      this.currentProgress.message = step 
        ? `Running ${step}...` 
        : `${phase.charAt(0).toUpperCase() + phase.slice(1)}...`;
    }
  }

  // ==========================================================================
  // FINALIZATION
  // ==========================================================================

  private shouldStop(result: ArchiveVerificationResult): boolean {
    if (!this.config.failFast) return false;
    return result.anomalies.some(a => a.severity === 'critical');
  }

  private finalize(result: ArchiveVerificationResult): ArchiveVerificationResult {
    this.stopProgressReporting();

    result.endTime = performance.now();
    result.duration = result.endTime - result.startTime;

    // Calculate final status
    const hasCritical = result.anomalies.some(a => 
      a.severity === 'critical' && !a.repairSuccessful
    );
    const hasUnrepairedHigh = result.anomalies.some(a => 
      a.severity === 'high' && !a.repairSuccessful
    );

    if (hasCritical) {
      result.status = 'failed';
    } else if (hasUnrepairedHigh) {
      result.status = result.repairsSuccessful > 0 ? 'repaired' : 'failed';
    } else if (result.anomalies.length > 0 && result.repairsSuccessful > 0) {
      result.status = 'repaired';
    } else if (result.anomalies.length === 0) {
      result.status = 'passed';
    } else {
      result.status = 'passed';
    }

    // Determine if archive is ready
    result.archiveReady = result.status === 'passed' || result.status === 'repaired';
    result.downloadAllowed = result.archiveReady;

    // Emit completion event
    this.emit({ type: 'verification-complete', result });

    if (result.archiveReady) {
      this.emit({ type: 'archive-ready', archiveId: result.archiveId });
    } else {
      this.emit({
        type: 'archive-failed',
        archiveId: result.archiveId,
        reason: result.anomalies.map(a => a.description).join('; '),
      });
    }

    return result;
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  getSummary(result: ArchiveVerificationResult): VerificationSummary {
    let totalChecks = 0;
    let passedChecks = 0;

    for (const [, stepResult] of result.steps) {
      totalChecks++;
      if (stepResult.passed) passedChecks++;
    }

    return {
      passed: result.status === 'passed' || result.status === 'repaired',
      totalChecks,
      passedChecks,
      failedChecks: totalChecks - passedChecks,
      anomalies: result.anomalies.length,
      repairs: result.repairsSuccessful,
      duration: result.duration || 0,
      archiveSize: BigInt(0), // Would need archive reference
      compressionRatio: 0, // Would need metadata
    };
  }

  getProgress(): VerificationProgress | null {
    return this.currentProgress;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createIntegrityVerifier(
  config?: Partial<IntegrityVerifierConfig>
): IntegrityVerifier {
  return new IntegrityVerifier(config);
}
