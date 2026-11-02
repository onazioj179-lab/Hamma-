/**
 * SPK V33 - Verification & Integrity Engine
 * 
 * Provides comprehensive integrity checking:
 * - SHA-256 per chunk
 * - Double hashing (CRC32C + SHA)
 * - Full-archive verification mode
 * - Automatic mismatch detection
 * - Coordinator rejects corrupted outputs
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ChunkIntegrity {
  index: number;
  crc32: number;
  sha256: string;
  size: number;
  verified: boolean;
}

export interface ArchiveIntegrity {
  headerValid: boolean;
  footerValid: boolean;
  manifestValid: boolean;
  chunksVerified: ChunkIntegrity[];
  totalChunks: number;
  corruptedChunks: number[];
  missingChunks: number[];
  overallValid: boolean;
  verificationTime: number;
}

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  integrity: ArchiveIntegrity;
}

export type VerificationProgressCallback = (
  phase: string, 
  current: number, 
  total: number
) => void;

// ============================================================================
// CRC32C IMPLEMENTATION (Castagnoli polynomial for better error detection)
// ============================================================================

const CRC32C_TABLE = new Uint32Array(256);
const CRC32C_POLY = 0x82F63B78;

for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (CRC32C_POLY ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32C_TABLE[i] = c;
}

export function crc32c(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32C_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================================
// STANDARD CRC32 (for backwards compatibility)
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================================
// SHA-256 HASHING
// ============================================================================

export async function sha256(data: Uint8Array): Promise<string> {
  let buffer: ArrayBuffer;
  if (data.buffer instanceof SharedArrayBuffer) {
    buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
  } else {
    buffer = (data.buffer as ArrayBuffer).slice(
      data.byteOffset, 
      data.byteOffset + data.byteLength
    );
  }
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// DOUBLE HASH (CRC32C + SHA-256)
// ============================================================================

export interface DoubleHash {
  crc32c: number;
  sha256: string;
}

export async function doubleHash(data: Uint8Array): Promise<DoubleHash> {
  const [crcResult, shaResult] = await Promise.all([
    Promise.resolve(crc32c(data)),
    sha256(data),
  ]);
  
  return {
    crc32c: crcResult,
    sha256: shaResult,
  };
}

// ============================================================================
// CHUNK INTEGRITY CALCULATOR
// ============================================================================

export async function calculateChunkIntegrity(
  data: Uint8Array, 
  index: number
): Promise<ChunkIntegrity> {
  const hash = await doubleHash(data);
  
  return {
    index,
    crc32: hash.crc32c,
    sha256: hash.sha256,
    size: data.length,
    verified: true,
  };
}

// ============================================================================
// INTEGRITY VERIFIER CLASS
// ============================================================================

export class IntegrityVerifier {
  private onProgress: VerificationProgressCallback | null = null;
  
  /**
   * Set progress callback
   */
  setProgressCallback(callback: VerificationProgressCallback): void {
    this.onProgress = callback;
  }
  
  /**
   * Verify a single chunk against expected values
   */
  async verifyChunk(
    data: Uint8Array,
    expectedCrc32: number,
    expectedSha256?: string
  ): Promise<{ valid: boolean; actualCrc32: number; actualSha256: string }> {
    const actualCrc32 = crc32(data);
    const actualSha256 = await sha256(data);
    
    let valid = actualCrc32 === expectedCrc32;
    
    if (expectedSha256) {
      valid = valid && actualSha256 === expectedSha256;
    }
    
    return {
      valid,
      actualCrc32,
      actualSha256,
    };
  }
  
  /**
   * Verify entire SPK archive
   */
  async verifyArchive(file: File | Blob): Promise<VerificationResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    
    const integrity: ArchiveIntegrity = {
      headerValid: false,
      footerValid: false,
      manifestValid: false,
      chunksVerified: [],
      totalChunks: 0,
      corruptedChunks: [],
      missingChunks: [],
      overallValid: false,
      verificationTime: 0,
    };
    
    try {
      // 1. Verify header
      this.onProgress?.('header', 0, 1);
      
      const headerBuffer = await file.slice(0, 64).arrayBuffer();
      const headerBytes = new Uint8Array(headerBuffer);
      
      // Check magic bytes "SPK!"
      if (headerBytes[0] === 0x53 && headerBytes[1] === 0x50 &&
          headerBytes[2] === 0x4B && headerBytes[3] === 0x21) {
        integrity.headerValid = true;
      } else {
        errors.push('Invalid header magic bytes');
      }
      
      // Read header info
      const headerView = new DataView(headerBuffer);
      const chunkCount = headerView.getUint32(16, true);
      const manifestOffset = Number(headerView.getBigUint64(32, true));
      
      integrity.totalChunks = chunkCount;
      
      // 2. Verify footer
      this.onProgress?.('footer', 0, 1);
      
      const footerBuffer = await file.slice(file.size - 32).arrayBuffer();
      const footerBytes = new Uint8Array(footerBuffer);
      
      // Check footer magic "!KPS"
      if (footerBytes[0] === 0x21 && footerBytes[1] === 0x4B &&
          footerBytes[2] === 0x50 && footerBytes[3] === 0x53) {
        integrity.footerValid = true;
      } else {
        errors.push('Invalid footer magic bytes');
      }
      
      // Verify footer CRC
      const footerView = new DataView(footerBuffer);
      const storedFooterCrc = footerView.getUint32(28, true);
      const footerCrcData = new Uint8Array(footerBuffer.slice(0, 28));
      const calculatedFooterCrc = crc32(footerCrcData);
      
      if (storedFooterCrc !== calculatedFooterCrc) {
        warnings.push(`Footer CRC mismatch: stored=${storedFooterCrc}, calculated=${calculatedFooterCrc}`);
      }
      
      // 3. Verify manifest
      this.onProgress?.('manifest', 0, 1);
      
      try {
        const manifestSizeBuffer = await file.slice(manifestOffset, manifestOffset + 4).arrayBuffer();
        const manifestSize = new DataView(manifestSizeBuffer).getUint32(0, true);
        
        const manifestBuffer = await file.slice(manifestOffset + 4, manifestOffset + 4 + manifestSize).arrayBuffer();
        const manifestJson = new TextDecoder().decode(new Uint8Array(manifestBuffer));
        const manifest = JSON.parse(manifestJson);
        
        if (manifest.version && manifest.chunks && Array.isArray(manifest.chunks)) {
          integrity.manifestValid = true;
          
          // Verify chunk count matches
          if (manifest.chunks.length !== chunkCount) {
            warnings.push(`Chunk count mismatch: header=${chunkCount}, manifest=${manifest.chunks.length}`);
          }
          
          // 4. Verify each chunk
          let currentOffset = 64; // After header
          
          for (let i = 0; i < manifest.chunks.length; i++) {
            this.onProgress?.('chunks', i + 1, manifest.chunks.length);
            
            const chunkInfo = manifest.chunks[i];
            
            // Read chunk size prefix
            const chunkSizeBuffer = await file.slice(currentOffset, currentOffset + 4).arrayBuffer();
            const chunkSize = new DataView(chunkSizeBuffer).getUint32(0, true);
            currentOffset += 4;
            
            // Read chunk data
            const chunkBuffer = await file.slice(currentOffset, currentOffset + chunkSize).arrayBuffer();
            const chunkData = new Uint8Array(chunkBuffer);
            currentOffset += chunkSize;
            
            // Verify checksum
            const actualCrc = crc32(chunkData);
            const valid = actualCrc === chunkInfo.checksum;
            
            const chunkIntegrity: ChunkIntegrity = {
              index: i,
              crc32: actualCrc,
              sha256: '', // Only calculate if needed
              size: chunkData.length,
              verified: valid,
            };
            
            integrity.chunksVerified.push(chunkIntegrity);
            
            if (!valid) {
              integrity.corruptedChunks.push(i);
              errors.push(`Chunk ${i} corrupted: expected CRC=${chunkInfo.checksum}, got=${actualCrc}`);
            }
            
            // Verify SHA if present
            if (chunkInfo.hash) {
              const actualSha = await sha256(chunkData);
              chunkIntegrity.sha256 = actualSha;
              
              if (actualSha !== chunkInfo.hash) {
                if (!integrity.corruptedChunks.includes(i)) {
                  integrity.corruptedChunks.push(i);
                }
                errors.push(`Chunk ${i} SHA mismatch: expected=${chunkInfo.hash.slice(0, 16)}..., got=${actualSha.slice(0, 16)}...`);
              }
            }
          }
          
        } else {
          errors.push('Invalid manifest structure');
        }
        
      } catch (e) {
        errors.push(`Manifest parsing failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
      
    } catch (e) {
      errors.push(`Verification failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
    
    // Calculate overall validity
    integrity.overallValid = 
      integrity.headerValid && 
      integrity.footerValid && 
      integrity.manifestValid && 
      integrity.corruptedChunks.length === 0 &&
      integrity.missingChunks.length === 0;
    
    integrity.verificationTime = performance.now() - startTime;
    
    return {
      valid: integrity.overallValid,
      errors,
      warnings,
      integrity,
    };
  }
  
  /**
   * Quick verification (header + footer only)
   */
  async quickVerify(file: File | Blob): Promise<{ valid: boolean; error?: string }> {
    try {
      // Check header
      const headerBuffer = await file.slice(0, 64).arrayBuffer();
      const headerBytes = new Uint8Array(headerBuffer);
      
      if (headerBytes[0] !== 0x53 || headerBytes[1] !== 0x50 ||
          headerBytes[2] !== 0x4B || headerBytes[3] !== 0x21) {
        return { valid: false, error: 'Invalid header' };
      }
      
      // Check footer
      const footerBuffer = await file.slice(file.size - 32).arrayBuffer();
      const footerBytes = new Uint8Array(footerBuffer);
      
      if (footerBytes[0] !== 0x21 || footerBytes[1] !== 0x4B ||
          footerBytes[2] !== 0x50 || footerBytes[3] !== 0x53) {
        return { valid: false, error: 'Invalid footer' };
      }
      
      return { valid: true };
      
    } catch (e) {
      return { 
        valid: false, 
        error: e instanceof Error ? e.message : 'Verification failed' 
      };
    }
  }
}

// ============================================================================
// VERIFICATION COORDINATOR
// ============================================================================

export class VerificationCoordinator {
  private verifier = new IntegrityVerifier();
  private pendingVerifications = new Map<string, Promise<VerificationResult>>();
  
  /**
   * Queue archive verification
   */
  async verifyArchive(
    file: File | Blob,
    jobId: string,
    onProgress?: VerificationProgressCallback
  ): Promise<VerificationResult> {
    // Check if already verifying
    if (this.pendingVerifications.has(jobId)) {
      return this.pendingVerifications.get(jobId)!;
    }
    
    if (onProgress) {
      this.verifier.setProgressCallback(onProgress);
    }
    
    const promise = this.verifier.verifyArchive(file);
    this.pendingVerifications.set(jobId, promise);
    
    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingVerifications.delete(jobId);
    }
  }
  
  /**
   * Quick check if file is valid SPK
   */
  async isValidSPK(file: File | Blob): Promise<boolean> {
    const result = await this.verifier.quickVerify(file);
    return result.valid;
  }
  
  /**
   * Reject corrupted output
   */
  validateOutput(integrity: ArchiveIntegrity): void {
    if (!integrity.overallValid) {
      const issues: string[] = [];
      
      if (!integrity.headerValid) issues.push('invalid header');
      if (!integrity.footerValid) issues.push('invalid footer');
      if (!integrity.manifestValid) issues.push('invalid manifest');
      if (integrity.corruptedChunks.length > 0) {
        issues.push(`${integrity.corruptedChunks.length} corrupted chunks`);
      }
      if (integrity.missingChunks.length > 0) {
        issues.push(`${integrity.missingChunks.length} missing chunks`);
      }
      
      throw new Error(`Archive integrity check failed: ${issues.join(', ')}`);
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let verificationCoordinator: VerificationCoordinator | null = null;

export function getVerificationCoordinator(): VerificationCoordinator {
  if (!verificationCoordinator) {
    verificationCoordinator = new VerificationCoordinator();
  }
  return verificationCoordinator;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export async function verifyArchive(
  file: File | Blob,
  onProgress?: VerificationProgressCallback
): Promise<VerificationResult> {
  const verifier = new IntegrityVerifier();
  if (onProgress) {
    verifier.setProgressCallback(onProgress);
  }
  return verifier.verifyArchive(file);
}

export async function isValidSPK(file: File | Blob): Promise<boolean> {
  const verifier = new IntegrityVerifier();
  const result = await verifier.quickVerify(file);
  return result.valid;
}
