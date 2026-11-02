/**
 * SPK V44 - Pipeline Coordinator Events
 * Event interfaces for pipeline coordination
 */

import type {
  JobId,
  ChunkId,
  CompressionProgress,
  DecompressionProgress,
  CompressionState,
  DecompressionState,
  ApiError,
  TelemetryPacket,
} from './types';

// ============================================================================
// Coordinator Event Types
// ============================================================================

/**
 * All coordinator event types
 */
export type CoordinatorEventType =
  // Lifecycle
  | 'COORDINATOR_READY'
  | 'COORDINATOR_SHUTDOWN'
  // Job events
  | 'JOB_CREATED'
  | 'JOB_STARTED'
  | 'JOB_PAUSED'
  | 'JOB_RESUMED'
  | 'JOB_CANCELLED'
  | 'JOB_COMPLETED'
  | 'JOB_FAILED'
  // State events
  | 'STATE_CHANGED'
  // Progress events
  | 'PROGRESS_UPDATED'
  | 'CHUNK_QUEUED'
  | 'CHUNK_PROCESSING'
  | 'CHUNK_COMPLETED'
  | 'CHUNK_FAILED'
  // Worker events
  | 'WORKER_SPAWNED'
  | 'WORKER_READY'
  | 'WORKER_BUSY'
  | 'WORKER_IDLE'
  | 'WORKER_TERMINATED'
  | 'WORKER_CRASHED'
  // Memory events
  | 'MEMORY_WARNING'
  | 'MEMORY_CRITICAL'
  | 'BUFFER_ALLOCATED'
  | 'BUFFER_RELEASED'
  // Telemetry events
  | 'TELEMETRY'
  // Recovery events
  | 'RECOVERY_STARTED'
  | 'RECOVERY_COMPLETED'
  | 'RECOVERY_FAILED'
  | 'CHECKPOINT_CREATED'
  | 'CHECKPOINT_RESTORED';

/**
 * Base coordinator event structure
 */
export interface CoordinatorEvent<T extends CoordinatorEventType = CoordinatorEventType> {
  type: T;
  timestamp: number;
  payload: CoordinatorPayloadMap[T];
}

/**
 * Payload type mapping for coordinator events
 */
export interface CoordinatorPayloadMap {
  // Lifecycle
  COORDINATOR_READY: CoordinatorReadyPayload;
  COORDINATOR_SHUTDOWN: CoordinatorShutdownPayload;
  
  // Job events
  JOB_CREATED: JobCreatedPayload;
  JOB_STARTED: JobStartedPayload;
  JOB_PAUSED: JobPausedPayload;
  JOB_RESUMED: JobResumedPayload;
  JOB_CANCELLED: JobCancelledPayload;
  JOB_COMPLETED: JobCompletedPayload;
  JOB_FAILED: JobFailedPayload;
  
  // State events
  STATE_CHANGED: StateChangedPayload;
  
  // Progress events
  PROGRESS_UPDATED: ProgressUpdatedPayload;
  CHUNK_QUEUED: ChunkQueuedPayload;
  CHUNK_PROCESSING: ChunkProcessingPayload;
  CHUNK_COMPLETED: ChunkCompletedPayload;
  CHUNK_FAILED: ChunkFailedPayload;
  
  // Worker events
  WORKER_SPAWNED: WorkerSpawnedPayload;
  WORKER_READY: WorkerReadyPayload;
  WORKER_BUSY: WorkerBusyPayload;
  WORKER_IDLE: WorkerIdlePayload;
  WORKER_TERMINATED: WorkerTerminatedPayload;
  WORKER_CRASHED: WorkerCrashedPayload;
  
  // Memory events
  MEMORY_WARNING: MemoryWarningPayload;
  MEMORY_CRITICAL: MemoryCriticalPayload;
  BUFFER_ALLOCATED: BufferAllocatedPayload;
  BUFFER_RELEASED: BufferReleasedPayload;
  
  // Telemetry
  TELEMETRY: TelemetryPayload;
  
  // Recovery events
  RECOVERY_STARTED: RecoveryStartedPayload;
  RECOVERY_COMPLETED: RecoveryCompletedPayload;
  RECOVERY_FAILED: RecoveryFailedPayload;
  CHECKPOINT_CREATED: CheckpointCreatedPayload;
  CHECKPOINT_RESTORED: CheckpointRestoredPayload;
}

// ============================================================================
// Lifecycle Payloads
// ============================================================================

export interface CoordinatorReadyPayload {
  workerCount: number;
  wasmVersion: string;
  capabilities: {
    maxMemoryMB: number;
    simdEnabled: boolean;
    threadsEnabled: boolean;
    maxConcurrentJobs: number;
  };
}

export interface CoordinatorShutdownPayload {
  reason: 'user' | 'error' | 'idle';
  activeJobs: JobId[];
  pendingCleanup: boolean;
}

// ============================================================================
// Job Payloads
// ============================================================================

export interface JobCreatedPayload {
  jobId: JobId;
  type: 'compression' | 'decompression';
  totalBytes: number;
  totalFiles: number;
  options: Record<string, unknown>;
}

export interface JobStartedPayload {
  jobId: JobId;
  startTime: number;
  workersAssigned: number;
  estimatedDuration: number;
}

export interface JobPausedPayload {
  jobId: JobId;
  bytesProcessed: number;
  chunksCompleted: number;
  canResume: boolean;
}

export interface JobResumedPayload {
  jobId: JobId;
  resumeTime: number;
  remainingBytes: number;
  remainingChunks: number;
}

export interface JobCancelledPayload {
  jobId: JobId;
  reason: 'user' | 'error' | 'timeout';
  bytesProcessed: number;
  chunksCompleted: number;
  canRecover: boolean;
}

export interface JobCompletedPayload {
  jobId: JobId;
  type: 'compression' | 'decompression';
  totalBytes: number;
  resultBytes: number;
  duration: number;
  throughput: number;
  ratio?: number;
}

export interface JobFailedPayload {
  jobId: JobId;
  error: ApiError;
  bytesProcessed: number;
  chunksCompleted: number;
  canRecover: boolean;
}

// ============================================================================
// State Payloads
// ============================================================================

export interface StateChangedPayload {
  jobId: JobId;
  previousState: CompressionState | DecompressionState;
  newState: CompressionState | DecompressionState;
  trigger: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Progress Payloads
// ============================================================================

export interface ProgressUpdatedPayload {
  jobId: JobId;
  progress: CompressionProgress | DecompressionProgress;
}

export interface ChunkQueuedPayload {
  jobId: JobId;
  chunkId: ChunkId;
  chunkIndex: number;
  size: number;
  priority: number;
}

export interface ChunkProcessingPayload {
  jobId: JobId;
  chunkId: ChunkId;
  chunkIndex: number;
  workerId: number;
  startTime: number;
}

export interface ChunkCompletedPayload {
  jobId: JobId;
  chunkId: ChunkId;
  chunkIndex: number;
  workerId: number;
  inputSize: number;
  outputSize: number;
  processingTime: number;
  ratio: number;
}

export interface ChunkFailedPayload {
  jobId: JobId;
  chunkId: ChunkId;
  chunkIndex: number;
  workerId: number;
  error: ApiError;
  retryable: boolean;
  retryCount: number;
}

// ============================================================================
// Worker Payloads
// ============================================================================

export interface WorkerSpawnedPayload {
  workerId: number;
  startTime: number;
}

export interface WorkerReadyPayload {
  workerId: number;
  capabilities: {
    simd: boolean;
    threads: boolean;
    maxMemory: number;
  };
}

export interface WorkerBusyPayload {
  workerId: number;
  jobId: JobId;
  chunkId: ChunkId;
  queueDepth: number;
}

export interface WorkerIdlePayload {
  workerId: number;
  idleSince: number;
  totalProcessed: number;
}

export interface WorkerTerminatedPayload {
  workerId: number;
  reason: 'idle' | 'shutdown' | 'error';
  totalProcessed: number;
  totalTime: number;
}

export interface WorkerCrashedPayload {
  workerId: number;
  error: ApiError;
  lastJob?: JobId;
  lastChunk?: ChunkId;
  canRestart: boolean;
}

// ============================================================================
// Memory Payloads
// ============================================================================

export interface MemoryWarningPayload {
  usedMB: number;
  totalMB: number;
  percentUsed: number;
  recommendation: 'reduce_parallelism' | 'reduce_chunk_size' | 'clear_cache';
}

export interface MemoryCriticalPayload {
  usedMB: number;
  totalMB: number;
  percentUsed: number;
  action: 'pause_jobs' | 'terminate_workers' | 'emergency_gc';
}

export interface BufferAllocatedPayload {
  bufferId: string;
  size: number;
  purpose: 'input' | 'output' | 'temp';
  totalAllocated: number;
}

export interface BufferReleasedPayload {
  bufferId: string;
  size: number;
  totalAllocated: number;
}

// ============================================================================
// Telemetry Payload
// ============================================================================

export interface TelemetryPayload {
  packet: TelemetryPacket;
}

// ============================================================================
// Recovery Payloads
// ============================================================================

export interface RecoveryStartedPayload {
  jobId: JobId;
  strategy: string;
  attemptNumber: number;
  chunksToRecover: number;
}

export interface RecoveryCompletedPayload {
  jobId: JobId;
  strategy: string;
  attemptNumber: number;
  chunksRecovered: number;
  bytesRecovered: number;
  duration: number;
}

export interface RecoveryFailedPayload {
  jobId: JobId;
  strategy: string;
  attemptNumber: number;
  error: ApiError;
  canRetry: boolean;
}

export interface CheckpointCreatedPayload {
  jobId: JobId;
  checkpointId: string;
  bytesProcessed: number;
  chunksCompleted: number;
  timestamp: number;
}

export interface CheckpointRestoredPayload {
  jobId: JobId;
  checkpointId: string;
  bytesProcessed: number;
  chunksCompleted: number;
  restoredAt: number;
}

// ============================================================================
// Event Emitter Interface
// ============================================================================

/**
 * Coordinator event handler type
 */
export type CoordinatorEventHandler<T extends CoordinatorEventType> = (
  event: CoordinatorEvent<T>
) => void;

/**
 * Coordinator event emitter interface
 */
export interface CoordinatorEventEmitter {
  /**
   * Subscribe to a specific event type
   */
  on<T extends CoordinatorEventType>(
    type: T,
    handler: CoordinatorEventHandler<T>
  ): () => void;

  /**
   * Subscribe to all events
   */
  onAny(handler: (event: CoordinatorEvent) => void): () => void;

  /**
   * Unsubscribe from a specific event type
   */
  off<T extends CoordinatorEventType>(
    type: T,
    handler: CoordinatorEventHandler<T>
  ): void;

  /**
   * Emit an event
   */
  emit<T extends CoordinatorEventType>(
    type: T,
    payload: CoordinatorPayloadMap[T]
  ): void;
}

// ============================================================================
// Event Utilities
// ============================================================================

/**
 * Create a typed coordinator event
 */
export function createCoordinatorEvent<T extends CoordinatorEventType>(
  type: T,
  payload: CoordinatorPayloadMap[T]
): CoordinatorEvent<T> {
  return {
    type,
    timestamp: Date.now(),
    payload,
  };
}

/**
 * Type guard for coordinator events
 */
export function isCoordinatorEvent(obj: unknown): obj is CoordinatorEvent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    'timestamp' in obj &&
    'payload' in obj
  );
}

/**
 * Type guard for specific event types
 */
export function isEventType<T extends CoordinatorEventType>(
  event: CoordinatorEvent,
  type: T
): event is CoordinatorEvent<T> {
  return event.type === type;
}

/**
 * Simple event emitter implementation
 */
export class SimpleEventEmitter implements CoordinatorEventEmitter {
  private handlers = new Map<CoordinatorEventType, Set<CoordinatorEventHandler<CoordinatorEventType>>>();
  private anyHandlers = new Set<(event: CoordinatorEvent) => void>();

  on<T extends CoordinatorEventType>(
    type: T,
    handler: CoordinatorEventHandler<T>
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as CoordinatorEventHandler<CoordinatorEventType>);
    
    return () => this.off(type, handler);
  }

  onAny(handler: (event: CoordinatorEvent) => void): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  off<T extends CoordinatorEventType>(
    type: T,
    handler: CoordinatorEventHandler<T>
  ): void {
    this.handlers.get(type)?.delete(handler as CoordinatorEventHandler<CoordinatorEventType>);
  }

  emit<T extends CoordinatorEventType>(
    type: T,
    payload: CoordinatorPayloadMap[T]
  ): void {
    const event = createCoordinatorEvent(type, payload);
    
    // Type-specific handlers
    this.handlers.get(type)?.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        console.error(`Error in event handler for ${type}:`, err);
      }
    });
    
    // Any handlers
    this.anyHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        console.error('Error in any event handler:', err);
      }
    });
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}
