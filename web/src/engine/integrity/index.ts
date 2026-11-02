/**
 * SPK AI-Powered Post-Compression Integrity Verification Engine - Index
 * Creator: OJ Treasure Onazi
 * 
 * Barrel exports for the integrity verification module.
 */

// Types - using export type
export type * from '../core/types/integrity';

// Chunk Validator
export { 
  ChunkValidator,
  DEFAULT_CHUNK_VALIDATOR_CONFIG,
  createChunkValidator,
} from './chunk-validator';

export type {
  ChunkValidatorConfig,
} from './chunk-validator';

// Metadata Validator
export {
  MetadataValidator,
  DEFAULT_METADATA_VALIDATOR_CONFIG,
  createMetadataValidator,
} from './metadata-validator';

export type {
  MetadataValidatorConfig,
  MetadataSchema,
  MetadataField,
  ChunkMetadata,
  FileMetadata,
  ArchiveMetadata,
  MetadataValidationResult,
  MetadataError,
  MetadataWarning,
} from './metadata-validator';

// Footer Validator
export {
  FooterValidator,
  DEFAULT_FOOTER_VALIDATOR_CONFIG,
  SPK_MAGIC,
  FOOTER_MAGIC,
  MIN_FOOTER_SIZE,
  MAX_FOOTER_SIZE,
  createFooterValidator,
} from './footer-validator';

export type {
  FooterValidatorConfig,
  FooterData,
  FooterFlags,
  FooterValidationResult,
  FooterError,
  FooterWarning,
} from './footer-validator';

// Anomaly Detector
export {
  AIAnomalyDetector,
  DEFAULT_ANOMALY_DETECTOR_CONFIG,
  createAnomalyDetector,
} from './anomaly-detector';

export type {
  AnomalyDetectorConfig,
  AnomalyPattern,
  HistoricalPattern,
} from './anomaly-detector';

// Repair Engine
export {
  RepairEngine,
  DEFAULT_REPAIR_ENGINE_CONFIG,
  createRepairEngine,
} from './repair-engine';

export type {
  RepairEngineConfig,
  RepairContext,
  RepairResult,
} from './repair-engine';

// Main Verifier
export {
  IntegrityVerifier,
  DEFAULT_VERIFIER_CONFIG,
  createIntegrityVerifier,
} from './verifier';

export type {
  IntegrityVerifierConfig,
  ArchiveInput,
} from './verifier';

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

import { IntegrityVerifier, IntegrityVerifierConfig } from './verifier';
import { ArchiveInput } from './verifier';
import { ArchiveVerificationResult, VerificationSummary } from '../core/types/integrity';

/**
 * Quick verification with default settings
 */
export async function verifyArchive(
  archiveId: string,
  buffer: ArrayBuffer,
  options?: Partial<IntegrityVerifierConfig>
): Promise<ArchiveVerificationResult> {
  const verifier = new IntegrityVerifier(options);
  return verifier.verify({ id: archiveId, buffer });
}

/**
 * Full verification with all options
 */
export async function verifyArchiveFull(
  input: ArchiveInput,
  options?: Partial<IntegrityVerifierConfig>
): Promise<ArchiveVerificationResult> {
  const verifier = new IntegrityVerifier(options);
  return verifier.verify(input);
}

/**
 * Quick check (lightweight, no repairs)
 */
export async function quickCheck(
  archiveId: string,
  buffer: ArrayBuffer
): Promise<{ passed: boolean; anomalies: number }> {
  const verifier = new IntegrityVerifier({
    ai: {
      enablePrediction: false,
      autoRepair: false,
      anomalyThreshold: 0.3,
      sampleSize: 100,
      skipLowRisk: true,
      lowRiskThreshold: 0.1,
      parallelHashing: true,
      maxParallelHashes: 8,
      wasmHashing: true,
      maxRepairAttempts: 0,
    },
    failFast: true,
  });

  const result = await verifier.verify({ id: archiveId, buffer });
  return {
    passed: result.status === 'passed',
    anomalies: result.anomalies.length,
  };
}

/**
 * Get summary from result
 */
export function getVerificationSummary(
  result: ArchiveVerificationResult
): VerificationSummary {
  const verifier = new IntegrityVerifier();
  return verifier.getSummary(result);
}
