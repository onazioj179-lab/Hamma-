/**
 * SPK Dynamic Redundancy Detection Engine - Module Index
 * Creator: OJ Treasure Onazi
 * 
 * Barrel exports for the redundancy detection module.
 */

// Types
export type {
  ChunkSignature,
  HashBucket,
  EntropyLevel,
  EntropyClass,
  StructuralHint,
  CompressionMode,
  RedundancyClass,
  ChunkRecommendation,
  PatternAnalysis,
  FilePattern,
  CompressionFamily,
  SharedBlock,
  FileRelationship,
  CrossFileAnalysis,
  SlidingWindowConfig,
  RedundancyMapConfig,
  RedundancyEngineConfig,
  RedundancyEvent,
  RedundancyEventHandler,
  RedundancyAddResult,
  RedundancyMap,
  RedundancyStats,
} from './types';

// Constants
export {
  KB,
  MB,
  GB,
  DEFAULT_SLIDING_WINDOW_CONFIG,
  DEFAULT_REDUNDANCY_MAP_CONFIG,
  DEFAULT_REDUNDANCY_CONFIG,
  classifyEntropy,
  recommendMode,
  estimateRatio,
} from './types';

// Signature Generator
export { SignatureGenerator, createSignatureGenerator } from './signature-generator';

// Redundancy Map
export { RedundancyMapManager, createRedundancyMapManager } from './redundancy-map';

// Cross-File Detector
export { CrossFileDetector, createCrossFileDetector } from './cross-file-detector';

// Main Engine
export { RedundancyEngine, createRedundancyEngine } from './redundancy-engine';
