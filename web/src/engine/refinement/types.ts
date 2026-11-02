/**
 * SPK Multi-Pass Entropy Refinement Engine - Type Definitions
 * Creator: OJ Treasure Onazi
 * 
 * Type definitions for the entropy refinement system that
 * performs multiple compression passes for optimal results.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const KB = 1024;
export const MB = 1024 * 1024;
export const GB = 1024 * 1024 * 1024;

// ============================================================================
// REFINEMENT MODES
// ============================================================================

/**
 * Refinement mode identifiers
 * - mode-a: RangeCoder Pass - high-precision arithmetic coding
 * - mode-b: Huffman Rebalancing - adaptive Huffman tree optimization
 * - mode-c: Structural Reduction - pattern-based structure reduction
 * - mode-d: No-op/Skip - already optimal, no refinement needed
 */
export type RefinementMode = 'mode-a' | 'mode-b' | 'mode-c' | 'mode-d';

/**
 * Extended mode names for clarity
 */
export type RefinementModeName = 
  | 'range-coder'      // Mode A
  | 'huffman-rebalance'// Mode B
  | 'structural'       // Mode C
  | 'skip'             // Mode D
  | 'lite';            // Special low-memory mode

/**
 * Pass result status
 */
export type PassStatus = 'success' | 'skipped' | 'failed' | 'timeout' | 'oom';

/**
 * Compression quality tier based on analysis
 */
export type QualityTier = 'optimal' | 'good' | 'acceptable' | 'poor' | 'uncompressible';

// ============================================================================
// ENTROPY ANALYSIS
// ============================================================================

/**
 * Entropy analysis result for a data block
 */
export interface EntropyAnalysis {
  /** Shannon entropy (0-1 normalized) */
  shannon: number;
  
  /** Block entropy (larger window) */
  block: number;
  
  /** Conditional entropy (context-based) */
  conditional: number;
  
  /** Cross entropy against expected distribution */
  cross: number;
  
  /** Estimated compressibility (0-1, higher = more compressible) */
  compressibility: number;
  
  /** Dominant byte value if data is highly redundant */
  dominantByte?: number;
  
  /** Pattern frequency (0-1, higher = more patterns) */
  patternFrequency: number;
  
  /** Estimated bits per byte after optimal encoding */
  optimalBitsPerByte: number;
}

/**
 * Histogram of byte values
 */
export interface ByteHistogram {
  /** Count of each byte value (256 bins) */
  counts: Uint32Array;
  
  /** Total bytes counted */
  total: number;
  
  /** Number of unique bytes used */
  uniqueBytes: number;
  
  /** Most frequent byte value */
  mode: number;
  
  /** Frequency of most common byte */
  modeFrequency: number;
}

// ============================================================================
// PASS DECISIONS
// ============================================================================

/**
 * Decision made by the pass controller
 */
export interface PassDecision {
  /** Whether to perform refinement */
  shouldRefine: boolean;
  
  /** Selected refinement mode */
  mode: RefinementMode;
  
  /** Human-readable mode name */
  modeName: RefinementModeName;
  
  /** Confidence in the decision (0-1) */
  confidence: number;
  
  /** Estimated improvement ratio (0-1, lower = better) */
  estimatedImprovement: number;
  
  /** Estimated memory requirement in bytes */
  memoryRequirement: number;
  
  /** Estimated time in ms */
  estimatedTime: number;
  
  /** Why this mode was selected */
  reason: string;
  
  /** Whether to use lite mode (for constrained devices) */
  useLiteMode: boolean;
  
  /** Number of recommended passes */
  recommendedPasses: number;
}

/**
 * Pass execution result
 */
export interface PassResult {
  /** Which mode was used */
  mode: RefinementMode;
  
  /** Status of the pass */
  status: PassStatus;
  
  /** Input size in bytes */
  inputSize: number;
  
  /** Output size in bytes */
  outputSize: number;
  
  /** Compression ratio achieved */
  ratio: number;
  
  /** Time taken in milliseconds */
  timeMs: number;
  
  /** Peak memory used in bytes */
  memoryUsed: number;
  
  /** Whether improvement was significant */
  wasSignificant: boolean;
  
  /** Entropy before pass */
  entropyBefore: number;
  
  /** Entropy after pass */
  entropyAfter: number;
  
  /** Error message if failed */
  error?: string;
}

/**
 * Multi-pass session summary
 */
export interface RefinementSummary {
  /** Total passes executed */
  totalPasses: number;
  
  /** Successful passes */
  successfulPasses: number;
  
  /** Passes that provided improvement */
  effectivePasses: number;
  
  /** Original data size */
  originalSize: number;
  
  /** Final data size */
  finalSize: number;
  
  /** Overall compression ratio */
  overallRatio: number;
  
  /** Total time spent */
  totalTimeMs: number;
  
  /** Peak memory used */
  peakMemory: number;
  
  /** Individual pass results */
  passes: PassResult[];
  
  /** Quality assessment */
  quality: QualityTier;
  
  /** Whether compression was worth it */
  worthwhile: boolean;
}

// ============================================================================
// RANGE CODER TYPES
// ============================================================================

/**
 * Range coder configuration
 */
export interface RangeCoderConfig {
  /** Precision bits (higher = more accurate, slower) */
  precisionBits: number;
  
  /** Frequency table update interval */
  updateInterval: number;
  
  /** Use static model (faster) or adaptive (better) */
  staticModel: boolean;
  
  /** Order of context model (0 = order-0, 1 = order-1, etc.) */
  contextOrder: number;
}

/**
 * Range coder state for checkpointing
 */
export interface RangeCoderState {
  /** Current range low bound */
  low: number;
  
  /** Current range */
  range: number;
  
  /** Frequency table */
  frequencies: Uint32Array;
  
  /** Total frequency count */
  totalFreq: number;
  
  /** Output bytes written */
  outputSize: number;
  
  /** Bytes processed */
  inputProcessed: number;
}

// ============================================================================
// HUFFMAN TYPES
// ============================================================================

/**
 * Huffman node for tree building
 */
export interface HuffmanNode {
  /** Symbol value (for leaf nodes) */
  symbol?: number;
  
  /** Frequency/weight */
  weight: number;
  
  /** Left child */
  left?: HuffmanNode;
  
  /** Right child */
  right?: HuffmanNode;
  
  /** Code assigned to this symbol */
  code?: number;
  
  /** Code length in bits */
  codeLength?: number;
}

/**
 * Huffman code table entry
 */
export interface HuffmanCode {
  /** Symbol value */
  symbol: number;
  
  /** Binary code */
  code: number;
  
  /** Code length in bits */
  length: number;
}

/**
 * Huffman rebalancing configuration
 */
export interface HuffmanConfig {
  /** Maximum code length (affects memory) */
  maxCodeLength: number;
  
  /** Minimum frequency to include symbol */
  minFrequency: number;
  
  /** Whether to use canonical codes */
  canonical: boolean;
  
  /** Rebalance threshold (ratio difference) */
  rebalanceThreshold: number;
}

/**
 * Huffman tree analysis
 */
export interface HuffmanAnalysis {
  /** Average code length */
  avgCodeLength: number;
  
  /** Maximum code length */
  maxCodeLength: number;
  
  /** Number of symbols used */
  symbolCount: number;
  
  /** Theoretical entropy limit */
  entropyLimit: number;
  
  /** Efficiency (entropy / avg code length) */
  efficiency: number;
  
  /** Whether tree is balanced */
  isBalanced: boolean;
  
  /** Suggested rebalancing */
  shouldRebalance: boolean;
}

// ============================================================================
// STRUCTURAL REDUCTION TYPES
// ============================================================================

/**
 * Pattern types for structural reduction
 */
export type PatternType = 
  | 'run'          // Run-length encoded pattern
  | 'delta'        // Delta-encoded pattern
  | 'periodic'     // Repeating pattern
  | 'dictionary'   // Dictionary-based pattern
  | 'none';        // No pattern detected

/**
 * Detected structural pattern
 */
export interface StructuralPattern {
  /** Type of pattern */
  type: PatternType;
  
  /** Start offset in data */
  offset: number;
  
  /** Length of pattern occurrence */
  length: number;
  
  /** Pattern data/definition */
  pattern: Uint8Array;
  
  /** Number of repetitions */
  repetitions: number;
  
  /** Estimated bytes saved if encoded */
  savings: number;
  
  /** Encoding cost */
  cost: number;
  
  /** Whether encoding is beneficial */
  beneficial: boolean;
}

/**
 * Structural reduction configuration
 */
export interface StructuralConfig {
  /** Minimum run length to encode */
  minRunLength: number;
  
  /** Minimum pattern length */
  minPatternLength: number;
  
  /** Maximum pattern length to search */
  maxPatternLength: number;
  
  /** Whether to use delta encoding */
  enableDelta: boolean;
  
  /** Whether to use dictionary */
  enableDictionary: boolean;
  
  /** Maximum dictionary size */
  maxDictionarySize: number;
}

/**
 * Structural analysis result
 */
export interface StructuralAnalysis {
  /** Detected patterns */
  patterns: StructuralPattern[];
  
  /** Total bytes in patterns */
  patternBytes: number;
  
  /** Percentage of data in patterns */
  patternCoverage: number;
  
  /** Estimated savings from reduction */
  estimatedSavings: number;
  
  /** Dominant pattern type */
  dominantType: PatternType;
  
  /** Whether structural reduction is recommended */
  recommended: boolean;
}

// ============================================================================
// CONTROLLER CONFIGURATION
// ============================================================================

/**
 * Pass controller configuration
 */
export interface PassControllerConfig {
  /** Maximum passes per chunk */
  maxPasses: number;
  
  /** Minimum improvement to continue (ratio) */
  minImprovement: number;
  
  /** Memory limit in bytes */
  memoryLimit: number;
  
  /** Time limit per pass in ms */
  timeLimit: number;
  
  /** Enable lite mode for low memory */
  enableLiteMode: boolean;
  
  /** Lite mode memory threshold */
  liteModeThreshold: number;
  
  /** Enable auto mode selection */
  autoModeSelection: boolean;
  
  /** Skip passes that won't help */
  skipUnlikely: boolean;
}

/**
 * Refinement engine configuration
 */
export interface RefinementEngineConfig {
  /** Controller config */
  controller: PassControllerConfig;
  
  /** Range coder config */
  rangeCoder: RangeCoderConfig;
  
  /** Huffman config */
  huffman: HuffmanConfig;
  
  /** Structural reduction config */
  structural: StructuralConfig;
  
  /** Enable parallel passes */
  parallelPasses: boolean;
  
  /** Checkpoint interval (chunks) */
  checkpointInterval: number;
  
  /** Enable telemetry */
  enableTelemetry: boolean;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

export const DEFAULT_PASS_CONTROLLER_CONFIG: PassControllerConfig = {
  maxPasses: 3,
  minImprovement: 0.02, // 2% minimum improvement to continue
  memoryLimit: 200 * MB, // 200MB for 10TB jobs
  timeLimit: 5000, // 5 seconds per pass
  enableLiteMode: true,
  liteModeThreshold: GB, // 1GB RAM trigger
  autoModeSelection: true,
  skipUnlikely: true,
};

export const DEFAULT_RANGE_CODER_CONFIG: RangeCoderConfig = {
  precisionBits: 32,
  updateInterval: 256,
  staticModel: false,
  contextOrder: 1,
};

export const DEFAULT_HUFFMAN_CONFIG: HuffmanConfig = {
  maxCodeLength: 15,
  minFrequency: 1,
  canonical: true,
  rebalanceThreshold: 0.1,
};

export const DEFAULT_STRUCTURAL_CONFIG: StructuralConfig = {
  minRunLength: 4,
  minPatternLength: 3,
  maxPatternLength: 256,
  enableDelta: true,
  enableDictionary: true,
  maxDictionarySize: 32 * KB,
};

export const DEFAULT_REFINEMENT_ENGINE_CONFIG: RefinementEngineConfig = {
  controller: DEFAULT_PASS_CONTROLLER_CONFIG,
  rangeCoder: DEFAULT_RANGE_CODER_CONFIG,
  huffman: DEFAULT_HUFFMAN_CONFIG,
  structural: DEFAULT_STRUCTURAL_CONFIG,
  parallelPasses: false, // Sequential for memory safety
  checkpointInterval: 1000,
  enableTelemetry: true,
};

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Refinement events for monitoring
 */
export type RefinementEvent =
  | { type: 'pass-start'; mode: RefinementMode; passNumber: number }
  | { type: 'pass-complete'; result: PassResult }
  | { type: 'pass-failed'; mode: RefinementMode; error: string }
  | { type: 'mode-switch'; from: RefinementMode; to: RefinementMode; reason: string }
  | { type: 'memory-warning'; usage: number; limit: number }
  | { type: 'lite-mode-activated'; availableMemory: number }
  | { type: 'checkpoint-saved'; passNumber: number }
  | { type: 'refinement-complete'; summary: RefinementSummary };

export type RefinementEventHandler = (event: RefinementEvent) => void;

// ============================================================================
// CHECKPOINT TYPES
// ============================================================================

/**
 * Checkpoint for recovery
 */
export interface RefinementCheckpoint {
  /** Chunk index being processed */
  chunkIndex: number;
  
  /** Pass number */
  passNumber: number;
  
  /** Current mode */
  mode: RefinementMode;
  
  /** Data state (compressed so far) */
  dataState: Uint8Array;
  
  /** Passes completed */
  passResults: PassResult[];
  
  /** Timestamp */
  timestamp: number;
  
  /** Memory state for resume */
  memorySnapshot: {
    rangeCoderState?: RangeCoderState;
    huffmanCodes?: HuffmanCode[];
    dictionarySize?: number;
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Determine quality tier from compression ratio
 */
export function assessQuality(ratio: number, entropy: number): QualityTier {
  // Calculate expected ratio from entropy
  const expectedRatio = entropy; // Simplified: entropy ~= expected ratio
  const performance = ratio / expectedRatio;

  if (performance <= 1.05) return 'optimal';     // Within 5% of theoretical
  if (performance <= 1.15) return 'good';        // Within 15%
  if (performance <= 1.30) return 'acceptable';  // Within 30%
  if (ratio < 0.95) return 'poor';               // Some compression achieved
  return 'uncompressible';
}

/**
 * Get human-readable mode name
 */
export function getModeName(mode: RefinementMode): RefinementModeName {
  switch (mode) {
    case 'mode-a': return 'range-coder';
    case 'mode-b': return 'huffman-rebalance';
    case 'mode-c': return 'structural';
    case 'mode-d': return 'skip';
    default: return 'skip';
  }
}

/**
 * Estimate memory requirement for a mode
 */
export function estimateModeMemory(
  mode: RefinementMode,
  dataSize: number,
  config: RefinementEngineConfig
): number {
  const baseMemory = dataSize * 2; // Input + output buffer

  switch (mode) {
    case 'mode-a': // Range coder
      // Frequency table + state
      return baseMemory + 256 * 4 * (config.rangeCoder.contextOrder + 1) + 1024;
    
    case 'mode-b': // Huffman
      // Tree + code table
      return baseMemory + 256 * 16 + 256 * 8;
    
    case 'mode-c': // Structural
      // Dictionary + pattern buffer
      return baseMemory + config.structural.maxDictionarySize + 
             config.structural.maxPatternLength * 1000;
    
    case 'mode-d': // Skip
      return 0;
    
    default:
      return baseMemory;
  }
}

/**
 * Check if refinement would be worthwhile
 */
export function isRefinementWorthwhile(
  currentRatio: number,
  entropy: number,
  dataSize: number
): boolean {
  // Don't refine if already near theoretical limit
  if (currentRatio <= entropy * 1.05) return false;
  
  // Don't refine tiny data
  if (dataSize < 1024) return false;
  
  // Don't refine high entropy data
  if (entropy > 0.95) return false;
  
  // Check potential savings
  const potentialSavings = dataSize * (currentRatio - entropy);
  return potentialSavings > 100; // At least 100 bytes savings
}

/**
 * Select best mode for given entropy characteristics
 */
export function selectModeForEntropy(
  analysis: EntropyAnalysis,
  structuralAnalysis: StructuralAnalysis
): RefinementMode {
  // High pattern coverage = structural reduction
  if (structuralAnalysis.patternCoverage > 0.3 && structuralAnalysis.recommended) {
    return 'mode-c';
  }

  // Low entropy with patterns = Huffman good
  if (analysis.shannon < 0.5 && analysis.patternFrequency > 0.2) {
    return 'mode-b';
  }

  // Medium entropy = Range coder
  if (analysis.shannon >= 0.3 && analysis.shannon <= 0.8) {
    return 'mode-a';
  }

  // Very low entropy = structural
  if (analysis.shannon < 0.3) {
    return 'mode-c';
  }

  // High entropy = skip
  if (analysis.shannon > 0.85) {
    return 'mode-d';
  }

  return 'mode-a'; // Default to range coder
}
