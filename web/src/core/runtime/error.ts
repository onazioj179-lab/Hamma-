/**
 * SPK Implementation Blueprint - Error Handling
 * 
 * Standardized error handling and result types for the SPK runtime.
 * Provides type-safe error management and recovery strategies.
 * 
 * @module core/runtime/error
 * @version 1.0.0
 */

import type { SPKError, ErrorCode } from './types';

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base SPK error class.
 */
export class SPKRuntimeError extends Error {
  public readonly code: ErrorCode;
  public readonly timestamp: number;
  public readonly recoverable: boolean;
  public readonly details?: any;

  constructor(
    code: ErrorCode,
    message: string,
    recoverable = false,
    details?: any
  ) {
    super(message);
    this.name = 'SPKRuntimeError';
    this.code = code;
    this.timestamp = Date.now();
    this.recoverable = recoverable;
    this.details = details;
  }

  toJSON(): SPKError {
    return {
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      recoverable: this.recoverable,
      details: this.details,
    };
  }
}

/**
 * Compression-specific error.
 */
export class CompressionError extends SPKRuntimeError {
  constructor(message: string, details?: any) {
    super('COMPRESSION_FAILED', message, true, details);
    this.name = 'CompressionError';
  }
}

/**
 * Decompression-specific error.
 */
export class DecompressionError extends SPKRuntimeError {
  constructor(message: string, details?: any) {
    super('DECOMPRESSION_FAILED', message, true, details);
    this.name = 'DecompressionError';
  }
}

/**
 * Encryption/decryption error.
 */
export class EncryptionError extends SPKRuntimeError {
  constructor(message: string, isDecryption = false, details?: any) {
    super(
      isDecryption ? 'DECRYPTION_FAILED' : 'ENCRYPTION_FAILED',
      message,
      false,
      details
    );
    this.name = 'EncryptionError';
  }
}

/**
 * Worker thread error.
 */
export class WorkerError extends SPKRuntimeError {
  constructor(message: string, details?: any) {
    super('WORKER_ERROR', message, true, details);
    this.name = 'WorkerError';
  }
}

/**
 * Validation error.
 */
export class ValidationError extends SPKRuntimeError {
  constructor(message: string, details?: any) {
    super('INVALID_INPUT', message, false, details);
    this.name = 'ValidationError';
  }
}

/**
 * Archive integrity error.
 */
export class IntegrityError extends SPKRuntimeError {
  constructor(message: string, details?: any) {
    super('CHECKSUM_MISMATCH', message, false, details);
    this.name = 'IntegrityError';
  }
}

// ============================================================================
// Result Type (Rust-style error handling)
// ============================================================================

/**
 * Result type for operations that can fail.
 */
export type Result<T, E = SPKError> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Create a successful result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Create a failed result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Check if result is successful.
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok === true;
}

/**
 * Check if result is an error.
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return result.ok === false;
}

/**
 * Unwrap result value or throw error.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`Failed to unwrap result: ${JSON.stringify(result.error)}`);
}

/**
 * Unwrap result value or return default.
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Map result value if successful.
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Map result error if failed.
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Chain result operations.
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

// ============================================================================
// Error Factory
// ============================================================================

/**
 * Create standardized errors with context.
 */
export class ErrorFactory {
  static notInitialized(): SPKRuntimeError {
    return new SPKRuntimeError(
      'NOT_INITIALIZED',
      'SPK runtime has not been initialized',
      false
    );
  }

  static invalidInput(message: string, details?: any): ValidationError {
    return new ValidationError(message, details);
  }

  static compressionFailed(message: string, details?: any): CompressionError {
    return new CompressionError(message, details);
  }

  static decompressionFailed(message: string, details?: any): DecompressionError {
    return new DecompressionError(message, details);
  }

  static encryptionFailed(message: string, details?: any): EncryptionError {
    return new EncryptionError(message, false, details);
  }

  static decryptionFailed(message: string, details?: any): EncryptionError {
    return new EncryptionError(message, true, details);
  }

  static checksumMismatch(expected: string, actual: string): IntegrityError {
    return new IntegrityError(
      'Data integrity check failed',
      { expected, actual }
    );
  }

  static outOfMemory(requested: number, available: number): SPKRuntimeError {
    return new SPKRuntimeError(
      'OUT_OF_MEMORY',
      'Insufficient memory for operation',
      true,
      { requested, available }
    );
  }

  static workerError(message: string, workerId?: number): WorkerError {
    return new WorkerError(message, { workerId });
  }

  static networkError(message: string, details?: any): SPKRuntimeError {
    return new SPKRuntimeError(
      'NETWORK_ERROR',
      message,
      true,
      details
    );
  }

  static permissionDenied(resource: string): SPKRuntimeError {
    return new SPKRuntimeError(
      'PERMISSION_DENIED',
      `Access denied to ${resource}`,
      false,
      { resource }
    );
  }

  static fileNotFound(path: string): SPKRuntimeError {
    return new SPKRuntimeError(
      'FILE_NOT_FOUND',
      `File not found: ${path}`,
      false,
      { path }
    );
  }

  static invalidArchive(message: string): SPKRuntimeError {
    return new SPKRuntimeError(
      'INVALID_ARCHIVE',
      message,
      false
    );
  }

  static operationCancelled(operation: string): SPKRuntimeError {
    return new SPKRuntimeError(
      'OPERATION_CANCELLED',
      `Operation cancelled: ${operation}`,
      false,
      { operation }
    );
  }

  static unknown(message: string, details?: any): SPKRuntimeError {
    return new SPKRuntimeError(
      'UNKNOWN_ERROR',
      message,
      false,
      details
    );
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Convert any error to SPKError.
 */
export function normalizeError(error: unknown): SPKError {
  if (error instanceof SPKRuntimeError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
      timestamp: Date.now(),
      recoverable: false,
      details: { name: error.name, stack: error.stack },
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: String(error),
    timestamp: Date.now(),
    recoverable: false,
  };
}

/**
 * Check if error is recoverable.
 */
export function isRecoverable(error: SPKError | Error): boolean {
  if ('recoverable' in error) {
    return error.recoverable;
  }
  return false;
}

/**
 * Get error code from any error type.
 */
export function getErrorCode(error: unknown): ErrorCode {
  if (error instanceof SPKRuntimeError) {
    return error.code;
  }
  return 'UNKNOWN_ERROR';
}

/**
 * Format error for display.
 */
export function formatError(error: SPKError | Error): string {
  if ('code' in error) {
    return `[${error.code}] ${error.message}`;
  }
  return error.message;
}

// ============================================================================
// Async Error Handling
// ============================================================================

/**
 * Wrap async function with error handling.
 */
export function tryCatch<T>(
  fn: () => Promise<T>
): Promise<Result<T, SPKError>> {
  return fn()
    .then(value => ok(value))
    .catch(error => err(normalizeError(error)));
}

/**
 * Retry async operation with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxAttempts) {
        const delay = delayMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error('Retry failed');
}

// ============================================================================
// Exports
// ============================================================================

export default {
  ErrorFactory,
  normalizeError,
  isRecoverable,
  getErrorCode,
  formatError,
  tryCatch,
  retry,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
};
