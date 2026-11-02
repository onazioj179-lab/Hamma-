/**
 * SPK Internal Version Declaration
 * 
 * ========================================
 * INTERNAL VERSION 1.0
 * ========================================
 * 
 * This file declares the internal versioning for the Singularity Pack platform.
 * 
 * CRITICAL: This version number is INTERNAL ONLY.
 * It must NEVER appear in:
 * - UI components
 * - Filenames
 * - Folder names
 * - User-visible metadata
 * - Console logs visible to users
 * - Network requests
 * - Archive headers (use format version only)
 */

// ============================================================================
// INTERNAL VERSION (DO NOT EXPOSE)
// ============================================================================

/**
 * Internal platform version
 * @internal
 */
export const INTERNAL_VERSION = '1.0.0';

/**
 * Internal version codename
 * @internal
 */
export const INTERNAL_CODENAME = 'Foundation';

/**
 * Internal version date
 * @internal
 */
export const INTERNAL_VERSION_DATE = '2025-12-05';

// ============================================================================
// PUBLIC VERSION INFO (Safe to display)
// ============================================================================

/**
 * Archive format version (safe for archive headers)
 */
export const FORMAT_VERSION = '1.0';

/**
 * Public product name
 */
export const PRODUCT_NAME = 'Singularity Pack';

/**
 * Product short name
 */
export const PRODUCT_SHORT_NAME = 'SPK';

// ============================================================================
// COMPONENT STATUS
// ============================================================================

/**
 * Component stability status
 */
export type ComponentStatus = 'stable' | 'beta' | 'experimental' | 'deprecated';

/**
 * Platform component registry
 */
export const PLATFORM_COMPONENTS: Record<string, {
  status: ComponentStatus;
  description: string;
}> = {
  // Core Engine
  'core.compression': {
    status: 'stable',
    description: 'Chunk-based WASM compression engine (lossless)',
  },
  'core.streaming': {
    status: 'stable',
    description: 'Streaming pipeline (1TB-10TB scale)',
  },
  'core.protocol': {
    status: 'stable',
    description: 'Worker-Coordinator protocol',
  },
  'core.wasm': {
    status: 'stable',
    description: 'WASM memory interface',
  },
  'core.archive': {
    status: 'stable',
    description: 'Archive writer + manifest + chunk table',
  },
  'core.decompression': {
    status: 'stable',
    description: 'Decompression mirror pipeline',
  },

  // Integrity
  'integrity.sha256': {
    status: 'stable',
    description: 'SHA-256 per chunk verification',
  },
  'integrity.crc32c': {
    status: 'stable',
    description: 'CRC32C fallback verification',
  },
  'integrity.archive': {
    status: 'stable',
    description: 'Full-archive validation',
  },

  // Recovery
  'recovery.checkpoint': {
    status: 'stable',
    description: 'Checkpoint system',
  },
  'recovery.restart': {
    status: 'stable',
    description: 'Restart-safe jobs',
  },
  'recovery.resume': {
    status: 'stable',
    description: 'Resume after interruption',
  },

  // Performance
  'performance.throughput': {
    status: 'stable',
    description: '>100GB/min throughput on capable hardware',
  },
  'performance.parallelism': {
    status: 'stable',
    description: 'Multi-lane parallelism',
  },
  'performance.adaptive': {
    status: 'stable',
    description: 'Adaptive chunk sizing',
  },
  'performance.lowlatency': {
    status: 'stable',
    description: 'Low-latency compression loop (<5ms per chunk)',
  },

  // AI Optimization
  'ai.prediction': {
    status: 'stable',
    description: 'Predict optimal chunk size and settings',
  },
  'ai.learning': {
    status: 'stable',
    description: 'Learn locally from past 30-day history',
  },
  'ai.advisory': {
    status: 'stable',
    description: 'Advisory only - deterministic compression guaranteed',
  },

  // Extraction
  'extraction.preview': {
    status: 'stable',
    description: 'Preview archive contents without full extraction',
  },
  'extraction.selective': {
    status: 'stable',
    description: 'Single file, folder, or chunk range extraction',
  },
  'extraction.streaming': {
    status: 'stable',
    description: 'Stream-only decompression (low memory)',
  },

  // Sharing
  'sharing.p2p': {
    status: 'stable',
    description: 'Peer-to-peer sharing (WebRTC)',
  },
  'sharing.cloud': {
    status: 'stable',
    description: 'Cloud-sharing hooks',
  },
  'sharing.tokens': {
    status: 'stable',
    description: 'Share token system',
  },
  'sharing.resume': {
    status: 'stable',
    description: 'Resume-safe receiving',
  },

  // Security
  'security.encryption': {
    status: 'stable',
    description: 'End-to-end encryption (AES-256, ChaCha20)',
  },
  'security.kdf': {
    status: 'stable',
    description: 'Password-based key derivation',
  },
  'security.signing': {
    status: 'stable',
    description: 'Archive signing system',
  },
  'security.verification': {
    status: 'stable',
    description: 'Integrity verification on open',
  },

  // Frontend
  'frontend.ui': {
    status: 'stable',
    description: 'Clean UI with professional iconography',
  },
  'frontend.picker': {
    status: 'stable',
    description: 'File picker supports up to 5,000 files',
  },
  'frontend.progress': {
    status: 'stable',
    description: 'Real-time progress + speed + ETA',
  },
  'frontend.history': {
    status: 'stable',
    description: 'History system with 30-day retention',
  },
};

// ============================================================================
// VERSION 1.0 REQUIREMENTS
// ============================================================================

/**
 * Version 1.0 requirements checklist
 */
export const VERSION_1_0_REQUIREMENTS = {
  // Core functionality
  compressionPipeline: true,
  decompressionBitPerfect: true,
  aiOptimizationStable: true,
  tenTBWorkloads: true,
  previewExtraction: true,
  sharingModule: true,
  uiClean: true,
  securityFunctional: true,

  // User experience guarantees
  noDowntime: true,
  noFreezes: true,
  noMemorySpikes: true,
  noUIClutter: true,
  noVersionNumbersVisible: true,
  noEmojis: true,
  fastCompression: true,
  reliableHistory: true,
} as const;

// ============================================================================
// PERFORMANCE TARGETS
// ============================================================================

/**
 * Performance targets for Version 1.0
 */
export const PERFORMANCE_TARGETS = {
  /** Minimum throughput in GB/min */
  minThroughputGBPerMin: 100,
  /** Maximum latency per chunk in ms */
  maxChunkLatencyMs: 5,
  /** Maximum file count */
  maxFileCount: 5000,
  /** Maximum archive size in TB */
  maxArchiveSizeTB: 10,
  /** History retention in days */
  historyRetentionDays: 30,
} as const;

// ============================================================================
// FUTURE ROADMAP (POST-1.0)
// ============================================================================

/**
 * Future features for post-1.0 development
 * @internal
 */
export const FUTURE_ROADMAP = [
  'Distributed node clustering',
  'GPU-accelerated modes',
  'Native mobile engine',
  'Delta compression between similar files',
  'Real-time collaboration features',
] as const;

// ============================================================================
// VERSION CHECK
// ============================================================================

/**
 * Check if all Version 1.0 requirements are met
 * @internal
 */
export function checkVersion1Requirements(): boolean {
  return Object.values(VERSION_1_0_REQUIREMENTS).every(v => v === true);
}

/**
 * Get all stable components
 * @internal
 */
export function getStableComponents(): string[] {
  return Object.entries(PLATFORM_COMPONENTS)
    .filter(([, info]) => info.status === 'stable')
    .map(([name]) => name);
}

/**
 * Version 1.0 declaration
 * @internal
 */
export const VERSION_1_0_DECLARED = checkVersion1Requirements();
