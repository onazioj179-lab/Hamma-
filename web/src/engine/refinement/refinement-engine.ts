/**
 * SPK Multi-Pass Entropy Refinement Engine - Main Engine
 * Creator: OJ Treasure Onazi
 * 
 * Coordinates multi-pass refinement using Range Coder (Mode A),
 * Huffman Rebalancing (Mode B), and Structural Reduction (Mode C).
 */

import {
  RefinementMode,
  PassResult,
  PassDecision,
  RefinementSummary,
  RefinementCheckpoint,
  RefinementEngineConfig,
  RefinementEvent,
  RefinementEventHandler,
  QualityTier,
  DEFAULT_REFINEMENT_ENGINE_CONFIG,
  assessQuality,
  getModeName,
  MB,
} from './types';
import { EntropyPassController, createPassController } from './pass-controller';
import { RangeCoder, createRangeCoder } from './range-coder';
import { HuffmanRebalancer, createHuffmanRebalancer } from './huffman-rebalancer';
import { StructuralReducer, createStructuralReducer } from './structural-reducer';

// ============================================================================
// REFINEMENT ENGINE
// ============================================================================

export class RefinementEngine {
  private config: RefinementEngineConfig;
  
  // Components
  private controller: EntropyPassController;
  private rangeCoder: RangeCoder;
  private huffman: HuffmanRebalancer;
  private structural: StructuralReducer;
  
  // Event handling
  private eventHandlers: Set<RefinementEventHandler> = new Set();
  
  // State
  private currentChunkIndex = 0;
  private checkpoints: Map<number, RefinementCheckpoint> = new Map();
  private passResults: PassResult[] = [];
  
  // Stats
  private totalBytesProcessed = 0;
  private totalBytesSaved = 0;
  private peakMemory = 0;

  constructor(config: Partial<RefinementEngineConfig> = {}) {
    this.config = { ...DEFAULT_REFINEMENT_ENGINE_CONFIG, ...config };
    
    // Initialize components
    this.controller = createPassController(
      this.config.controller,
      this.config
    );
    this.rangeCoder = createRangeCoder(this.config.rangeCoder);
    this.huffman = createHuffmanRebalancer(this.config.huffman);
    this.structural = createStructuralReducer(this.config.structural);
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: RefinementEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: RefinementEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: RefinementEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // MAIN API
  // ==========================================================================

  /**
   * Refine data through multiple passes
   */
  async refine(
    data: Uint8Array,
    chunkIndex: number = 0
  ): Promise<{ data: Uint8Array; summary: RefinementSummary }> {
    this.currentChunkIndex = chunkIndex;
    const passResults: PassResult[] = [];
    const startTime = performance.now();
    
    let currentData = data;
    let currentRatio = 1.0;
    let passNumber = 0;

    while (passNumber < this.config.controller.maxPasses) {
      // Get decision from controller
      const decision = this.controller.selectRefinementMode(
        currentData,
        currentRatio,
        passNumber
      );

      if (!decision.shouldRefine) {
        break;
      }

      // Check memory
      if (decision.memoryRequirement > this.config.controller.memoryLimit) {
        this.emit({
          type: 'memory-warning',
          usage: decision.memoryRequirement,
          limit: this.config.controller.memoryLimit,
        });
        
        if (decision.useLiteMode) {
          this.emit({
            type: 'lite-mode-activated',
            availableMemory: this.config.controller.memoryLimit,
          });
        } else {
          break;
        }
      }

      // Emit pass start
      this.emit({
        type: 'pass-start',
        mode: decision.mode,
        passNumber,
      });

      // Execute pass
      const result = await this.executePass(currentData, decision);
      passResults.push(result);
      
      // Record for learning
      this.controller.recordPassResult(result);

      // Emit pass complete
      this.emit({
        type: 'pass-complete',
        result,
      });

      // Update state
      if (result.status === 'success' && result.wasSignificant) {
        currentRatio = result.ratio;
        // In a real implementation, we'd update currentData with encoded result
        // For now, we track the ratio improvement
      }

      // Track peak memory
      this.peakMemory = Math.max(this.peakMemory, result.memoryUsed);

      // Check if improvement was significant enough to continue
      if (!result.wasSignificant) {
        break;
      }

      // Checkpoint periodically
      if (this.config.checkpointInterval > 0 && 
          passNumber % this.config.checkpointInterval === 0) {
        this.saveCheckpoint(chunkIndex, passNumber, decision.mode, currentData, passResults);
      }

      passNumber++;
    }

    // Generate summary
    const totalTime = performance.now() - startTime;
    const summary = this.generateSummary(
      data.length,
      Math.round(data.length * currentRatio),
      passResults,
      totalTime
    );

    // Emit completion
    this.emit({
      type: 'refinement-complete',
      summary,
    });

    // Update global stats
    this.totalBytesProcessed += data.length;
    this.totalBytesSaved += data.length - Math.round(data.length * currentRatio);

    return { data: currentData, summary };
  }

  /**
   * Execute a single refinement pass
   */
  private async executePass(
    data: Uint8Array,
    decision: PassDecision
  ): Promise<PassResult> {
    const startTime = performance.now();

    try {
      let result: PassResult;

      switch (decision.mode) {
        case 'mode-a':
          result = this.rangeCoder.executePass(data);
          break;
        case 'mode-b':
          result = this.huffman.executePass(data);
          break;
        case 'mode-c':
          result = this.structural.executePass(data);
          break;
        case 'mode-d':
        default:
          result = {
            mode: 'mode-d',
            status: 'skipped',
            inputSize: data.length,
            outputSize: data.length,
            ratio: 1.0,
            timeMs: 0,
            memoryUsed: 0,
            wasSignificant: false,
            entropyBefore: 0,
            entropyAfter: 0,
          };
      }

      // Check timeout
      const elapsed = performance.now() - startTime;
      if (elapsed > this.config.controller.timeLimit) {
        return {
          ...result,
          status: 'timeout',
          wasSignificant: false,
        };
      }

      return result;
    } catch (error) {
      this.emit({
        type: 'pass-failed',
        mode: decision.mode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        mode: decision.mode,
        status: 'failed',
        inputSize: data.length,
        outputSize: data.length,
        ratio: 1.0,
        timeMs: performance.now() - startTime,
        memoryUsed: 0,
        wasSignificant: false,
        entropyBefore: 0,
        entropyAfter: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ==========================================================================
  // QUICK METHODS
  // ==========================================================================

  /**
   * Quick decision: should data be refined?
   */
  shouldRefine(data: Uint8Array, currentRatio: number = 1.0): boolean {
    return this.controller.shouldRefine(data, currentRatio, 0);
  }

  /**
   * Get recommended mode without executing
   */
  recommendMode(data: Uint8Array, currentRatio: number = 1.0): PassDecision {
    return this.controller.selectRefinementMode(data, currentRatio, 0);
  }

  /**
   * Execute single pass with specific mode
   */
  executeSinglePass(data: Uint8Array, mode: RefinementMode): PassResult {
    switch (mode) {
      case 'mode-a':
        return this.rangeCoder.executePass(data);
      case 'mode-b':
        return this.huffman.executePass(data);
      case 'mode-c':
        return this.structural.executePass(data);
      case 'mode-d':
      default:
        return {
          mode: 'mode-d',
          status: 'skipped',
          inputSize: data.length,
          outputSize: data.length,
          ratio: 1.0,
          timeMs: 0,
          memoryUsed: 0,
          wasSignificant: false,
          entropyBefore: 0,
          entropyAfter: 0,
        };
    }
  }

  // ==========================================================================
  // CHECKPOINTING
  // ==========================================================================

  /**
   * Save checkpoint for recovery
   */
  private saveCheckpoint(
    chunkIndex: number,
    passNumber: number,
    mode: RefinementMode,
    data: Uint8Array,
    passResults: PassResult[]
  ): void {
    const checkpoint: RefinementCheckpoint = {
      chunkIndex,
      passNumber,
      mode,
      dataState: data,
      passResults: [...passResults],
      timestamp: Date.now(),
      memorySnapshot: {
        rangeCoderState: mode === 'mode-a' ? this.rangeCoder.getState() : undefined,
        huffmanCodes: mode === 'mode-b' ? this.huffman.getCodes() : undefined,
      },
    };

    this.checkpoints.set(chunkIndex, checkpoint);

    this.emit({
      type: 'checkpoint-saved',
      passNumber,
    });
  }

  /**
   * Restore from checkpoint
   */
  restoreFromCheckpoint(chunkIndex: number): RefinementCheckpoint | null {
    return this.checkpoints.get(chunkIndex) || null;
  }

  /**
   * Clear checkpoints
   */
  clearCheckpoints(): void {
    this.checkpoints.clear();
  }

  // ==========================================================================
  // SUMMARY GENERATION
  // ==========================================================================

  /**
   * Generate refinement summary
   */
  private generateSummary(
    originalSize: number,
    finalSize: number,
    passes: PassResult[],
    totalTimeMs: number
  ): RefinementSummary {
    const successfulPasses = passes.filter(p => p.status === 'success').length;
    const effectivePasses = passes.filter(p => p.wasSignificant).length;
    const overallRatio = originalSize > 0 ? finalSize / originalSize : 1.0;
    
    // Get average entropy
    const avgEntropy = passes.length > 0
      ? passes.reduce((sum, p) => sum + p.entropyBefore, 0) / passes.length
      : 0.5;
    
    const quality = assessQuality(overallRatio, avgEntropy);
    const worthwhile = overallRatio < 0.95 && effectivePasses > 0;

    return {
      totalPasses: passes.length,
      successfulPasses,
      effectivePasses,
      originalSize,
      finalSize,
      overallRatio,
      totalTimeMs,
      peakMemory: this.peakMemory,
      passes,
      quality,
      worthwhile,
    };
  }

  // ==========================================================================
  // STATS & DIAGNOSTICS
  // ==========================================================================

  /**
   * Get engine statistics
   */
  getStats(): {
    totalBytesProcessed: number;
    totalBytesSaved: number;
    savingsRate: number;
    passHistory: PassResult[];
    peakMemory: number;
    isLiteMode: boolean;
  } {
    return {
      totalBytesProcessed: this.totalBytesProcessed,
      totalBytesSaved: this.totalBytesSaved,
      savingsRate: this.totalBytesProcessed > 0 
        ? this.totalBytesSaved / this.totalBytesProcessed 
        : 0,
      passHistory: this.controller.getPassHistory(),
      peakMemory: this.peakMemory,
      isLiteMode: this.controller.isInLiteMode(),
    };
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): number {
    return this.peakMemory;
  }

  /**
   * Update memory limit
   */
  setMemoryLimit(bytes: number): void {
    this.controller.updateAvailableMemory(bytes);
  }

  // ==========================================================================
  // RESET
  // ==========================================================================

  /**
   * Reset engine state
   */
  reset(): void {
    this.controller.reset();
    this.rangeCoder.reset();
    this.huffman.reset();
    this.structural.reset();
    this.checkpoints.clear();
    this.passResults = [];
    this.currentChunkIndex = 0;
    this.totalBytesProcessed = 0;
    this.totalBytesSaved = 0;
    this.peakMemory = 0;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createRefinementEngine(
  config?: Partial<RefinementEngineConfig>
): RefinementEngine {
  return new RefinementEngine(config);
}

// ============================================================================
// LITE ENGINE (for constrained devices)
// ============================================================================

/**
 * Create a lite refinement engine for 1GB RAM devices
 */
export function createLiteRefinementEngine(): RefinementEngine {
  return new RefinementEngine({
    controller: {
      maxPasses: 2,
      minImprovement: 0.03,
      memoryLimit: 100 * MB,
      timeLimit: 3000,
      enableLiteMode: true,
      liteModeThreshold: 512 * MB,
      autoModeSelection: true,
      skipUnlikely: true,
    },
    rangeCoder: {
      precisionBits: 24, // Reduced precision
      updateInterval: 512,
      staticModel: true, // Use static for less memory
      contextOrder: 0, // Order-0 only
    },
    huffman: {
      maxCodeLength: 12,
      minFrequency: 2,
      canonical: true,
      rebalanceThreshold: 0.15,
    },
    structural: {
      minRunLength: 6,
      minPatternLength: 4,
      maxPatternLength: 64,
      enableDelta: true,
      enableDictionary: false, // Disable for memory
      maxDictionarySize: 8 * 1024,
    },
    parallelPasses: false,
    checkpointInterval: 0, // Disable for memory
    enableTelemetry: false,
  });
}
