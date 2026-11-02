/**
 * SPK V45 - Runtime Type Interfaces
 * Complete TypeScript runtime interfaces for Unified API
 * 
 * This module provides type-safe communication between:
 * - Frontend UI
 * - Coordinator (orchestration layer)
 * - Workers (parallel processing)
 * - WASM Engine (compression core)
 */

// ============================================================================
// Core Types (Part 1)
// ============================================================================
export {
  // File references
  type FileReference,
  type FileSourceType,
  createFileReference,
  // Compression options
  type CompressionOptions,
  type CompressionMode,
  createCompressionOptions,
  // Compression request/result
  type CompressionStartRequest,
  type CompressionResult,
  // Decompression
  type DecompressionRequest,
  type ArchiveInfo,
  type ExtractionOptions,
  type ExtractedFile,
} from './core-types';

// ============================================================================
// Progress & Telemetry Types (Part 2)
// ============================================================================
export {
  // Progress events
  type ProgressEvent,
  type DetailedProgressEvent,
  type ProgressPhase,
  // Telemetry
  type ThroughputTelemetry,
  type DetailedThroughputTelemetry,
  type WorkerLoad,
  type WorkerStatus,
  type WorkerState,
  type SystemTelemetry,
  type CoordinatorState,
  type TelemetryUpdate,
  // Utilities
  createProgressEvent,
  createDetailedProgressEvent,
  calculateThroughput,
  formatProgress,
  formatEta,
  formatBytes,
  formatSpeed,
} from './progress-types';

// ============================================================================
// Worker Message Interfaces (Part 3)
// ============================================================================
export {
  // Worker → Coordinator
  type WorkerMessage,
  type WorkerWasmReadyMessage,
  type WorkerChunkProcessedMessage,
  type WorkerProgressMessage,
  type WorkerFlushCompleteMessage,
  type WorkerFinalizeCompleteMessage,
  type WorkerErrorMessage,
  type WorkerStatusMessage,
  type WorkerMemoryWarningMessage,
  // Coordinator → Worker
  type CoordinatorMessage,
  type CoordinatorInitWasmMessage,
  type CoordinatorProcessChunkMessage,
  type CoordinatorFlushMessage,
  type CoordinatorFinalizeMessage,
  type CoordinatorCancelMessage,
  type CoordinatorResetMessage,
  type CoordinatorConfigureMessage,
  // Utilities
  type WorkerErrorCode,
  type WorkerMessageState,
  WorkerMessageGuards,
  CoordinatorMessageGuards,
  createWorkerError,
  WORKER_MESSAGE_TYPES,
  COORDINATOR_MESSAGE_TYPES,
} from './worker-messages';

// ============================================================================
// WASM Interface Definitions (Part 4)
// ============================================================================
export {
  // Core interfaces
  type WasmCompressionCore,
  type WasmCompressionCoreWithDedup,
  type WasmBufferPool,
  type WasmBufferHandle,
  type WasmModuleLoader,
  type WasmCapabilities,
  // Detection
  detectWasmCapabilities,
  // Error codes
  WASM_ERROR_CODES,
  type WasmErrorCode,
  getWasmErrorMessage,
  // Memory rules
  MEMORY_RULES,
  alignSize,
} from './wasm-interface';

// ============================================================================
// Manifest + Chunk Table Types (Part 5)
// ============================================================================
export {
  // Chunk types
  type ChunkInfo,
  type CompressionAlgorithm,
  type ChunkTable,
  type ChunkTableEntry,
  CHUNK_FLAGS,
  // File types
  type FileEntry,
  type FileAttributes,
  type DirectoryEntry,
  // Manifest types
  type Manifest,
  type ManifestSummary,
  type EncryptionMethod,
  type ManifestStats,
  type ManifestValidationResult,
  // Utilities
  createEmptyManifest,
  createEmptySummary,
  calculateManifestStats,
  validateManifest,
  findFileByPath,
  findFileById,
  getChunksForFile,
  listFilesInDirectory,
} from './manifest-types';

// ============================================================================
// Error Contract (Part 6)
// ============================================================================
export {
  // Error types
  type SPKError,
  type SPKErrorCode,
  type ErrorCategory,
  type RecoveryAction,
  ERROR_DETAILS,
  // Factory functions
  createSPKError,
  wrapError,
  isRecoverable,
  getRecoveryAction,
  isSPKError,
  // Result type
  type SPKResult,
  success,
  failure,
  fail,
  unwrap,
  unwrapOr,
  mapResult,
  andThen,
  // Aggregate errors
  type AggregateError,
  createAggregateError,
  hasRecoverableErrors,
  getFirstRecoverableError,
} from './error-contract';

// ============================================================================
// Unified API Signatures (Part 7)
// ============================================================================
export {
  // Main interface
  type SPK,
  type SPKConfig,
  type CreateSPK,
  DEFAULT_CONFIG,
  mergeConfig,
  // Callbacks
  type ProgressCallback,
  type TelemetryCallback,
  // Sharing
  type ShareOptions,
  type ShareResult,
  type ShareInfo,
  // History
  type HistoryEntry,
  // Security
  type IntegrityReport,
  // Diagnostics
  type DiagnosticsReport,
  type MemoryUsage,
  type BrowserCapabilities,
  // Events
  type SPKEvent,
  type SPKEventCallback,
} from './spk-interface';

// ============================================================================
// Version Information
// ============================================================================
export const V45_VERSION = '45.0.0';
export const V45_CODENAME = 'Runtime Interfaces';
export const V45_DESCRIPTION = 'Complete TypeScript runtime interfaces for Unified API';
