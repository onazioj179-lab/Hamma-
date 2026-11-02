// ============================================================================
// SPK Integration Layer
// ============================================================================

// Unified SPK Engine (main API)
export {
  UnifiedSPK,
  SPKWithEvents,
  SPKEventEmitter,
  compress,
  decompress,
  compressFiles,
  getStats,
  createSPKHookState,
  type UnifiedConfig,
  type UnifiedProgress,
  type UnifiedResult,
  type ProgressCallback,
  type SPKStats,
  type UseSPKState,
} from './unified';

// Fail-Safe Pipeline Integration
export {
  FailSafeSPK,
  getFailSafeSPK,
  resetFailSafeSPK,
  compressFailSafe,
  decompressFailSafe,
  type FailSafeProgress,
  type FailSafeResult,
  type FailSafeConfig,
} from './fail-safe';
