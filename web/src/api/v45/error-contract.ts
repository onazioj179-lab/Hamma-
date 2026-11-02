/**
 * SPK V45 - Error Contract
 * Standardized error types and codes
 */

// ============================================================================
// PART 6 — ERROR CONTRACT
// ============================================================================

/**
 * Standard SPK error type
 */
export interface SPKError {
  /** Error code */
  code: SPKErrorCode;
  /** Human-readable error message */
  message: string;
  /** Error category */
  category: ErrorCategory;
  /** Whether error is recoverable */
  recoverable: boolean;
  /** Suggested recovery action */
  recoveryAction?: RecoveryAction;
  /** Original error (if wrapped) */
  cause?: Error;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Timestamp */
  timestamp: string;
  /** Correlation ID for tracing */
  correlationId?: string;
}

/**
 * Standardized error codes
 */
export type SPKErrorCode =
  // Initialization errors (1xx)
  | 'ERR_WASM_INIT_FAILED'
  | 'ERR_WORKER_INIT_FAILED'
  | 'ERR_BROWSER_NOT_SUPPORTED'
  | 'ERR_MEMORY_ALLOCATION_FAILED'
  // Compression errors (2xx)
  | 'ERR_COMPRESSION_FAILED'
  | 'ERR_INVALID_INPUT'
  | 'ERR_INPUT_TOO_LARGE'
  | 'ERR_CHUNK_PROCESSING_FAILED'
  // Decompression errors (3xx)
  | 'ERR_DECOMPRESSION_FAILED'
  | 'ERR_INVALID_ARCHIVE'
  | 'ERR_UNSUPPORTED_VERSION'
  | 'ERR_CORRUPT_DATA'
  | 'ERR_CHECKSUM_MISMATCH'
  // File errors (4xx)
  | 'ERR_FILE_NOT_FOUND'
  | 'ERR_FILE_READ_FAILED'
  | 'ERR_FILE_WRITE_FAILED'
  | 'ERR_PERMISSION_DENIED'
  | 'ERR_DISK_FULL'
  // Encryption errors (5xx)
  | 'ERR_ENCRYPTION_FAILED'
  | 'ERR_DECRYPTION_FAILED'
  | 'ERR_INVALID_KEY'
  | 'ERR_KEY_DERIVATION_FAILED'
  // Network errors (6xx)
  | 'ERR_NETWORK_FAILED'
  | 'ERR_TIMEOUT'
  | 'ERR_SERVER_ERROR'
  | 'ERR_RATE_LIMITED'
  // State errors (7xx)
  | 'ERR_INVALID_STATE'
  | 'ERR_OPERATION_CANCELLED'
  | 'ERR_ALREADY_IN_PROGRESS'
  | 'ERR_NOT_INITIALIZED'
  // Worker errors (8xx)
  | 'ERR_WORKER_CRASHED'
  | 'ERR_WORKER_TIMEOUT'
  | 'ERR_WORKER_POOL_EXHAUSTED'
  | 'ERR_MESSAGE_FAILED'
  // Generic errors (9xx)
  | 'ERR_UNKNOWN'
  | 'ERR_INTERNAL'
  | 'ERR_NOT_IMPLEMENTED';

/**
 * Error categories
 */
export type ErrorCategory =
  | 'initialization'
  | 'compression'
  | 'decompression'
  | 'file'
  | 'encryption'
  | 'network'
  | 'state'
  | 'worker'
  | 'unknown';

/**
 * Recovery actions
 */
export type RecoveryAction =
  | 'retry'
  | 'retry-with-backoff'
  | 'reduce-parallelism'
  | 'reduce-chunk-size'
  | 'clear-cache'
  | 'reinitialize'
  | 'restart-worker'
  | 'abort'
  | 'user-intervention';

/**
 * Error code details mapping
 */
export const ERROR_DETAILS: Record<SPKErrorCode, ErrorDetails> = {
  // Initialization errors
  ERR_WASM_INIT_FAILED: {
    category: 'initialization',
    recoverable: true,
    defaultMessage: 'Failed to initialize WASM module',
    recoveryAction: 'reinitialize',
  },
  ERR_WORKER_INIT_FAILED: {
    category: 'initialization',
    recoverable: true,
    defaultMessage: 'Failed to initialize worker',
    recoveryAction: 'restart-worker',
  },
  ERR_BROWSER_NOT_SUPPORTED: {
    category: 'initialization',
    recoverable: false,
    defaultMessage: 'Browser does not support required features',
    recoveryAction: 'user-intervention',
  },
  ERR_MEMORY_ALLOCATION_FAILED: {
    category: 'initialization',
    recoverable: true,
    defaultMessage: 'Failed to allocate memory',
    recoveryAction: 'reduce-chunk-size',
  },

  // Compression errors
  ERR_COMPRESSION_FAILED: {
    category: 'compression',
    recoverable: true,
    defaultMessage: 'Compression operation failed',
    recoveryAction: 'retry',
  },
  ERR_INVALID_INPUT: {
    category: 'compression',
    recoverable: false,
    defaultMessage: 'Invalid input data',
    recoveryAction: 'abort',
  },
  ERR_INPUT_TOO_LARGE: {
    category: 'compression',
    recoverable: true,
    defaultMessage: 'Input exceeds maximum size limit',
    recoveryAction: 'reduce-chunk-size',
  },
  ERR_CHUNK_PROCESSING_FAILED: {
    category: 'compression',
    recoverable: true,
    defaultMessage: 'Failed to process chunk',
    recoveryAction: 'retry',
  },

  // Decompression errors
  ERR_DECOMPRESSION_FAILED: {
    category: 'decompression',
    recoverable: true,
    defaultMessage: 'Decompression operation failed',
    recoveryAction: 'retry',
  },
  ERR_INVALID_ARCHIVE: {
    category: 'decompression',
    recoverable: false,
    defaultMessage: 'Invalid or corrupted archive',
    recoveryAction: 'abort',
  },
  ERR_UNSUPPORTED_VERSION: {
    category: 'decompression',
    recoverable: false,
    defaultMessage: 'Archive version not supported',
    recoveryAction: 'abort',
  },
  ERR_CORRUPT_DATA: {
    category: 'decompression',
    recoverable: false,
    defaultMessage: 'Archive data is corrupted',
    recoveryAction: 'abort',
  },
  ERR_CHECKSUM_MISMATCH: {
    category: 'decompression',
    recoverable: false,
    defaultMessage: 'Checksum verification failed',
    recoveryAction: 'abort',
  },

  // File errors
  ERR_FILE_NOT_FOUND: {
    category: 'file',
    recoverable: false,
    defaultMessage: 'File not found',
    recoveryAction: 'abort',
  },
  ERR_FILE_READ_FAILED: {
    category: 'file',
    recoverable: true,
    defaultMessage: 'Failed to read file',
    recoveryAction: 'retry',
  },
  ERR_FILE_WRITE_FAILED: {
    category: 'file',
    recoverable: true,
    defaultMessage: 'Failed to write file',
    recoveryAction: 'retry',
  },
  ERR_PERMISSION_DENIED: {
    category: 'file',
    recoverable: false,
    defaultMessage: 'Permission denied',
    recoveryAction: 'user-intervention',
  },
  ERR_DISK_FULL: {
    category: 'file',
    recoverable: false,
    defaultMessage: 'Disk is full',
    recoveryAction: 'user-intervention',
  },

  // Encryption errors
  ERR_ENCRYPTION_FAILED: {
    category: 'encryption',
    recoverable: true,
    defaultMessage: 'Encryption failed',
    recoveryAction: 'retry',
  },
  ERR_DECRYPTION_FAILED: {
    category: 'encryption',
    recoverable: false,
    defaultMessage: 'Decryption failed',
    recoveryAction: 'abort',
  },
  ERR_INVALID_KEY: {
    category: 'encryption',
    recoverable: false,
    defaultMessage: 'Invalid encryption key',
    recoveryAction: 'user-intervention',
  },
  ERR_KEY_DERIVATION_FAILED: {
    category: 'encryption',
    recoverable: true,
    defaultMessage: 'Key derivation failed',
    recoveryAction: 'retry',
  },

  // Network errors
  ERR_NETWORK_FAILED: {
    category: 'network',
    recoverable: true,
    defaultMessage: 'Network request failed',
    recoveryAction: 'retry-with-backoff',
  },
  ERR_TIMEOUT: {
    category: 'network',
    recoverable: true,
    defaultMessage: 'Operation timed out',
    recoveryAction: 'retry-with-backoff',
  },
  ERR_SERVER_ERROR: {
    category: 'network',
    recoverable: true,
    defaultMessage: 'Server error',
    recoveryAction: 'retry-with-backoff',
  },
  ERR_RATE_LIMITED: {
    category: 'network',
    recoverable: true,
    defaultMessage: 'Rate limited',
    recoveryAction: 'retry-with-backoff',
  },

  // State errors
  ERR_INVALID_STATE: {
    category: 'state',
    recoverable: false,
    defaultMessage: 'Invalid operation state',
    recoveryAction: 'reinitialize',
  },
  ERR_OPERATION_CANCELLED: {
    category: 'state',
    recoverable: false,
    defaultMessage: 'Operation was cancelled',
    recoveryAction: 'abort',
  },
  ERR_ALREADY_IN_PROGRESS: {
    category: 'state',
    recoverable: false,
    defaultMessage: 'Operation already in progress',
    recoveryAction: 'abort',
  },
  ERR_NOT_INITIALIZED: {
    category: 'state',
    recoverable: true,
    defaultMessage: 'Component not initialized',
    recoveryAction: 'reinitialize',
  },

  // Worker errors
  ERR_WORKER_CRASHED: {
    category: 'worker',
    recoverable: true,
    defaultMessage: 'Worker process crashed',
    recoveryAction: 'restart-worker',
  },
  ERR_WORKER_TIMEOUT: {
    category: 'worker',
    recoverable: true,
    defaultMessage: 'Worker timed out',
    recoveryAction: 'restart-worker',
  },
  ERR_WORKER_POOL_EXHAUSTED: {
    category: 'worker',
    recoverable: true,
    defaultMessage: 'No workers available',
    recoveryAction: 'reduce-parallelism',
  },
  ERR_MESSAGE_FAILED: {
    category: 'worker',
    recoverable: true,
    defaultMessage: 'Worker message failed',
    recoveryAction: 'retry',
  },

  // Generic errors
  ERR_UNKNOWN: {
    category: 'unknown',
    recoverable: false,
    defaultMessage: 'Unknown error',
    recoveryAction: 'abort',
  },
  ERR_INTERNAL: {
    category: 'unknown',
    recoverable: false,
    defaultMessage: 'Internal error',
    recoveryAction: 'abort',
  },
  ERR_NOT_IMPLEMENTED: {
    category: 'unknown',
    recoverable: false,
    defaultMessage: 'Feature not implemented',
    recoveryAction: 'abort',
  },
};

/**
 * Error details
 */
interface ErrorDetails {
  category: ErrorCategory;
  recoverable: boolean;
  defaultMessage: string;
  recoveryAction: RecoveryAction;
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Create SPK error
 */
export function createSPKError(
  code: SPKErrorCode,
  message?: string,
  context?: Record<string, unknown>,
  cause?: Error
): SPKError {
  const details = ERROR_DETAILS[code];
  return {
    code,
    message: message || details.defaultMessage,
    category: details.category,
    recoverable: details.recoverable,
    recoveryAction: details.recoveryAction,
    cause,
    context,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Wrap native error as SPK error
 */
export function wrapError(error: Error, code?: SPKErrorCode): SPKError {
  const errorCode = code || inferErrorCode(error);
  return createSPKError(errorCode, error.message, undefined, error);
}

/**
 * Infer error code from native error
 */
function inferErrorCode(error: Error): SPKErrorCode {
  const message = error.message.toLowerCase();

  if (message.includes('network') || message.includes('fetch')) {
    return 'ERR_NETWORK_FAILED';
  }
  if (message.includes('timeout')) {
    return 'ERR_TIMEOUT';
  }
  if (message.includes('memory') || message.includes('oom')) {
    return 'ERR_MEMORY_ALLOCATION_FAILED';
  }
  if (message.includes('permission') || message.includes('access denied')) {
    return 'ERR_PERMISSION_DENIED';
  }
  if (message.includes('not found') || message.includes('404')) {
    return 'ERR_FILE_NOT_FOUND';
  }
  if (message.includes('cancelled') || message.includes('aborted')) {
    return 'ERR_OPERATION_CANCELLED';
  }

  return 'ERR_UNKNOWN';
}

/**
 * Check if error is recoverable
 */
export function isRecoverable(error: SPKError): boolean {
  return error.recoverable;
}

/**
 * Get suggested recovery action
 */
export function getRecoveryAction(error: SPKError): RecoveryAction {
  return error.recoveryAction || 'abort';
}

/**
 * Type guard for SPK error
 */
export function isSPKError(error: unknown): error is SPKError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'category' in error
  );
}

// ============================================================================
// Result Type (Alternative to Exceptions)
// ============================================================================

/**
 * Result type for operations that can fail
 */
export type SPKResult<T> =
  | { success: true; value: T }
  | { success: false; error: SPKError };

/**
 * Create success result
 */
export function success<T>(value: T): SPKResult<T> {
  return { success: true, value };
}

/**
 * Create failure result
 */
export function failure<T>(error: SPKError): SPKResult<T> {
  return { success: false, error };
}

/**
 * Create failure from error code
 */
export function fail<T>(code: SPKErrorCode, message?: string): SPKResult<T> {
  return failure(createSPKError(code, message));
}

/**
 * Unwrap result or throw
 */
export function unwrap<T>(result: SPKResult<T>): T {
  if (result.success) {
    return result.value;
  }
  throw new Error(`${result.error.code}: ${result.error.message}`);
}

/**
 * Unwrap result or return default
 */
export function unwrapOr<T>(result: SPKResult<T>, defaultValue: T): T {
  return result.success ? result.value : defaultValue;
}

/**
 * Map result value
 */
export function mapResult<T, U>(
  result: SPKResult<T>,
  fn: (value: T) => U
): SPKResult<U> {
  if (result.success) {
    return success(fn(result.value));
  }
  return result;
}

/**
 * Chain results
 */
export function andThen<T, U>(
  result: SPKResult<T>,
  fn: (value: T) => SPKResult<U>
): SPKResult<U> {
  if (result.success) {
    return fn(result.value);
  }
  return result;
}

// ============================================================================
// Error Aggregation
// ============================================================================

/**
 * Aggregate multiple errors
 */
export interface AggregateError {
  type: 'aggregate';
  errors: SPKError[];
  message: string;
  timestamp: string;
}

/**
 * Create aggregate error
 */
export function createAggregateError(errors: SPKError[]): AggregateError {
  return {
    type: 'aggregate',
    errors,
    message: `${errors.length} errors occurred`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if any errors are recoverable
 */
export function hasRecoverableErrors(aggregate: AggregateError): boolean {
  return aggregate.errors.some(e => e.recoverable);
}

/**
 * Get first recoverable error
 */
export function getFirstRecoverableError(aggregate: AggregateError): SPKError | undefined {
  return aggregate.errors.find(e => e.recoverable);
}
