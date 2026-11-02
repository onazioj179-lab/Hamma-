/**
 * SPK Dynamic Redundancy Detection Engine - Types
 * Creator: OJ Treasure Onazi
 * 
 * Type definitions for redundancy detection, chunk signatures,
 * and cross-file pattern analysis.
 */

// ============================================================================
// SIZE CONSTANTS
// ============================================================================

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

// ============================================================================
// CHUNK SIGNATURE
// ============================================================================

/**
 * Signature generated from chunk binary structure
 * No user content is stored - only mathematical transforms
 */
export interface ChunkSignature {
  /** Chunk index in archive */
  index: number;
  
  /** Fast non-content hash (rolling checksum) - number for fast comparison */
  hash: number;
  
  /** Binary entropy score (0.0 - 1.0) */
  entropy: number;
  
  /** Byte distribution histogram (256 bins compressed to 128) */
  histogram: Uint8Array;
  
  /** Original chunk size */
  size: number;
  
  /** Timestamp for sliding window eviction */
  timestamp: number;
  
  /** File ID for cross-file detection */
  fileId?: string;
  
  /** Rolling checksum for similarity detection */
  rollingChecksum: number;
  
  /** Block pattern fingerprint */
  fingerprint: string;
}

// ============================================================================
// HASH BUCKET (for redundancy map)
// ============================================================================

export interface HashBucket {
  /** Signatures in this bucket */
  signatures: ChunkSignature[];
  
  /** Bucket hash key */
  key: number;
  
  /** Last access time */
  lastAccess: number;
}

// ============================================================================
// ENTROPY LEVEL (numeric classification)
// ============================================================================

export type EntropyLevel = 0 | 1 | 2 | 3 | 4; // Maps to EntropyClass

// ============================================================================
// STRUCTURAL HINT
// ============================================================================

export type StructuralHint = 
  | 'repetitive'    // Highly repetitive data
  | 'sequential'    // Sequential patterns
  | 'random'        // Near-random data
  | 'mixed'         // Mixed patterns
  | 'structured';   // Structured format

// ============================================================================
// REDUNDANCY CLASSIFICATION
// ============================================================================

export type RedundancyClass = 
  | 'duplicate'      // Exact match found
  | 'near-duplicate' // Very similar (>95% match)
  | 'similar'        // Structural similarity (>70% match)
  | 'related'        // Partial patterns shared (>40% match)
  | 'unique';        // No significant matches

export type EntropyClass =
  | 'very-low'    // < 0.2 - highly compressible
  | 'low'         // 0.2 - 0.4 - good compression
  | 'medium'      // 0.4 - 0.6 - moderate compression
  | 'high'        // 0.6 - 0.8 - limited compression
  | 'very-high';  // > 0.8 - near-random data

export type CompressionMode =
  | 'skip'        // Identical chunk exists
  | 'fast'        // Quick compression for duplicates
  | 'structural'  // Pattern-aware compression
  | 'lightweight' // Low-entropy optimization
  | 'strong'      // Full compression for high-entropy
  | 'multi-pass'  // Multiple refinement passes
  | 'auto';       // Let AI decide

// ============================================================================
// REDUNDANCY MAP
// ============================================================================

export interface RedundancyMap {
  /** Hash buckets for fast duplicate lookup (number hash -> signatures) */
  hashBuckets: Map<number, ChunkSignature[]>;
  
  /** Fingerprint buckets for similarity detection */
  fingerprintBuckets: Map<string, ChunkSignature[]>;
  
  /** Low entropy chunks (< 0.4) */
  lowEntropyList: ChunkSignature[];
  
  /** High entropy chunks (> 0.6) */
  highEntropyList: ChunkSignature[];
  
  /** Cross-file pattern groups */
  patternGroups: Map<string, Set<string>>; // pattern -> fileIds
  
  /** Global statistics */
  stats: RedundancyStats;
}

export interface RedundancyStats {
  totalChunks: number;
  duplicateChunks: number;
  similarChunks: number;
  uniqueChunks: number;
  averageEntropy: number;
  entropyTrend: number[]; // Rolling average
  bytesProcessed: bigint;
  bytesSaved: bigint;
  compressionFamilies: number;
}

// ============================================================================
// RECOMMENDATION OUTPUT
// ============================================================================

export interface ChunkRecommendation {
  /** Recommended compression mode */
  chunkMode: CompressionMode;
  
  /** Predicted compression ratio (0.0 - 1.0) */
  predictedRatio: number;
  
  /** Redundancy score (0.0 - 1.0, higher = more redundant) */
  redundancyScore: number;
  
  /** Structural hint for optimizer */
  structuralHint: RedundancyClass;
  
  /** Entropy classification */
  entropyClass: EntropyClass;
  
  /** Reference to matching chunk if duplicate/similar */
  matchReference?: {
    chunkIndex: number;
    fileId?: string;
    similarity: number;
  };
  
  /** Suggested number of refinement passes */
  refinementPasses: number;
  
  /** Memory estimate for compression */
  memoryEstimate: number;
}

// ============================================================================
// ENGINE CONFIGURATION
// ============================================================================

export interface RedundancyEngineConfig {
  /** Maximum signatures to keep in memory */
  maxSignatures: number;
  
  /** Sliding window size for recent signatures */
  windowSize: number;
  
  /** Hash similarity threshold for near-duplicates */
  similarityThreshold: number;
  
  /** Entropy threshold for mode switching */
  entropyThresholds: {
    veryLow: number;
    low: number;
    medium: number;
    high: number;
  };
  
  /** Enable cross-file detection */
  crossFileDetection: boolean;
  
  /** Memory limit in bytes */
  memoryLimit: number;
  
  /** Histogram bin count (default 128) */
  histogramBins: number;
  
  /** Rolling checksum window size */
  checksumWindow: number;
  
  /** Fingerprint block size */
  fingerprintBlockSize: number;
  
  /** Enable pattern learning */
  patternLearning: boolean;
  
  /** Eviction policy */
  evictionPolicy: 'lru' | 'entropy' | 'hybrid';
}

export const DEFAULT_REDUNDANCY_CONFIG: RedundancyEngineConfig = {
  maxSignatures: 10000,
  windowSize: 5000,
  similarityThreshold: 0.85,
  entropyThresholds: {
    veryLow: 0.2,
    low: 0.4,
    medium: 0.6,
    high: 0.8,
  },
  crossFileDetection: true,
  memoryLimit: 50 * MB,
  histogramBins: 128,
  checksumWindow: 64,
  fingerprintBlockSize: 256,
  patternLearning: true,
  evictionPolicy: 'hybrid',
};

// ============================================================================
// PATTERN ANALYSIS
// ============================================================================

export interface PatternAnalysis {
  /** Detected pattern type */
  type: 'repeating' | 'sequential' | 'random' | 'structured';
  
  /** Pattern period (for repeating patterns) */
  period: number;
  
  /** Pattern strength (0.0 - 1.0) */
  strength: number;
  
  /** Detected block boundaries */
  blockBoundaries: number[];
  
  /** Compression family suggestion */
  compressionFamily: string;
}

// ============================================================================
// CROSS-FILE STRUCTURES
// ============================================================================

export interface FilePattern {
  fileId: string;
  fileName?: string;
  chunkCount: number;
  averageEntropy: number;
  dominantPattern: string;
  relatedFiles: string[];
  compressionHint: CompressionMode;
}

export interface CompressionFamily {
  id: string;
  name: string;
  fileIds: Set<string>;
  commonPatterns: string[];
  recommendedMode: CompressionMode;
  averageRatio: number;
  memberCount: number;
  /** Shared blocks between family members */
  sharedBlocks: SharedBlock[];
}

// ============================================================================
// SHARED BLOCK (for cross-file detection)
// ============================================================================

export interface SharedBlock {
  /** Hash of the block */
  hash: number;
  
  /** Block size in bytes */
  size: number;
  
  /** Files containing this block */
  fileIds: Set<string>;
  
  /** Indices map per file */
  indices: Map<string, number[]>;
  
  /** How many times this block appears */
  occurrenceCount: number;
  
  /** Entropy of the block */
  entropy: number;
}

// ============================================================================
// FILE RELATIONSHIP
// ============================================================================

export interface FileRelationship {
  /** Related file ID */
  fileId: string;
  
  /** Number of shared blocks */
  sharedBlocks: number;
  
  /** Similarity score (0-1) */
  similarity: number;
}

// ============================================================================
// CROSS-FILE ANALYSIS
// ============================================================================

export interface CrossFileAnalysis {
  /** File being analyzed */
  fileId: string;
  
  /** Number of chunks in file */
  chunkCount: number;
  
  /** Average entropy of file */
  averageEntropy: number;
  
  /** Number of blocks shared with other files */
  sharedBlocks: number;
  
  /** Total bytes shared */
  sharedBytes: bigint;
  
  /** Related files */
  relatedFiles: FileRelationship[];
  
  /** Compression family info */
  family?: {
    id: string;
    memberCount: number;
    recommendedMode: string;
  };
}

// ============================================================================
// SLIDING WINDOW CONFIG
// ============================================================================

export interface SlidingWindowConfig {
  /** Maximum signatures to keep */
  maxSignatures: number;
  
  /** Time-to-live for signatures (ms) */
  ttl: number;
  
  /** Eviction batch size */
  evictionBatch: number;
}

export const DEFAULT_SLIDING_WINDOW_CONFIG: SlidingWindowConfig = {
  maxSignatures: 10000,
  ttl: 60 * 60 * 1000, // 1 hour
  evictionBatch: 100,
};

// ============================================================================
// REDUNDANCY MAP CONFIG
// ============================================================================

export interface RedundancyMapConfig {
  /** Maximum hash buckets */
  maxBuckets: number;
  
  /** Bucket size limit */
  bucketLimit: number;
  
  /** Enable fingerprint matching */
  enableFingerprints: boolean;
}

export const DEFAULT_REDUNDANCY_MAP_CONFIG: RedundancyMapConfig = {
  maxBuckets: 10000,
  bucketLimit: 10,
  enableFingerprints: true,
};

// ============================================================================
// REDUNDANCY ADD RESULT
// ============================================================================

export interface RedundancyAddResult {
  /** Classification of the added signature */
  redundancyClass: RedundancyClass;
  
  /** Matching signature if found */
  matchingSignature?: ChunkSignature;
  
  /** Similarity score (0-1) */
  similarity: number;
  
  /** Whether signature was added (not evicted) */
  added: boolean;
}

// ============================================================================
// EVENTS
// ============================================================================

export type RedundancyEvent =
  | { type: 'duplicate-found'; index: number; matchIndex: number; savings: number }
  | { type: 'pattern-detected'; pattern: string; fileCount: number }
  | { type: 'family-created'; familyId: string; memberCount: number }
  | { type: 'entropy-shift'; from: EntropyClass; to: EntropyClass; trend: number }
  | { type: 'memory-pressure'; current: number; limit: number }
  | { type: 'eviction'; count: number; policy: string }
  | { type: 'model-updated'; accuracy: number };

export type RedundancyEventHandler = (event: RedundancyEvent) => void;

// ============================================================================
// UTILITIES
// ============================================================================

export function classifyEntropy(entropy: number): EntropyClass {
  if (entropy < 0.2) return 'very-low';
  if (entropy < 0.4) return 'low';
  if (entropy < 0.6) return 'medium';
  if (entropy < 0.8) return 'high';
  return 'very-high';
}

export function recommendMode(
  entropy: number,
  redundancy: RedundancyClass
): CompressionMode {
  // Skip identical chunks
  if (redundancy === 'duplicate') return 'skip';
  
  // Fast mode for near-duplicates
  if (redundancy === 'near-duplicate') return 'fast';
  
  // Structural mode for similar patterns
  if (redundancy === 'similar') return 'structural';
  
  // Entropy-based selection for unique chunks
  if (entropy < 0.2) return 'lightweight';
  if (entropy < 0.4) return 'fast';
  if (entropy < 0.6) return 'auto';
  if (entropy < 0.8) return 'strong';
  
  // High entropy needs strong compression
  return 'strong';
}

export function estimateRatio(
  entropy: number,
  redundancy: RedundancyClass
): number {
  // Duplicate = 100% savings
  if (redundancy === 'duplicate') return 0.01;
  if (redundancy === 'near-duplicate') return 0.1;
  if (redundancy === 'similar') return 0.3;
  
  // Entropy-based estimation
  if (entropy < 0.2) return 0.15;
  if (entropy < 0.4) return 0.25;
  if (entropy < 0.6) return 0.4;
  if (entropy < 0.8) return 0.6;
  
  // High entropy data compresses poorly
  return 0.85;
}
