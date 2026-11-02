/**
 * Secure Footer
 * Encrypted manifest and integrity table for secure archives
 */

import type {
  SecureFooter,
  EncryptionMetadata,
  IntegrityEntry,
  ArchiveSignature,
} from './types';
import { calculateHash } from './signing';

// Footer magic bytes
const FOOTER_MAGIC = new Uint8Array([0x53, 0x50, 0x4B, 0x46]); // "SPKF"
const FOOTER_VERSION = 1;

/**
 * Secure footer builder
 */
export class SecureFooterBuilder {
  private encryption: EncryptionMetadata | null = null;
  private integrityTable: IntegrityEntry[] = [];
  private signature: ArchiveSignature | null = null;
  private manifestData: ArrayBuffer | null = null;

  /**
   * Set encryption metadata
   */
  setEncryption(metadata: EncryptionMetadata): this {
    this.encryption = metadata;
    return this;
  }

  /**
   * Add integrity entry
   */
  addIntegrityEntry(entry: IntegrityEntry): this {
    this.integrityTable.push(entry);
    return this;
  }

  /**
   * Set integrity table
   */
  setIntegrityTable(entries: IntegrityEntry[]): this {
    this.integrityTable = entries;
    return this;
  }

  /**
   * Set signature
   */
  setSignature(signature: ArchiveSignature): this {
    this.signature = signature;
    return this;
  }

  /**
   * Set manifest data (for hash calculation)
   */
  setManifestData(data: ArrayBuffer): this {
    this.manifestData = data;
    return this;
  }

  /**
   * Build the secure footer
   */
  async build(): Promise<SecureFooter> {
    if (!this.encryption) {
      throw new Error('Encryption metadata required');
    }

    const manifestHash = this.manifestData 
      ? await calculateHash(this.manifestData)
      : '';

    return {
      version: FOOTER_VERSION,
      encryption: this.encryption,
      manifestHash,
      manifestSize: this.manifestData?.byteLength || 0,
      integrityTable: this.integrityTable,
      signature: this.signature || undefined,
    };
  }

  /**
   * Serialize footer to bytes
   */
  async serialize(): Promise<ArrayBuffer> {
    const footer = await this.build();
    return serializeFooter(footer);
  }
}

/**
 * Serialize footer to bytes
 */
export function serializeFooter(footer: SecureFooter): ArrayBuffer {
  const encoder = new TextEncoder();
  const json = JSON.stringify({
    ...footer,
    encryption: {
      ...footer.encryption,
      salt: Array.from(footer.encryption.salt),
      iv: Array.from(footer.encryption.iv),
    },
  });
  const jsonBytes = encoder.encode(json);

  // Format: MAGIC (4) + SIZE (4) + JSON
  const buffer = new ArrayBuffer(8 + jsonBytes.length);
  const view = new Uint8Array(buffer);
  
  view.set(FOOTER_MAGIC, 0);
  new DataView(buffer).setUint32(4, jsonBytes.length, true);
  view.set(jsonBytes, 8);

  return buffer;
}

/**
 * Deserialize footer from bytes
 */
export function deserializeFooter(data: ArrayBuffer): SecureFooter | null {
  try {
    const view = new Uint8Array(data);
    
    // Validate magic
    for (let i = 0; i < FOOTER_MAGIC.length; i++) {
      if (view[i] !== FOOTER_MAGIC[i]) {
        return null;
      }
    }

    // Get size
    const dataView = new DataView(data);
    const size = dataView.getUint32(4, true);

    // Parse JSON
    const jsonBytes = view.slice(8, 8 + size);
    const decoder = new TextDecoder();
    const json = decoder.decode(jsonBytes);
    const parsed = JSON.parse(json);

    // Restore Uint8Arrays
    return {
      ...parsed,
      encryption: {
        ...parsed.encryption,
        salt: new Uint8Array(parsed.encryption.salt),
        iv: new Uint8Array(parsed.encryption.iv),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Read footer from end of archive
 */
export async function readFooterFromArchive(file: File): Promise<SecureFooter | null> {
  // Footer size is stored in last 4 bytes
  const sizeSlice = file.slice(-4);
  const sizeBuffer = await sizeSlice.arrayBuffer();
  const footerSize = new DataView(sizeBuffer).getUint32(0, true);

  if (footerSize <= 0 || footerSize > 10 * 1024 * 1024) {
    return null;
  }

  // Read footer
  const footerSlice = file.slice(-(footerSize + 4), -4);
  const footerBuffer = await footerSlice.arrayBuffer();

  return deserializeFooter(footerBuffer);
}

/**
 * Verify archive integrity
 */
export async function verifyIntegrity(
  file: File,
  footer: SecureFooter,
  onProgress?: (progress: number) => void
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  for (let i = 0; i < footer.integrityTable.length; i++) {
    const entry = footer.integrityTable[i];
    
    // Read chunk
    const slice = file.slice(entry.offset, entry.offset + entry.size);
    const data = await slice.arrayBuffer();
    
    // Calculate hash
    const hash = await calculateHash(data);
    
    if (hash !== entry.hash) {
      errors.push(`Chunk ${entry.chunkId} integrity check failed`);
    }
    
    if (onProgress) {
      onProgress((i + 1) / footer.integrityTable.length);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create footer builder
 */
export function createFooterBuilder(): SecureFooterBuilder {
  return new SecureFooterBuilder();
}
