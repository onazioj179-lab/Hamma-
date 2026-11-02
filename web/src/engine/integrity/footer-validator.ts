/**
 * SPK AI-Powered Post-Compression Integrity Verification Engine - Footer Validator
 * Creator: OJ Treasure Onazi
 * 
 * Validates archive footer for magic bytes, offsets, flags,
 * and structural integrity of the archive terminator.
 */

import {
  VerificationStatus,
  AnomalyType,
  VerificationAnomaly,
  IntegrityEvent,
  IntegrityEventHandler,
  KB,
} from '../core/types/integrity';

// ============================================================================
// FOOTER CONSTANTS
// ============================================================================

/** SPK Magic bytes: "SPK\x00" */
export const SPK_MAGIC = new Uint8Array([0x53, 0x50, 0x4B, 0x00]);

/** Footer magic: "SPKF" */
export const FOOTER_MAGIC = new Uint8Array([0x53, 0x50, 0x4B, 0x46]);

/** Minimum footer size */
export const MIN_FOOTER_SIZE = 64;

/** Maximum footer size */
export const MAX_FOOTER_SIZE = 4 * KB;

// ============================================================================
// FOOTER STRUCTURE
// ============================================================================

/**
 * SPK Footer Structure (64+ bytes):
 * [4]  Magic bytes "SPKF"
 * [2]  Version (uint16)
 * [2]  Flags (uint16)
 * [8]  Metadata offset (uint64)
 * [4]  Metadata size (uint32)
 * [8]  Data end offset (uint64)
 * [4]  Total chunks (uint32)
 * [4]  Total files (uint32)
 * [8]  Total original size (uint64)
 * [8]  Total compressed size (uint64)
 * [4]  Checksum type (uint32)
 * [32] Footer checksum
 * [4]  Footer size (uint32) - for backwards reading
 */

export interface FooterData {
  magic: Uint8Array;
  version: number;
  flags: number;
  metadataOffset: bigint;
  metadataSize: number;
  dataEndOffset: bigint;
  totalChunks: number;
  totalFiles: number;
  totalOriginalSize: bigint;
  totalCompressedSize: bigint;
  checksumType: number;
  checksum: string;
  footerSize: number;
}

export interface FooterFlags {
  encrypted: boolean;
  compressed: boolean;
  streaming: boolean;
  multipart: boolean;
  indexed: boolean;
  recoverable: boolean;
}

// ============================================================================
// FOOTER VALIDATOR CONFIG
// ============================================================================

export interface FooterValidatorConfig {
  /** Strict mode: fail on any anomaly */
  strictMode: boolean;
  
  /** Verify footer checksum */
  verifyChecksum: boolean;
  
  /** Validate offset ranges */
  validateOffsets: boolean;
  
  /** Expected archive size (for offset validation) */
  expectedArchiveSize?: bigint;
}

export const DEFAULT_FOOTER_VALIDATOR_CONFIG: FooterValidatorConfig = {
  strictMode: false,
  verifyChecksum: true,
  validateOffsets: true,
};

// ============================================================================
// VALIDATION RESULT
// ============================================================================

export interface FooterValidationResult {
  status: VerificationStatus;
  valid: boolean;
  errors: FooterError[];
  warnings: FooterWarning[];
  anomalies: VerificationAnomaly[];
  footer?: FooterData;
  flags?: FooterFlags;
  parseTime: number;
}

export interface FooterError {
  code: string;
  field: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface FooterWarning {
  code: string;
  field: string;
  message: string;
}

// ============================================================================
// FOOTER VALIDATOR
// ============================================================================

export class FooterValidator {
  private config: FooterValidatorConfig;
  private eventHandlers: Set<IntegrityEventHandler> = new Set();

  constructor(config: Partial<FooterValidatorConfig> = {}) {
    this.config = { ...DEFAULT_FOOTER_VALIDATOR_CONFIG, ...config };
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: IntegrityEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: IntegrityEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: IntegrityEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // MAIN VALIDATION
  // ==========================================================================

  async validate(
    archiveBuffer: ArrayBuffer,
    archiveSize?: bigint
  ): Promise<FooterValidationResult> {
    const result: FooterValidationResult = {
      status: 'in-progress',
      valid: false,
      errors: [],
      warnings: [],
      anomalies: [],
      parseTime: 0,
    };

    const startTime = performance.now();

    // Set expected archive size if provided
    if (archiveSize !== undefined) {
      this.config.expectedArchiveSize = archiveSize;
    } else if (archiveBuffer.byteLength > 0) {
      this.config.expectedArchiveSize = BigInt(archiveBuffer.byteLength);
    }

    // Check minimum size
    if (archiveBuffer.byteLength < MIN_FOOTER_SIZE) {
      result.errors.push({
        code: 'ARCHIVE_TOO_SMALL',
        field: 'archive',
        message: `Archive size ${archiveBuffer.byteLength} is smaller than minimum footer size ${MIN_FOOTER_SIZE}`,
      });
      result.status = 'failed';
      return result;
    }

    // Parse footer
    let footer: FooterData;
    try {
      footer = this.parseFooter(archiveBuffer);
      result.footer = footer;
      result.flags = this.parseFlags(footer.flags);
    } catch (error) {
      result.errors.push({
        code: 'PARSE_ERROR',
        field: 'footer',
        message: `Failed to parse footer: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      result.anomalies.push({
        id: `anomaly-${Date.now()}`,
        type: 'footer-invalid',
        severity: 'critical',
        location: {},
        description: 'Footer could not be parsed',
        detectedAt: Date.now(),
        repairAttempted: false,
        repairSuccessful: false,
      });
      result.status = 'failed';
      return result;
    }

    // Validate magic bytes
    this.validateMagic(footer, result);

    // Validate version
    this.validateVersion(footer, result);

    // Validate offsets
    if (this.config.validateOffsets) {
      this.validateOffsets(footer, archiveBuffer.byteLength, result);
    }

    // Validate counts
    this.validateCounts(footer, result);

    // Validate sizes
    this.validateSizes(footer, result);

    // Verify checksum
    if (this.config.verifyChecksum) {
      await this.verifyChecksum(archiveBuffer, footer, result);
    }

    result.parseTime = performance.now() - startTime;

    // Determine final status
    if (result.errors.length > 0) {
      result.status = 'failed';
      result.valid = false;
    } else if (result.warnings.length > 0 && this.config.strictMode) {
      result.status = 'failed';
      result.valid = false;
    } else {
      result.status = 'passed';
      result.valid = true;
    }

    return result;
  }

  // ==========================================================================
  // FOOTER PARSING
  // ==========================================================================

  parseFooter(archiveBuffer: ArrayBuffer): FooterData {
    const bytes = new Uint8Array(archiveBuffer);
    
    // First, try to read footer size from the last 4 bytes
    const view = new DataView(archiveBuffer);
    const footerSizeOffset = archiveBuffer.byteLength - 4;
    const footerSize = view.getUint32(footerSizeOffset, true);

    // Validate footer size
    if (footerSize < MIN_FOOTER_SIZE || footerSize > MAX_FOOTER_SIZE) {
      throw new Error(`Invalid footer size: ${footerSize}`);
    }

    // Calculate footer start position
    const footerStart = archiveBuffer.byteLength - footerSize;
    if (footerStart < 0) {
      throw new Error(`Footer start ${footerStart} is before archive start`);
    }

    // Read footer data
    let offset = footerStart;

    // Magic bytes
    const magic = bytes.slice(offset, offset + 4);
    offset += 4;

    // Validate magic
    if (!this.compareMagic(magic, FOOTER_MAGIC)) {
      throw new Error('Invalid footer magic bytes');
    }

    // Version
    const version = view.getUint16(offset, true);
    offset += 2;

    // Flags
    const flags = view.getUint16(offset, true);
    offset += 2;

    // Metadata offset
    const metadataOffset = view.getBigUint64(offset, true);
    offset += 8;

    // Metadata size
    const metadataSize = view.getUint32(offset, true);
    offset += 4;

    // Data end offset
    const dataEndOffset = view.getBigUint64(offset, true);
    offset += 8;

    // Total chunks
    const totalChunks = view.getUint32(offset, true);
    offset += 4;

    // Total files
    const totalFiles = view.getUint32(offset, true);
    offset += 4;

    // Total original size
    const totalOriginalSize = view.getBigUint64(offset, true);
    offset += 8;

    // Total compressed size
    const totalCompressedSize = view.getBigUint64(offset, true);
    offset += 8;

    // Checksum type
    const checksumType = view.getUint32(offset, true);
    offset += 4;

    // Checksum (32 bytes)
    const checksumBytes = bytes.slice(offset, offset + 32);
    const checksum = Array.from(checksumBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    offset += 32;

    return {
      magic,
      version,
      flags,
      metadataOffset,
      metadataSize,
      dataEndOffset,
      totalChunks,
      totalFiles,
      totalOriginalSize,
      totalCompressedSize,
      checksumType,
      checksum,
      footerSize,
    };
  }

  // ==========================================================================
  // FLAG PARSING
  // ==========================================================================

  parseFlags(flags: number): FooterFlags {
    return {
      encrypted: (flags & 0x0001) !== 0,
      compressed: (flags & 0x0002) !== 0,
      streaming: (flags & 0x0004) !== 0,
      multipart: (flags & 0x0008) !== 0,
      indexed: (flags & 0x0010) !== 0,
      recoverable: (flags & 0x0020) !== 0,
    };
  }

  encodeFlags(flags: FooterFlags): number {
    let value = 0;
    if (flags.encrypted) value |= 0x0001;
    if (flags.compressed) value |= 0x0002;
    if (flags.streaming) value |= 0x0004;
    if (flags.multipart) value |= 0x0008;
    if (flags.indexed) value |= 0x0010;
    if (flags.recoverable) value |= 0x0020;
    return value;
  }

  // ==========================================================================
  // MAGIC VALIDATION
  // ==========================================================================

  private compareMagic(actual: Uint8Array, expected: Uint8Array): boolean {
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }
    return true;
  }

  private validateMagic(footer: FooterData, result: FooterValidationResult): void {
    if (!this.compareMagic(footer.magic, FOOTER_MAGIC)) {
      result.errors.push({
        code: 'INVALID_MAGIC',
        field: 'magic',
        message: 'Invalid footer magic bytes',
        expected: Array.from(FOOTER_MAGIC),
        actual: Array.from(footer.magic),
      });
      result.anomalies.push({
        id: `anomaly-magic-${Date.now()}`,
        type: 'footer-invalid',
        severity: 'critical',
        location: {},
        description: 'Footer magic bytes do not match expected values',
        detectedAt: Date.now(),
        repairAttempted: false,
        repairSuccessful: false,
      });
    }
  }

  // ==========================================================================
  // VERSION VALIDATION
  // ==========================================================================

  private validateVersion(footer: FooterData, result: FooterValidationResult): void {
    // Supported versions: 1-10
    if (footer.version < 1 || footer.version > 10) {
      result.errors.push({
        code: 'UNSUPPORTED_VERSION',
        field: 'version',
        message: `Unsupported footer version: ${footer.version}`,
        expected: '1-10',
        actual: footer.version,
      });
    }
  }

  // ==========================================================================
  // OFFSET VALIDATION
  // ==========================================================================

  private validateOffsets(
    footer: FooterData,
    archiveSize: number,
    result: FooterValidationResult
  ): void {
    const size = BigInt(archiveSize);

    // Metadata offset must be before data end
    if (footer.metadataOffset > footer.dataEndOffset) {
      result.errors.push({
        code: 'INVALID_METADATA_OFFSET',
        field: 'metadataOffset',
        message: `Metadata offset ${footer.metadataOffset} is after data end ${footer.dataEndOffset}`,
      });
    }

    // Metadata must fit within archive
    const metadataEnd = footer.metadataOffset + BigInt(footer.metadataSize);
    if (metadataEnd > size) {
      result.errors.push({
        code: 'METADATA_OVERFLOW',
        field: 'metadataSize',
        message: `Metadata extends beyond archive end: ${metadataEnd} > ${size}`,
      });
    }

    // Data end offset validation
    if (footer.dataEndOffset > size - BigInt(footer.footerSize)) {
      result.errors.push({
        code: 'INVALID_DATA_END_OFFSET',
        field: 'dataEndOffset',
        message: `Data end offset ${footer.dataEndOffset} is too large for archive size ${size}`,
      });
    }

    // Footer size validation
    if (BigInt(footer.footerSize) > size) {
      result.errors.push({
        code: 'FOOTER_TOO_LARGE',
        field: 'footerSize',
        message: `Footer size ${footer.footerSize} exceeds archive size ${size}`,
      });
    }

    // Check for reasonable offset ordering
    if (footer.metadataOffset < BigInt(0)) {
      result.errors.push({
        code: 'NEGATIVE_OFFSET',
        field: 'metadataOffset',
        message: `Negative metadata offset: ${footer.metadataOffset}`,
      });
    }

    if (footer.dataEndOffset < BigInt(0)) {
      result.errors.push({
        code: 'NEGATIVE_OFFSET',
        field: 'dataEndOffset',
        message: `Negative data end offset: ${footer.dataEndOffset}`,
      });
    }
  }

  // ==========================================================================
  // COUNT VALIDATION
  // ==========================================================================

  private validateCounts(footer: FooterData, result: FooterValidationResult): void {
    // Chunk count sanity check
    if (footer.totalChunks < 0) {
      result.errors.push({
        code: 'INVALID_CHUNK_COUNT',
        field: 'totalChunks',
        message: `Invalid total chunks: ${footer.totalChunks}`,
      });
    }

    // File count sanity check
    if (footer.totalFiles < 0) {
      result.errors.push({
        code: 'INVALID_FILE_COUNT',
        field: 'totalFiles',
        message: `Invalid total files: ${footer.totalFiles}`,
      });
    }

    // At least one chunk if there are files
    if (footer.totalFiles > 0 && footer.totalChunks === 0) {
      result.warnings.push({
        code: 'NO_CHUNKS_WITH_FILES',
        field: 'totalChunks',
        message: 'Archive has files but no chunks',
      });
    }
  }

  // ==========================================================================
  // SIZE VALIDATION
  // ==========================================================================

  private validateSizes(footer: FooterData, result: FooterValidationResult): void {
    // Original size sanity
    if (footer.totalOriginalSize < BigInt(0)) {
      result.errors.push({
        code: 'INVALID_ORIGINAL_SIZE',
        field: 'totalOriginalSize',
        message: `Negative original size: ${footer.totalOriginalSize}`,
      });
    }

    // Compressed size sanity
    if (footer.totalCompressedSize < BigInt(0)) {
      result.errors.push({
        code: 'INVALID_COMPRESSED_SIZE',
        field: 'totalCompressedSize',
        message: `Negative compressed size: ${footer.totalCompressedSize}`,
      });
    }

    // Expansion warning
    if (footer.totalCompressedSize > footer.totalOriginalSize * BigInt(2)) {
      result.warnings.push({
        code: 'HIGH_EXPANSION',
        field: 'totalCompressedSize',
        message: `Compressed size is more than 2x original: ${footer.totalCompressedSize} vs ${footer.totalOriginalSize}`,
      });
    }

    // Zero-size check
    if (footer.totalOriginalSize === BigInt(0) && footer.totalFiles > 0) {
      result.warnings.push({
        code: 'ZERO_SIZE_WITH_FILES',
        field: 'totalOriginalSize',
        message: 'Archive has zero original size but contains files',
      });
    }
  }

  // ==========================================================================
  // CHECKSUM VERIFICATION
  // ==========================================================================

  private async verifyChecksum(
    archiveBuffer: ArrayBuffer,
    footer: FooterData,
    result: FooterValidationResult
  ): Promise<void> {
    // The checksum should cover the footer excluding the checksum field itself
    try {
      const footerStart = archiveBuffer.byteLength - footer.footerSize;
      const checksumStart = footerStart + 4 + 2 + 2 + 8 + 4 + 8 + 4 + 4 + 8 + 8 + 4; // Position of checksum
      
      // Create buffer excluding checksum
      const beforeChecksum = new Uint8Array(archiveBuffer, footerStart, checksumStart - footerStart);
      const afterChecksum = new Uint8Array(archiveBuffer, checksumStart + 32, footer.footerSize - (checksumStart - footerStart) - 32 - 4);
      
      const toHash = new Uint8Array(beforeChecksum.length + afterChecksum.length);
      toHash.set(beforeChecksum, 0);
      toHash.set(afterChecksum, beforeChecksum.length);

      const hashBuffer = await crypto.subtle.digest('SHA-256', toHash);
      const hashArray = new Uint8Array(hashBuffer);
      const computedChecksum = Array.from(hashArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      if (computedChecksum !== footer.checksum) {
        result.warnings.push({
          code: 'CHECKSUM_MISMATCH',
          field: 'checksum',
          message: `Footer checksum mismatch: expected ${footer.checksum.substring(0, 16)}..., got ${computedChecksum.substring(0, 16)}...`,
        });
      }
    } catch (error) {
      result.warnings.push({
        code: 'CHECKSUM_COMPUTATION_FAILED',
        field: 'checksum',
        message: `Could not verify checksum: ${error instanceof Error ? error.message : 'Unknown'}`,
      });
    }
  }

  // ==========================================================================
  // FOOTER LOCATION
  // ==========================================================================

  findFooter(archiveBuffer: ArrayBuffer): {
    found: boolean;
    offset: number;
    size: number;
  } {
    const bytes = new Uint8Array(archiveBuffer);
    const view = new DataView(archiveBuffer);

    // Try reading footer size from end
    if (archiveBuffer.byteLength < MIN_FOOTER_SIZE) {
      return { found: false, offset: -1, size: 0 };
    }

    const footerSize = view.getUint32(archiveBuffer.byteLength - 4, true);
    if (footerSize < MIN_FOOTER_SIZE || footerSize > MAX_FOOTER_SIZE) {
      // Try to find footer by scanning for magic
      return this.scanForFooter(bytes);
    }

    const footerStart = archiveBuffer.byteLength - footerSize;
    if (footerStart < 0) {
      return { found: false, offset: -1, size: 0 };
    }

    // Verify magic at computed position
    const magic = bytes.slice(footerStart, footerStart + 4);
    if (this.compareMagic(magic, FOOTER_MAGIC)) {
      return { found: true, offset: footerStart, size: footerSize };
    }

    // Fall back to scanning
    return this.scanForFooter(bytes);
  }

  private scanForFooter(bytes: Uint8Array): {
    found: boolean;
    offset: number;
    size: number;
  } {
    // Scan backwards from the end for footer magic
    const searchStart = Math.max(0, bytes.length - MAX_FOOTER_SIZE);
    for (let i = bytes.length - MIN_FOOTER_SIZE; i >= searchStart; i--) {
      if (
        bytes[i] === FOOTER_MAGIC[0] &&
        bytes[i + 1] === FOOTER_MAGIC[1] &&
        bytes[i + 2] === FOOTER_MAGIC[2] &&
        bytes[i + 3] === FOOTER_MAGIC[3]
      ) {
        const size = bytes.length - i;
        return { found: true, offset: i, size };
      }
    }
    return { found: false, offset: -1, size: 0 };
  }

  // ==========================================================================
  // FOOTER GENERATION
  // ==========================================================================

  generateFooter(data: Omit<FooterData, 'magic' | 'checksum' | 'footerSize'>): Uint8Array {
    const footerSize = MIN_FOOTER_SIZE;
    const buffer = new ArrayBuffer(footerSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    // Magic
    bytes.set(FOOTER_MAGIC, offset);
    offset += 4;

    // Version
    view.setUint16(offset, data.version, true);
    offset += 2;

    // Flags
    view.setUint16(offset, data.flags, true);
    offset += 2;

    // Metadata offset
    view.setBigUint64(offset, data.metadataOffset, true);
    offset += 8;

    // Metadata size
    view.setUint32(offset, data.metadataSize, true);
    offset += 4;

    // Data end offset
    view.setBigUint64(offset, data.dataEndOffset, true);
    offset += 8;

    // Total chunks
    view.setUint32(offset, data.totalChunks, true);
    offset += 4;

    // Total files
    view.setUint32(offset, data.totalFiles, true);
    offset += 4;

    // Total original size
    view.setBigUint64(offset, data.totalOriginalSize, true);
    offset += 8;

    // Total compressed size
    view.setBigUint64(offset, data.totalCompressedSize, true);
    offset += 8;

    // Checksum type
    view.setUint32(offset, data.checksumType, true);
    offset += 4;

    // Checksum placeholder (32 bytes of zeros, to be filled later)
    offset += 32;

    // Footer size
    view.setUint32(offset, footerSize, true);

    return bytes;
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  isValidFooter(archiveBuffer: ArrayBuffer): boolean {
    try {
      const result = this.findFooter(archiveBuffer);
      if (!result.found) return false;
      
      const footer = this.parseFooter(archiveBuffer);
      return this.compareMagic(footer.magic, FOOTER_MAGIC);
    } catch {
      return false;
    }
  }

  getMetadataLocation(footer: FooterData): {
    offset: bigint;
    size: number;
  } {
    return {
      offset: footer.metadataOffset,
      size: footer.metadataSize,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createFooterValidator(
  config?: Partial<FooterValidatorConfig>
): FooterValidator {
  return new FooterValidator(config);
}
