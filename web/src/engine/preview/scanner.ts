/**
 * Archive Scanner
 * Partial archive scanning for preview without full decompression
 */

import type {
  ArchiveManifest,
  ArchiveFileEntry,
  ArchiveFolderEntry,
  ChunkTableEntry,
  ScanOptions,
  PreviewCallbacks,
} from './types';
import { DEFAULT_SCAN_OPTIONS, EXT_TO_MIME, MIME_TO_PREVIEW } from './types';

// SPK archive header constants
const SPK_MAGIC = [0x53, 0x50, 0x4B, 0x32]; // "SPK2"
const HEADER_SIZE = 64;
const MANIFEST_OFFSET_POS = 16;
const CHUNK_TABLE_OFFSET_POS = 24;

/**
 * Archive scanner for quick preview
 */
export class ArchiveScanner {
  private options: ScanOptions;
  private callbacks: Partial<PreviewCallbacks> = {};

  constructor(options: Partial<ScanOptions> = {}) {
    this.options = { ...DEFAULT_SCAN_OPTIONS, ...options };
  }

  /**
   * Scan archive header and manifest only
   * Does not decompress chunk data
   */
  async scan(file: File, callbacks?: Partial<PreviewCallbacks>): Promise<ArchiveManifest> {
    if (callbacks) {
      this.callbacks = callbacks;
    }

    // Read header
    const header = await this.readHeader(file);
    
    // Validate magic
    if (!this.validateMagic(header)) {
      throw new Error('Invalid SPK archive: bad magic number');
    }

    // Get manifest offset from header
    const manifestOffset = this.getUint64(header, MANIFEST_OFFSET_POS);
    const chunkTableOffset = this.getUint64(header, CHUNK_TABLE_OFFSET_POS);

    // Read manifest
    const manifest = await this.readManifest(file, manifestOffset, chunkTableOffset);

    // Read chunk table
    manifest.chunkTable = await this.readChunkTable(file, chunkTableOffset);

    if (this.callbacks.onManifestReady) {
      this.callbacks.onManifestReady(manifest);
    }

    return manifest;
  }

  /**
   * Read archive header (first 64 bytes)
   */
  private async readHeader(file: File): Promise<Uint8Array> {
    const slice = file.slice(0, HEADER_SIZE);
    const buffer = await slice.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Validate SPK magic number
   */
  private validateMagic(header: Uint8Array): boolean {
    for (let i = 0; i < SPK_MAGIC.length; i++) {
      if (header[i] !== SPK_MAGIC[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Read manifest from archive
   */
  private async readManifest(
    file: File,
    manifestOffset: number,
    chunkTableOffset: number
  ): Promise<ArchiveManifest> {
    // Manifest size is from manifestOffset to chunkTableOffset
    const manifestSize = chunkTableOffset - manifestOffset;
    
    if (manifestSize <= 0 || manifestSize > 100 * 1024 * 1024) {
      // Invalid or too large - create empty manifest
      return this.createEmptyManifest(file);
    }

    try {
      const slice = file.slice(manifestOffset, chunkTableOffset);
      const buffer = await slice.arrayBuffer();
      const decoder = new TextDecoder();
      const json = decoder.decode(buffer);
      
      const parsed = JSON.parse(json);
      return this.normalizeManifest(parsed, file);
    } catch {
      // Fallback: analyze file extension
      return this.createEmptyManifest(file);
    }
  }

  /**
   * Read chunk table from archive
   */
  private async readChunkTable(file: File, offset: number): Promise<ChunkTableEntry[]> {
    // Read chunk table size (first 4 bytes at offset)
    const sizeSlice = file.slice(offset, offset + 4);
    const sizeBuffer = await sizeSlice.arrayBuffer();
    const sizeView = new DataView(sizeBuffer);
    const tableSize = sizeView.getUint32(0, true);

    if (tableSize <= 0 || tableSize > 10 * 1024 * 1024) {
      return [];
    }

    try {
      const tableSlice = file.slice(offset + 4, offset + 4 + tableSize);
      const tableBuffer = await tableSlice.arrayBuffer();
      const decoder = new TextDecoder();
      const json = decoder.decode(tableBuffer);
      
      return JSON.parse(json);
    } catch {
      return [];
    }
  }

  /**
   * Create empty manifest for unknown/invalid archives
   */
  private createEmptyManifest(file: File): ArchiveManifest {
    return {
      version: 1,
      createdAt: Date.now(),
      originalSize: 0,
      compressedSize: file.size,
      fileCount: 0,
      folderCount: 0,
      compressionMode: 'unknown',
      encrypted: false,
      files: [],
      folders: [],
      chunkTable: [],
    };
  }

  /**
   * Normalize manifest data
   */
  private normalizeManifest(data: any, file: File): ArchiveManifest {
    const files: ArchiveFileEntry[] = (data.files || []).map((f: any, index: number) => {
      const ext = this.getExtension(f.name || '');
      const mimeType = f.mimeType || EXT_TO_MIME[ext] || 'application/octet-stream';
      
      return {
        id: f.id || `file-${index}`,
        name: f.name || `file-${index}`,
        path: f.path || f.name || `file-${index}`,
        size: f.size || 0,
        compressedSize: f.compressedSize || f.size || 0,
        mimeType,
        extension: ext,
        modifiedAt: f.modifiedAt || Date.now(),
        chunks: f.chunks || [],
        startOffset: f.startOffset || 0,
        endOffset: f.endOffset || f.size || 0,
        hash: f.hash || '',
        previewable: this.isPreviewable(mimeType),
        thumbnailChunk: f.thumbnailChunk,
        thumbnailOffset: f.thumbnailOffset,
        thumbnailSize: f.thumbnailSize,
      };
    });

    const folders: ArchiveFolderEntry[] = (data.folders || []).map((f: any, index: number) => ({
      id: f.id || `folder-${index}`,
      name: f.name || `folder-${index}`,
      path: f.path || f.name || `folder-${index}`,
      fileCount: f.fileCount || 0,
      totalSize: f.totalSize || 0,
      parentId: f.parentId,
    }));

    return {
      version: data.version || 1,
      createdAt: data.createdAt || Date.now(),
      originalSize: data.originalSize || files.reduce((sum, f) => sum + f.size, 0),
      compressedSize: data.compressedSize || file.size,
      fileCount: files.length,
      folderCount: folders.length,
      compressionMode: data.compressionMode || 'auto',
      encrypted: data.encrypted || false,
      files,
      folders,
      chunkTable: [],
    };
  }

  /**
   * Get file extension
   */
  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot < 0) return '';
    return filename.slice(lastDot).toLowerCase();
  }

  /**
   * Check if file type is previewable
   */
  private isPreviewable(mimeType: string): boolean {
    const previewType = MIME_TO_PREVIEW[mimeType];
    return previewType !== undefined && previewType !== 'unknown';
  }

  /**
   * Get uint64 from buffer (little endian)
   */
  private getUint64(buffer: Uint8Array, offset: number): number {
    const view = new DataView(buffer.buffer);
    // JavaScript doesn't support true uint64, use float64 approximation
    const low = view.getUint32(offset, true);
    const high = view.getUint32(offset + 4, true);
    return low + high * 0x100000000;
  }

  /**
   * Quick scan without reading manifest
   * Just validates and returns basic info
   */
  async quickScan(file: File): Promise<{ valid: boolean; size: number; encrypted: boolean }> {
    try {
      const header = await this.readHeader(file);
      const valid = this.validateMagic(header);
      
      // Check encryption flag (byte 8)
      const encrypted = header[8] === 1;

      return { valid, size: file.size, encrypted };
    } catch {
      return { valid: false, size: file.size, encrypted: false };
    }
  }
}

/**
 * Create archive scanner instance
 */
export function createArchiveScanner(options?: Partial<ScanOptions>): ArchiveScanner {
  return new ArchiveScanner(options);
}
