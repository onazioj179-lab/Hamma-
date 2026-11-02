/**
 * SPK V44 - State Machine Definitions
 * Deterministic state machines for all operations
 */

import type { 
  CompressionState, 
  DecompressionState,
  ApiError,
  RecoveryInstruction,
} from './types';

// ============================================================================
// State Machine Types
// ============================================================================

/**
 * State transition event
 */
export interface StateTransition<S extends string> {
  from: S;
  to: S;
  event: string;
  timestamp: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * State machine configuration
 */
export interface StateMachineConfig<S extends string, E extends string> {
  initialState: S;
  states: S[];
  transitions: StateTransitionRule<S, E>[];
  onEnter?: Partial<Record<S, StateCallback<S>>>;
  onExit?: Partial<Record<S, StateCallback<S>>>;
  onTransition?: (transition: StateTransition<S>) => void;
}

/**
 * State transition rule
 */
export interface StateTransitionRule<S extends string, E extends string> {
  from: S | S[];
  event: E;
  to: S;
  guard?: () => boolean;
  action?: () => void;
}

/**
 * State callback
 */
export type StateCallback<S extends string> = (state: S, metadata?: Record<string, unknown>) => void;

// ============================================================================
// Compression State Machine
// ============================================================================

/**
 * Compression events
 */
export type CompressionEvent =
  | 'START'
  | 'INIT_COMPLETE'
  | 'FILES_LOADED'
  | 'CHUNK_CREATED'
  | 'CHUNK_COMPRESSED'
  | 'ALL_CHUNKS_WRITTEN'
  | 'FINALIZED'
  | 'ERROR'
  | 'CANCEL'
  | 'PAUSE'
  | 'RESUME'
  | 'RECOVER';

/**
 * Compression state machine definition
 */
export const COMPRESSION_STATE_MACHINE: StateMachineConfig<CompressionState, CompressionEvent> = {
  initialState: 'idle',
  states: [
    'idle',
    'initializing',
    'reading',
    'chunking',
    'compressing',
    'writing',
    'finalizing',
    'completed',
    'failed',
    'cancelled',
  ],
  transitions: [
    // Normal flow
    { from: 'idle', event: 'START', to: 'initializing' },
    { from: 'initializing', event: 'INIT_COMPLETE', to: 'reading' },
    { from: 'reading', event: 'FILES_LOADED', to: 'chunking' },
    { from: 'chunking', event: 'CHUNK_CREATED', to: 'compressing' },
    { from: 'compressing', event: 'CHUNK_COMPRESSED', to: 'writing' },
    { from: 'writing', event: 'CHUNK_CREATED', to: 'compressing' }, // Loop for more chunks
    { from: 'writing', event: 'ALL_CHUNKS_WRITTEN', to: 'finalizing' },
    { from: 'finalizing', event: 'FINALIZED', to: 'completed' },
    
    // Error handling
    { from: ['initializing', 'reading', 'chunking', 'compressing', 'writing', 'finalizing'], event: 'ERROR', to: 'failed' },
    
    // Cancellation
    { from: ['initializing', 'reading', 'chunking', 'compressing', 'writing', 'finalizing'], event: 'CANCEL', to: 'cancelled' },
    
    // Recovery
    { from: 'failed', event: 'RECOVER', to: 'initializing' },
    { from: 'cancelled', event: 'START', to: 'initializing' },
    
    // Reset
    { from: ['completed', 'failed', 'cancelled'], event: 'START', to: 'initializing' },
  ],
};

/**
 * Compression state metadata
 */
export const COMPRESSION_STATE_INFO: Record<CompressionState, StateInfo> = {
  idle: {
    description: 'Ready to start compression',
    canPause: false,
    canCancel: false,
    canRecover: false,
    emitsProgress: false,
  },
  initializing: {
    description: 'Setting up compression context and workers',
    canPause: false,
    canCancel: true,
    canRecover: false,
    emitsProgress: true,
  },
  reading: {
    description: 'Reading input files',
    canPause: true,
    canCancel: true,
    canRecover: true,
    emitsProgress: true,
  },
  chunking: {
    description: 'Creating data chunks',
    canPause: true,
    canCancel: true,
    canRecover: true,
    emitsProgress: true,
  },
  compressing: {
    description: 'Compressing chunks',
    canPause: true,
    canCancel: true,
    canRecover: true,
    emitsProgress: true,
  },
  writing: {
    description: 'Writing compressed data',
    canPause: true,
    canCancel: true,
    canRecover: true,
    emitsProgress: true,
  },
  finalizing: {
    description: 'Finalizing archive and writing footer',
    canPause: false,
    canCancel: true,
    canRecover: true,
    emitsProgress: true,
  },
  completed: {
    description: 'Compression completed successfully',
    canPause: false,
    canCancel: false,
    canRecover: false,
    emitsProgress: false,
  },
  failed: {
    description: 'Compression failed',
    canPause: false,
    canCancel: false,
    canRecover: true,
    emitsProgress: false,
  },
  cancelled: {
    description: 'Compression cancelled by user',
    canPause: false,
    canCancel: false,
    canRecover: false,
    emitsProgress: false,
  },
};

// ============================================================================
// Decompression State Machine
// ============================================================================

/**
 * Decompression events
 */
export type DecompressionEvent =
  | 'OPEN'
  | 'HEADER_READ'
  | 'MANIFEST_PARSED'
  | 'EXTRACT_START'
  | 'CHUNK_EXTRACTED'
  | 'FILE_WRITTEN'
  | 'ALL_EXTRACTED'
  | 'ERROR'
  | 'CANCEL';

/**
 * Decompression state machine definition
 */
export const DECOMPRESSION_STATE_MACHINE: StateMachineConfig<DecompressionState, DecompressionEvent> = {
  initialState: 'idle',
  states: [
    'idle',
    'loading',
    'reading_index',
    'extracting',
    'writing_output',
    'completed',
    'failed',
  ],
  transitions: [
    // Normal flow
    { from: 'idle', event: 'OPEN', to: 'loading' },
    { from: 'loading', event: 'HEADER_READ', to: 'reading_index' },
    { from: 'reading_index', event: 'MANIFEST_PARSED', to: 'extracting' },
    { from: 'extracting', event: 'CHUNK_EXTRACTED', to: 'writing_output' },
    { from: 'writing_output', event: 'FILE_WRITTEN', to: 'extracting' }, // Loop
    { from: 'writing_output', event: 'ALL_EXTRACTED', to: 'completed' },
    { from: 'extracting', event: 'ALL_EXTRACTED', to: 'completed' },
    
    // Error handling
    { from: ['loading', 'reading_index', 'extracting', 'writing_output'], event: 'ERROR', to: 'failed' },
    
    // Reset
    { from: ['completed', 'failed'], event: 'OPEN', to: 'loading' },
  ],
};

/**
 * Decompression state metadata
 */
export const DECOMPRESSION_STATE_INFO: Record<DecompressionState, StateInfo> = {
  idle: {
    description: 'Ready to open archive',
    canPause: false,
    canCancel: false,
    canRecover: false,
    emitsProgress: false,
  },
  loading: {
    description: 'Loading archive file',
    canPause: false,
    canCancel: true,
    canRecover: false,
    emitsProgress: true,
  },
  reading_index: {
    description: 'Reading archive manifest',
    canPause: false,
    canCancel: true,
    canRecover: false,
    emitsProgress: true,
  },
  extracting: {
    description: 'Extracting compressed chunks',
    canPause: true,
    canCancel: true,
    canRecover: true,
    emitsProgress: true,
  },
  writing_output: {
    description: 'Writing decompressed files',
    canPause: true,
    canCancel: true,
    canRecover: true,
    emitsProgress: true,
  },
  completed: {
    description: 'Decompression completed successfully',
    canPause: false,
    canCancel: false,
    canRecover: false,
    emitsProgress: false,
  },
  failed: {
    description: 'Decompression failed',
    canPause: false,
    canCancel: false,
    canRecover: true,
    emitsProgress: false,
  },
};

// ============================================================================
// Sharing State Machine
// ============================================================================

/**
 * Sharing states
 */
export type SharingState =
  | 'idle'
  | 'preparing'
  | 'exporting'
  | 'encrypting'
  | 'generating_token'
  | 'uploading'
  | 'completed'
  | 'failed';

/**
 * Sharing events
 */
export type SharingEvent =
  | 'START_EXPORT'
  | 'ARCHIVE_READY'
  | 'ENCRYPTION_COMPLETE'
  | 'TOKEN_GENERATED'
  | 'UPLOAD_COMPLETE'
  | 'ERROR'
  | 'CANCEL';

/**
 * Sharing state machine definition
 */
export const SHARING_STATE_MACHINE: StateMachineConfig<SharingState, SharingEvent> = {
  initialState: 'idle',
  states: [
    'idle',
    'preparing',
    'exporting',
    'encrypting',
    'generating_token',
    'uploading',
    'completed',
    'failed',
  ],
  transitions: [
    // Normal flow
    { from: 'idle', event: 'START_EXPORT', to: 'preparing' },
    { from: 'preparing', event: 'ARCHIVE_READY', to: 'exporting' },
    { from: 'exporting', event: 'ARCHIVE_READY', to: 'encrypting' },
    { from: 'exporting', event: 'TOKEN_GENERATED', to: 'generating_token' }, // Skip encryption
    { from: 'encrypting', event: 'ENCRYPTION_COMPLETE', to: 'generating_token' },
    { from: 'generating_token', event: 'TOKEN_GENERATED', to: 'completed' },
    { from: 'generating_token', event: 'UPLOAD_COMPLETE', to: 'uploading' }, // Optional upload
    { from: 'uploading', event: 'UPLOAD_COMPLETE', to: 'completed' },
    
    // Error handling
    { from: ['preparing', 'exporting', 'encrypting', 'generating_token', 'uploading'], event: 'ERROR', to: 'failed' },
    
    // Reset
    { from: ['completed', 'failed'], event: 'START_EXPORT', to: 'preparing' },
  ],
};

// ============================================================================
// History State Machine
// ============================================================================

/**
 * History states
 */
export type HistoryState =
  | 'idle'
  | 'storing'
  | 'pruning'
  | 'retrieving'
  | 'completed'
  | 'failed';

/**
 * History events
 */
export type HistoryEvent =
  | 'STORE'
  | 'PRUNE'
  | 'RETRIEVE'
  | 'COMPLETE'
  | 'ERROR';

/**
 * History state machine definition
 */
export const HISTORY_STATE_MACHINE: StateMachineConfig<HistoryState, HistoryEvent> = {
  initialState: 'idle',
  states: ['idle', 'storing', 'pruning', 'retrieving', 'completed', 'failed'],
  transitions: [
    { from: 'idle', event: 'STORE', to: 'storing' },
    { from: 'idle', event: 'PRUNE', to: 'pruning' },
    { from: 'idle', event: 'RETRIEVE', to: 'retrieving' },
    { from: ['storing', 'pruning', 'retrieving'], event: 'COMPLETE', to: 'completed' },
    { from: ['storing', 'pruning', 'retrieving'], event: 'ERROR', to: 'failed' },
    { from: ['completed', 'failed'], event: 'STORE', to: 'storing' },
    { from: ['completed', 'failed'], event: 'PRUNE', to: 'pruning' },
    { from: ['completed', 'failed'], event: 'RETRIEVE', to: 'retrieving' },
  ],
};

// ============================================================================
// State Machine Utilities
// ============================================================================

/**
 * State info metadata
 */
export interface StateInfo {
  description: string;
  canPause: boolean;
  canCancel: boolean;
  canRecover: boolean;
  emitsProgress: boolean;
}

/**
 * Generic state machine class
 */
export class StateMachine<S extends string, E extends string> {
  private currentState: S;
  private config: StateMachineConfig<S, E>;
  private history: StateTransition<S>[] = [];

  constructor(config: StateMachineConfig<S, E>) {
    this.config = config;
    this.currentState = config.initialState;
  }

  /**
   * Get current state
   */
  getState(): S {
    return this.currentState;
  }

  /**
   * Get transition history
   */
  getHistory(): StateTransition<S>[] {
    return [...this.history];
  }

  /**
   * Check if transition is valid
   */
  canTransition(event: E): boolean {
    return this.findTransition(event) !== null;
  }

  /**
   * Execute a state transition
   */
  transition(event: E, reason?: string, metadata?: Record<string, unknown>): boolean {
    const rule = this.findTransition(event);
    
    if (!rule) {
      return false;
    }

    if (rule.guard && !rule.guard()) {
      return false;
    }

    const from = this.currentState;
    const to = rule.to;

    // Exit callback
    this.config.onExit?.[from]?.(from, metadata);

    // Execute action
    rule.action?.();

    // Update state
    this.currentState = to;

    // Record transition
    const transition: StateTransition<S> = {
      from,
      to,
      event,
      timestamp: Date.now(),
      reason,
      metadata,
    };
    this.history.push(transition);

    // Enter callback
    this.config.onEnter?.[to]?.(to, metadata);

    // Global transition callback
    this.config.onTransition?.(transition);

    return true;
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.currentState = this.config.initialState;
    this.history = [];
  }

  /**
   * Find valid transition rule
   */
  private findTransition(event: E): StateTransitionRule<S, E> | null {
    for (const rule of this.config.transitions) {
      const fromStates = Array.isArray(rule.from) ? rule.from : [rule.from];
      if (fromStates.includes(this.currentState) && rule.event === event) {
        return rule;
      }
    }
    return null;
  }
}

/**
 * Create a compression state machine instance
 */
export function createCompressionStateMachine(): StateMachine<CompressionState, CompressionEvent> {
  return new StateMachine(COMPRESSION_STATE_MACHINE);
}

/**
 * Create a decompression state machine instance
 */
export function createDecompressionStateMachine(): StateMachine<DecompressionState, DecompressionEvent> {
  return new StateMachine(DECOMPRESSION_STATE_MACHINE);
}

/**
 * Create a sharing state machine instance
 */
export function createSharingStateMachine(): StateMachine<SharingState, SharingEvent> {
  return new StateMachine(SHARING_STATE_MACHINE);
}

/**
 * Create a history state machine instance
 */
export function createHistoryStateMachine(): StateMachine<HistoryState, HistoryEvent> {
  return new StateMachine(HISTORY_STATE_MACHINE);
}

/**
 * Get recovery action for a failed state
 */
export function getRecoveryAction(
  state: CompressionState | DecompressionState,
  error: ApiError
): RecoveryInstruction | null {
  if (!error.recoverable) {
    return null;
  }

  // State-specific recovery
  switch (state) {
    case 'compressing':
    case 'extracting':
      return {
        action: 'RETRY_CHUNK',
        retryAfterMs: 1000,
      };
    case 'writing':
    case 'writing_output':
      return {
        action: 'RECOVER_JOB',
        retryAfterMs: 2000,
      };
    case 'failed':
      if (error.code === 'INSUFFICIENT_MEMORY') {
        return {
          action: 'FALLBACK_MODE',
          fallbackMode: true,
        };
      }
      return {
        action: 'RECOVER_JOB',
        retryAfterMs: 5000,
      };
    default:
      return null;
  }
}
