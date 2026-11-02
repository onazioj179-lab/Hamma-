/**
 * SPK Multi-Pass Entropy Refinement Engine - Module Index
 * Creator: OJ Treasure Onazi
 * 
 * Barrel exports for the entropy refinement module.
 */

// Types
export type {
  RefinementMode,
  RefinementModeName,
  PassStatus,
  QualityTier,
  EntropyAnalysis,
  ByteHistogram,
  PassDecision,
  PassResult,
  RefinementSummary,
  RangeCoderConfig,
  RangeCoderState,
  HuffmanNode,
  HuffmanCode,
  HuffmanConfig,
  HuffmanAnalysis,
  PatternType,
  StructuralPattern,
  StructuralConfig,
  StructuralAnalysis,
  PassControllerConfig,
  RefinementEngineConfig,
  RefinementEvent,
  RefinementEventHandler,
  RefinementCheckpoint,
} from './types';

// Constants
export {
  KB,
  MB,
  GB,
  DEFAULT_PASS_CONTROLLER_CONFIG,
  DEFAULT_RANGE_CODER_CONFIG,
  DEFAULT_HUFFMAN_CONFIG,
  DEFAULT_STRUCTURAL_CONFIG,
  DEFAULT_REFINEMENT_ENGINE_CONFIG,
  assessQuality,
  getModeName,
  estimateModeMemory,
  isRefinementWorthwhile,
  selectModeForEntropy,
} from './types';

// Pass Controller
export { EntropyPassController, createPassController } from './pass-controller';

// Range Coder (Mode A)
export { RangeCoder, createRangeCoder } from './range-coder';

// Huffman Rebalancer (Mode B)
export { HuffmanRebalancer, createHuffmanRebalancer } from './huffman-rebalancer';

// Structural Reducer (Mode C)
export { StructuralReducer, createStructuralReducer } from './structural-reducer';

// Main Engine
export { 
  RefinementEngine, 
  createRefinementEngine,
  createLiteRefinementEngine,
} from './refinement-engine';
