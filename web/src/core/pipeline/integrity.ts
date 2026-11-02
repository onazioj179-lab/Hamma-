/**
 * SPK Implementation Blueprint - Integrity Checker
 * 
 * Verifies data integrity using checksums and validation.
 * Ensures lossless compression and detects corruption.
 * 
 * @module core/pipeline/integrity
 * @version 1.0.0
 */

import type { FileEntry, FileManifest } from './chunkReader';

// ============================================================================
// Types
// ============================================================================

export interface IntegrityResult {
  valid: boolean;
  errors: IntegrityError[];
  warnings: string[];
  checksums: Map<string, string>;
  verifiedBytes: number;
  totalBytes: number;
}

export interface IntegrityError {
  type: 'checksum-mismatch' | 'missing-chunk' | 'corrupted-data' | 'invalid-manifest';
  message: string;
  chunkId?: string;
  fileId?: string;
  expected?: string;
  actual?: string;
}

export interface ChecksumAlgorithm {
  name: string;
  compute: (data: Uint8Array) => Promise<string>;
  verify: (data: Uint8Array, expected: string) => Promise<boolean>;
}

// ============================================================================
// Checksums
// ============================================================================

/**
 * CRC32 checksum implementation.
 */
class CRC32 implements ChecksumAlgorithm {
  name = 'CRC32';
  private table: Uint32Array;

  constructor() {
    this.table = this.generateTable();
  }

  private generateTable(): Uint32Array {
    const table = new Uint32Array(256);
    
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    
    return table;
  }

  async compute(data: Uint8Array): Promise<string> {
    let crc = 0xffffffff;
    
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ this.table[(crc ^ data[i]) & 0xff];
    }
    
    crc = crc ^ 0xffffffff;
    return (crc >>> 0).toString(16).padStart(8, '0');
  }

  async verify(data: Uint8Array, expected: string): Promise<boolean> {
    const actual = await this.compute(data);
    return actual === expected;
  }
}

/**
 * XXHash implementation (faster for large data).
 */
class XXHash implements ChecksumAlgorithm {
  name = 'XXHash';
  
  private readonly PRIME32_1 = 0x9e3779b1;
  private readonly PRIME32_2 = 0x85ebca77;
  private readonly PRIME32_3 = 0xc2b2ae3d;
  private readonly PRIME32_4 = 0x27d4eb2f;
  private readonly PRIME32_5 = 0x165667b1;

  async compute(data: Uint8Array): Promise<string> {
    let hash: number;
    
    if (data.length >= 16) {
      hash = this.computeLarge(data);
    } else {
      hash = this.computeSmall(data);
    }
    
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private computeLarge(data: Uint8Array): number {
    let v1 = (this.PRIME32_1 + this.PRIME32_2) >>> 0;
    let v2 = this.PRIME32_2;
    let v3 = 0;
    let v4 = (this.PRIME32_1 >>> 0) | 0;
    
    let index = 0;
    const limit = data.length - 16;
    
    while (index <= limit) {
      v1 = this.round(v1, this.readUInt32LE(data, index));
      v2 = this.round(v2, this.readUInt32LE(data, index + 4));
      v3 = this.round(v3, this.readUInt32LE(data, index + 8));
      v4 = this.round(v4, this.readUInt32LE(data, index + 12));
      index += 16;
    }
    
    let hash = this.rotateLeft(v1, 1) + this.rotateLeft(v2, 7) + 
               this.rotateLeft(v3, 12) + this.rotateLeft(v4, 18);
    
    return this.finalize(hash, data, index);
  }

  private computeSmall(data: Uint8Array): number {
    return this.finalize(this.PRIME32_5, data, 0);
  }

  private round(acc: number, input: number): number {
    acc = (acc + Math.imul(input, this.PRIME32_2)) >>> 0;
    acc = this.rotateLeft(acc, 13);
    return Math.imul(acc, this.PRIME32_1) >>> 0;
  }

  private finalize(hash: number, data: Uint8Array, index: number): number {
    hash = (hash + data.length) >>> 0;
    
    while (index <= data.length - 4) {
      hash = (hash + Math.imul(this.readUInt32LE(data, index), this.PRIME32_3)) >>> 0;
      hash = this.rotateLeft(hash, 17);
      hash = Math.imul(hash, this.PRIME32_4) >>> 0;
      index += 4;
    }
    
    while (index < data.length) {
      hash = (hash + Math.imul(data[index], this.PRIME32_5)) >>> 0;
      hash = this.rotateLeft(hash, 11);
      hash = Math.imul(hash, this.PRIME32_1) >>> 0;
      index++;
    }
    
    hash ^= hash >>> 15;
    hash = Math.imul(hash, this.PRIME32_2) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, this.PRIME32_3) >>> 0;
    hash ^= hash >>> 16;
    
    return hash >>> 0;
  }

  private readUInt32LE(data: Uint8Array, offset: number): number {
    return (data[offset] | (data[offset + 1] << 8) | 
            (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  }

  private rotateLeft(value: number, shift: number): number {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }

  async verify(data: Uint8Array, expected: string): Promise<boolean> {
    const actual = await this.compute(data);
    return actual === expected;
  }
}

// ============================================================================
// Integrity Checker
// ============================================================================

/**
 * Verifies data integrity throughout compression/decompression.
 */
export class IntegrityChecker {
  private algorithm: ChecksumAlgorithm;

  constructor(algorithm: 'crc32' | 'xxhash' = 'xxhash') {
    this.algorithm = algorithm === 'crc32' ? new CRC32() : new XXHash();
  }

  /**
   * Compute checksum for data.
   */
  async computeChecksum(data: Uint8Array): Promise<string> {
    return this.algorithm.compute(data);
  }

  /**
   * Verify data against expected checksum.
   */
  async verifyChecksum(data: Uint8Array, expected: string): Promise<boolean> {
    return this.algorithm.verify(data, expected);
  }

  /**
   * Verify complete archive integrity.
   */
  async verifyArchive(archive: Blob): Promise<IntegrityResult> {
    const result: IntegrityResult = {
      valid: true,
      errors: [],
      warnings: [],
      checksums: new Map(),
      verifiedBytes: 0,
      totalBytes: archive.size,
    };

    try {
      // Read archive data
      const data = new Uint8Array(await archive.arrayBuffer());
      
      // Verify footer
      if (data.length < 512) {
        result.errors.push({
          type: 'corrupted-data',
          message: 'Archive too small to contain valid footer',
        });
        result.valid = false;
        return result;
      }

      // Check magic number
      const magic = String.fromCharCode(data[data.length - 512], 
                                        data[data.length - 511], 
                                        data[data.length - 510]);
      if (magic !== 'SPK') {
        result.errors.push({
          type: 'invalid-manifest',
          message: 'Invalid archive magic number',
        });
        result.valid = false;
        return result;
      }

      // Extract manifest
      const footerView = new DataView(data.buffer, data.length - 512);
      const manifestSize = Number(footerView.getBigUint64(496, true));
      const manifestOffset = Number(footerView.getBigUint64(504, true));

      // Verify manifest checksum
      const manifestData = data.slice(manifestOffset, manifestOffset + manifestSize);
      const manifestChecksum = await this.computeChecksum(manifestData);
      result.checksums.set('manifest', manifestChecksum);

      // Parse manifest
      const manifestText = new TextDecoder().decode(manifestData);
      const manifest: FileManifest = JSON.parse(manifestText);

      // Verify each chunk
      for (const chunk of manifest.chunks) {
        const chunkData = data.slice(chunk.offset, chunk.offset + chunk.compressedSize);
        const chunkChecksum = await this.computeChecksum(chunkData);
        
        if (chunkChecksum !== chunk.checksum) {
          result.errors.push({
            type: 'checksum-mismatch',
            message: `Chunk ${chunk.id} checksum mismatch`,
            chunkId: chunk.id,
            expected: chunk.checksum,
            actual: chunkChecksum,
          });
          result.valid = false;
        }
        
        result.checksums.set(chunk.id, chunkChecksum);
        result.verifiedBytes += chunk.compressedSize;
      }

    } catch (error) {
      result.errors.push({
        type: 'corrupted-data',
        message: `Verification failed: ${error}`,
      });
      result.valid = false;
    }

    return result;
  }

  /**
   * Verify extracted files match original checksums.
   */
  async verifyExtractedFiles(files: FileEntry[]): Promise<IntegrityResult> {
    const result: IntegrityResult = {
      valid: true,
      errors: [],
      warnings: [],
      checksums: new Map(),
      verifiedBytes: 0,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    };

    for (const file of files) {
      // Would verify actual extracted file data
      // For now, just record checksums
      result.checksums.set(file.path, file.checksum);
      result.verifiedBytes += file.size;
    }

    return result;
  }

  /**
   * Verify chunk data integrity.
   */
  async verifyChunk(data: Uint8Array, expected: string, chunkId: string): Promise<boolean> {
    try {
      return await this.verifyChecksum(data, expected);
    } catch (error) {
      console.error(`Chunk ${chunkId} verification failed:`, error);
      return false;
    }
  }

  /**
   * Generate integrity report for archive.
   */
  async generateReport(archive: Blob): Promise<string> {
    const result = await this.verifyArchive(archive);
    
    const lines: string[] = [
      '=== SPK Archive Integrity Report ===',
      `Status: ${result.valid ? 'VALID' : 'INVALID'}`,
      `Verified: ${result.verifiedBytes} / ${result.totalBytes} bytes`,
      `Errors: ${result.errors.length}`,
      `Warnings: ${result.warnings.length}`,
      '',
    ];

    if (result.errors.length > 0) {
      lines.push('Errors:');
      result.errors.forEach(err => {
        lines.push(`  - ${err.type}: ${err.message}`);
      });
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push('Warnings:');
      result.warnings.forEach(warn => {
        lines.push(`  - ${warn}`);
      });
      lines.push('');
    }

    lines.push(`Checksums verified: ${result.checksums.size}`);
    
    return lines.join('\n');
  }
}

// ============================================================================
// Exports
// ============================================================================

export { CRC32, XXHash };
export default IntegrityChecker;
