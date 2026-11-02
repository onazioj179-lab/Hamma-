/**
 * SPK V46 - AI Optimization Module
 * AI-driven optimization layer for compression pipeline
 * 
 * SAFETY RULES:
 * 1. AI NEVER inspects or analyzes user file contents
 * 2. AI only uses metadata (sizes, speeds, timings)
 * 3. Compression remains 100% lossless and bit-perfect
 * 4. All optimization is optional and can be disabled
 * 5. If AI fails, pipeline falls back to deterministic defaults
 * 
 * PRIVACY:
 * - Training data is private and local only
 * - Never uploaded to any server
 * - Deletable by user via "Reset optimization data"
 */

// Types
export type {
  // Input signals
  AITelemetrySignals,
  HardwareProfile,
  HistoricalPerformance,
  FileTypeStats,
  // Output
  AIOptimizationOutput,
  AIRealTimeAdjustment,
  IOBufferStrategy,
  AdjustmentType,
  // State
  AIOptimizerState,
  AIStatus,
  AIConfig,
  // Training
  TrainingSample,
  JobOutcome,
  LocalTrainingData,
  AggregatedStats,
} from './types';

// Constants
export {
  DEFAULT_AI_CONFIG,
  FALLBACK_CONFIG,
  AI_SAFETY_CONSTRAINTS,
} from './types';

// Telemetry
export {
  TelemetryCollector,
  getTelemetryCollector,
  createFileTypeStats,
} from './telemetry';

// Prediction
export {
  PredictionEngine,
  getPredictionEngine,
} from './prediction';

// Training
export {
  TrainingDataStore,
  getTrainingDataStore,
} from './training';

// Optimizer
export {
  AIOptimizer,
  getAIOptimizer,
} from './optimizer';

// Integration
export {
  AICoordinatorIntegration,
  getAIIntegration,
} from './integration';

// React hooks
export {
  useAIOptimization,
  getAIStatusMessage,
  type AIOptimizationStatus,
  type AITrainingStats,
  type UseAIOptimizationReturn,
  type ProgressMetrics,
  type JobOutcome as HookJobOutcome,
} from './hooks';

// Version
export const AI_VERSION = '46.0.0';
export const AI_CODENAME = 'Intelligent Optimization';
