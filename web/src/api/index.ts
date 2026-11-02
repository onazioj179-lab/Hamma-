/**
 * SPK V44 - Unified API Module Exports
 * Central export point for all API components
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // Base IDs
  JobId,
  FileId,
  ChunkId,
  TokenId,
  HistoryId,
  
  // Result types
  ApiResult,
  ApiError,
  ErrorCode,
  RecoveryInstruction,
  RecoveryAction,
  
  // Compression types
  CompressionOptions,
  CompressionProgress,
  CompressionResult,
  CompressionState,
  CompressionJob,
  CompressionQuality,
  FileEntry,
  
  // Decompression types
  DecompressionProgress,
  DecompressionResult,
  DecompressionState,
  DecompressionJob,
  ExtractedFile,
  
  // Archive types
  ArchiveManifest,
  ArchiveMetadata,
  ManifestEntry,
  ManifestSummary,
  DirectoryNode,
  FileThumbnail,
  
  // Sharing types
  ShareToken,
  SharedArchiveExport,
  TokenVerification,
  
  // History types
  JobHistoryRecord,
  HistoryQueryOptions,
  
  // Security types
  EncryptionOptions,
  EncryptionResult,
  IntegrityResult,
  
  // Telemetry types
  TelemetryPacket,
  TelemetryPayload,
  ProgressTelemetry,
  SpeedTelemetry,
  MemoryTelemetry,
  ErrorTelemetry,
  StateChangeTelemetry,
  
  // Platform types
  PlatformCapabilities,
  ApiConfig as TypesApiConfig,
} from './types';

// ============================================================================
// State Machines
// ============================================================================

export {
  StateMachine,
  createCompressionStateMachine,
  createDecompressionStateMachine,
  createSharingStateMachine,
  createHistoryStateMachine,
  getRecoveryAction,
  COMPRESSION_STATE_MACHINE,
  DECOMPRESSION_STATE_MACHINE,
  SHARING_STATE_MACHINE,
  HISTORY_STATE_MACHINE,
  COMPRESSION_STATE_INFO,
  DECOMPRESSION_STATE_INFO,
} from './state-machine';

export type {
  StateTransition,
  StateMachineConfig,
  StateTransitionRule,
  StateCallback,
  StateInfo,
  CompressionEvent,
  DecompressionEvent,
  SharingState,
  SharingEvent,
  HistoryState,
  HistoryEvent,
} from './state-machine';

// ============================================================================
// Recovery
// ============================================================================

export { RecoveryManager } from './recovery';
export type { JobCheckpoint, RecoveryStrategy } from './recovery';

// ============================================================================
// Coordinator Events
// ============================================================================

export {
  SimpleEventEmitter,
  createCoordinatorEvent,
  isCoordinatorEvent,
  isEventType,
} from './coordinator-events';

export type {
  CoordinatorEventType,
  CoordinatorEvent,
  CoordinatorPayloadMap,
  CoordinatorEventHandler,
  CoordinatorEventEmitter,
  // Event payloads
  CoordinatorReadyPayload,
  CoordinatorShutdownPayload,
  JobCreatedPayload,
  JobStartedPayload,
  JobPausedPayload,
  JobResumedPayload,
  JobCancelledPayload,
  JobCompletedPayload,
  JobFailedPayload,
  StateChangedPayload,
  ProgressUpdatedPayload,
  ChunkQueuedPayload,
  ChunkProcessingPayload,
  ChunkCompletedPayload,
  ChunkFailedPayload,
  WorkerSpawnedPayload,
  WorkerReadyPayload,
  WorkerBusyPayload,
  WorkerIdlePayload,
  WorkerTerminatedPayload,
  WorkerCrashedPayload,
  MemoryWarningPayload,
  MemoryCriticalPayload,
  BufferAllocatedPayload,
  BufferReleasedPayload,
  TelemetryPayload as CoordinatorTelemetryPayload,
  RecoveryStartedPayload,
  RecoveryCompletedPayload,
  RecoveryFailedPayload,
  CheckpointCreatedPayload,
  CheckpointRestoredPayload,
} from './coordinator-events';

// ============================================================================
// API Implementation
// ============================================================================

export {
  SingularityPackAPI,
  createSingularityPackAPI,
  getApiInstance,
} from './implementation';
export type { ApiConfig } from './implementation';

// ============================================================================
// Test Scenarios
// ============================================================================

export {
  ALL_TEST_SCENARIOS,
  SCENARIO_1TB_COMPRESSION,
  SCENARIO_5TB_COMPRESSION,
  SCENARIO_10TB_COMPRESSION,
  SCENARIO_SELECTIVE_EXTRACTION,
  SCENARIO_ENCRYPTED_ARCHIVE,
  SCENARIO_RECOVERY,
  getScenariosByCategory,
  getScenarioById,
} from './test-scenarios';

export type {
  TestScenario,
  TestCategory,
  TestInputSize,
  TestDuration,
  TestSetup,
  TestStep,
  TestAction,
  TestAssertion,
  AssertionType,
  AssertionOperator,
  TestCleanup,
  TestRunResult,
  StepResult,
  AssertionResult,
  TestMetrics,
} from './test-scenarios';
