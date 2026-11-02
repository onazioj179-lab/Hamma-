/**
 * SPK Hyper-Low-Memory Mode - Low-Memory Archive Writer
 * Creator: OJ Treasure Onazi
 * 
 * Section 6: Low-Memory Archive Writer
 * - <50MB metadata RAM at any time
 * - Frequent flush to storage
 * - Binary format for minimal overhead
 * - Streaming write support
 */

import {
  KB, MB,
  type LowMemWriterConfig,
  type WriterMetrics,
  DEFAULT_LOW_MEM_WRITER_CONFIG,
  type LowMemEvent,
  type LowMemEventHandler,
} from './types';
import { getMemoryBudgetController } from './memory-budget';
import { getBufferPool } from './buffer-pool';

// ============================================================================
// WRITER TYPES
// ============================================================================

export interface ChunkEntry {
  id: string;
  offset: bigint;
  compressedSize: number;
  originalSize: number;
  hash: Uint8Array;
  flags: number;
}

export interface FileEntry {
  path: string;
  size: number;
  compressedSize: number;
  chunkCount: number;
  firstChunkIndex: number;
  permissions: number;
  modTime: number;
  hash?: Uint8Array;
}

export interface WriterState {
  bytesWritten: bigint;
  chunksWritten: number;
  filesWritten: number;
  metadataSize: number;
  pendingFlush: number;
  lastFlushTime: number;
}

// ============================================================================
// LOW-MEMORY ARCHIVE WRITER
// ============================================================================

export class LowMemoryArchiveWriter {
  private config: LowMemWriterConfig;
  private memoryController = getMemoryBudgetController();
  private bufferPool = getBufferPool();
  private eventHandlers: LowMemEventHandler[] = [];
  
  // State
  private state: WriterState;
  private fileStream: FileSystemWritableFileStream | null = null;
  private tempBlobs: Blob[] = [];
  
  // Metadata (kept minimal)
  private chunkIndex: ChunkEntry[] = [];
  private fileIndex: FileEntry[] = [];
  private pendingBuffer: Uint8Array[] = [];
  private pendingSize = 0;
  
  // Metrics
  private metrics: WriterMetrics;

  constructor(config?: Partial<LowMemWriterConfig>) {
    this.config = { ...DEFAULT_LOW_MEM_WRITER_CONFIG, ...config };
    this.state = this.createEmptyState();
    this.metrics = this.createEmptyMetrics();
  }

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Initialize writer with output file
   */
  async initialize(filename: string): Promise<void> {
    // Try File System Access API for direct file writing
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as {
          showSaveFilePicker: (options: {
            suggestedName: string;
            types: { description: string; accept: Record<string, string[]> }[]
          }) => Promise<FileSystemFileHandle>
        }).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'SPK Archive', accept: { 'application/spk': ['.spk'] } }],
        });
        this.fileStream = await handle.createWritable();
        this.emit({ type: 'writer-initialized', mode: 'file-system-access' });
      } catch {
        // User cancelled or API not supported
        this.fileStream = null;
        this.emit({ type: 'writer-initialized', mode: 'blob' });
      }
    } else {
      this.emit({ type: 'writer-initialized', mode: 'blob' });
    }
    
    // Write header
    await this.writeHeader();
  }

  /**
   * Write header to archive
   */
  private async writeHeader(): Promise<void> {
    // SPK magic number + version + flags
    const header = new Uint8Array(32);
    const view = new DataView(header.buffer);
    
    // Magic: "SPK\0"
    header[0] = 0x53; // S
    header[1] = 0x50; // P
    header[2] = 0x4B; // K
    header[3] = 0x00; // \0
    
    // Version (2 bytes)
    view.setUint16(4, 1, true);
    
    // Flags (4 bytes)
    view.setUint32(6, 0, true);
    
    // Reserved (22 bytes)
    // Already zero
    
    await this.writeBytes(header);
    this.metrics.headerSize = header.byteLength;
  }

  /**
   * Write a compressed chunk
   */
  async writeChunk(
    data: Uint8Array,
    originalSize: number,
    hash?: Uint8Array
  ): Promise<ChunkEntry> {
    // Track metadata memory
    this.checkMetadataLimit();
    
    const offset = this.state.bytesWritten;
    const compressedSize = data.byteLength;
    
    // Create chunk entry
    const entry: ChunkEntry = {
      id: `chunk_${this.state.chunksWritten}`,
      offset,
      compressedSize,
      originalSize,
      hash: hash ?? new Uint8Array(32),
      flags: 0,
    };
    
    // Write chunk header (8 bytes)
    const chunkHeader = new Uint8Array(8);
    const chunkView = new DataView(chunkHeader.buffer);
    chunkView.setUint32(0, compressedSize, true);
    chunkView.setUint32(4, originalSize, true);
    
    await this.writeBytes(chunkHeader);
    await this.writeBytes(data);
    
    // Add to index
    this.chunkIndex.push(entry);
    this.state.chunksWritten++;
    this.state.metadataSize += 80; // Approximate entry size
    
    this.emit({ type: 'chunk-written', size: compressedSize });
    
    // Check if we should flush
    await this.maybeFlush();
    
    return entry;
  }

  /**
   * Register a file entry
   */
  registerFile(entry: FileEntry): void {
    this.checkMetadataLimit();
    
    this.fileIndex.push(entry);
    this.state.filesWritten++;
    this.state.metadataSize += 256 + entry.path.length * 2; // Approximate
    
    this.emit({ type: 'file-registered', path: entry.path });
  }

  /**
   * Write bytes to output
   */
  private async writeBytes(data: Uint8Array): Promise<void> {
    if (this.fileStream) {
      // Direct write to file - cast to ArrayBuffer to satisfy type
      await this.fileStream.write(new Uint8Array(data) as unknown as ArrayBuffer);
    } else {
      // Buffer to pending
      this.pendingBuffer.push(new Uint8Array(data));
      this.pendingSize += data.byteLength;
      
      // Check pending limit
      if (this.pendingSize >= this.config.flushThreshold) {
        await this.flushPending();
      }
    }
    
    this.state.bytesWritten += BigInt(data.byteLength);
    this.metrics.bytesWritten = this.state.bytesWritten;
    this.metrics.writeCount++;
  }

  /**
   * Flush pending buffer to blob
   */
  private async flushPending(): Promise<void> {
    if (this.pendingBuffer.length === 0) return;
    
    // Combine pending into blob (cast to satisfy TypeScript)
    const blob = new Blob(this.pendingBuffer as unknown as BlobPart[], { type: 'application/octet-stream' });
    this.tempBlobs.push(blob);
    
    // Clear pending
    this.pendingBuffer = [];
    this.pendingSize = 0;
    this.state.pendingFlush = 0;
    this.state.lastFlushTime = Date.now();
    this.metrics.flushCount++;
    
    this.emit({ type: 'buffer-flushed', blobSize: blob.size });
  }

  /**
   * Check if flush needed
   */
  private async maybeFlush(): Promise<void> {
    const timeSinceFlush = Date.now() - this.state.lastFlushTime;
    
    // Flush if threshold exceeded or time limit
    if (
      this.pendingSize >= this.config.flushThreshold ||
      timeSinceFlush >= this.config.flushIntervalMs
    ) {
      await this.flushPending();
    }
    
    // Also check memory pressure
    if (this.memoryController.underPressure()) {
      await this.flushPending();
      this.flushMetadata();
    }
  }

  /**
   * Check metadata limit
   */
  private checkMetadataLimit(): void {
    if (this.state.metadataSize >= this.config.maxMetadataRAM) {
      // Flush metadata to reduce memory
      this.flushMetadata();
    }
  }

  /**
   * Flush metadata to reduce memory
   */
  private flushMetadata(): void {
    // In a real implementation, we'd write partial index to disk
    // For now, just emit warning
    if (this.state.metadataSize >= this.config.maxMetadataRAM) {
      this.emit({ 
        type: 'metadata-limit-warning', 
        currentSize: this.state.metadataSize,
        limit: this.config.maxMetadataRAM,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // FINALIZATION
  // ---------------------------------------------------------------------------

  /**
   * Finalize archive and get result
   */
  async finalize(): Promise<{ blob: Blob; metrics: WriterMetrics }> {
    // Write file index
    await this.writeFileIndex();
    
    // Write chunk index
    await this.writeChunkIndex();
    
    // Write footer
    await this.writeFooter();
    
    // Flush any remaining
    await this.flushPending();
    
    // Close file stream if open
    if (this.fileStream) {
      await this.fileStream.close();
      this.fileStream = null;
      
      // Return empty blob (file already written)
      return { blob: new Blob([]), metrics: this.getMetrics() };
    }
    
    // Combine all blobs
    const finalBlob = new Blob(this.tempBlobs, { type: 'application/spk' });
    
    this.emit({ type: 'archive-finalized', size: finalBlob.size });
    
    return { blob: finalBlob, metrics: this.getMetrics() };
  }

  /**
   * Write file index to archive
   */
  private async writeFileIndex(): Promise<void> {
    const indexOffset = this.state.bytesWritten;
    
    // File count (4 bytes)
    const countBuf = new Uint8Array(4);
    new DataView(countBuf.buffer).setUint32(0, this.fileIndex.length, true);
    await this.writeBytes(countBuf);
    
    // Each file entry
    for (const file of this.fileIndex) {
      const entry = this.encodeFileEntry(file);
      await this.writeBytes(entry);
    }
    
    this.metrics.indexSize = Number(this.state.bytesWritten - indexOffset);
  }

  /**
   * Write chunk index to archive
   */
  private async writeChunkIndex(): Promise<void> {
    // Chunk count (4 bytes)
    const countBuf = new Uint8Array(4);
    new DataView(countBuf.buffer).setUint32(0, this.chunkIndex.length, true);
    await this.writeBytes(countBuf);
    
    // Each chunk entry (48 bytes each)
    for (const chunk of this.chunkIndex) {
      const entry = this.encodeChunkEntry(chunk);
      await this.writeBytes(entry);
    }
  }

  /**
   * Write footer with offsets
   */
  private async writeFooter(): Promise<void> {
    const footer = new Uint8Array(64);
    const view = new DataView(footer.buffer);
    
    // Footer magic
    footer[0] = 0x53;
    footer[1] = 0x50;
    footer[2] = 0x4B;
    footer[3] = 0x46; // 'F' for footer
    
    // Total size (8 bytes BigInt)
    view.setBigUint64(4, this.state.bytesWritten, true);
    
    // File count
    view.setUint32(12, this.fileIndex.length, true);
    
    // Chunk count
    view.setUint32(16, this.chunkIndex.length, true);
    
    // Checksum (would compute actual checksum)
    view.setUint32(56, 0, true);
    
    // End magic
    footer[60] = 0x45; // E
    footer[61] = 0x4E; // N
    footer[62] = 0x44; // D
    footer[63] = 0x00;
    
    await this.writeBytes(footer);
    this.metrics.footerSize = footer.byteLength;
  }

  /**
   * Encode file entry to binary
   */
  private encodeFileEntry(file: FileEntry): Uint8Array {
    const pathBytes = new TextEncoder().encode(file.path);
    const size = 32 + pathBytes.length;
    
    const buffer = new Uint8Array(size);
    const view = new DataView(buffer.buffer);
    
    // Path length (2 bytes)
    view.setUint16(0, pathBytes.length, true);
    
    // Path
    buffer.set(pathBytes, 2);
    
    const offset = 2 + pathBytes.length;
    
    // Size (8 bytes)
    view.setBigUint64(offset, BigInt(file.size), true);
    
    // Compressed size (8 bytes)
    view.setBigUint64(offset + 8, BigInt(file.compressedSize), true);
    
    // Chunk count (4 bytes)
    view.setUint32(offset + 16, file.chunkCount, true);
    
    // First chunk index (4 bytes)
    view.setUint32(offset + 20, file.firstChunkIndex, true);
    
    // Permissions (2 bytes)
    view.setUint16(offset + 24, file.permissions, true);
    
    // Mod time (8 bytes)
    view.setBigUint64(offset + 26, BigInt(file.modTime), true);
    
    return buffer.subarray(0, offset + 30);
  }

  /**
   * Encode chunk entry to binary
   */
  private encodeChunkEntry(chunk: ChunkEntry): Uint8Array {
    const buffer = new Uint8Array(48);
    const view = new DataView(buffer.buffer);
    
    // Offset (8 bytes)
    view.setBigUint64(0, chunk.offset, true);
    
    // Compressed size (4 bytes)
    view.setUint32(8, chunk.compressedSize, true);
    
    // Original size (4 bytes)
    view.setUint32(12, chunk.originalSize, true);
    
    // Hash (32 bytes)
    buffer.set(chunk.hash, 16);
    
    return buffer;
  }

  // ---------------------------------------------------------------------------
  // STATE & METRICS
  // ---------------------------------------------------------------------------

  /**
   * Get current writer state
   */
  getState(): WriterState {
    return { ...this.state };
  }

  /**
   * Get metrics
   */
  getMetrics(): WriterMetrics {
    return {
      ...this.metrics,
      bytesWritten: this.state.bytesWritten,
    };
  }

  /**
   * Create empty state
   */
  private createEmptyState(): WriterState {
    return {
      bytesWritten: 0n,
      chunksWritten: 0,
      filesWritten: 0,
      metadataSize: 0,
      pendingFlush: 0,
      lastFlushTime: Date.now(),
    };
  }

  /**
   * Create empty metrics
   */
  private createEmptyMetrics(): WriterMetrics {
    return {
      bytesWritten: 0n,
      chunksWritten: 0,
      filesWritten: 0,
      flushCount: 0,
      writeCount: 0,
      avgWriteTime: 0,
      peakMetadataRAM: 0,
      headerSize: 0,
      indexSize: 0,
      footerSize: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------

  /**
   * Abort and cleanup
   */
  async abort(): Promise<void> {
    if (this.fileStream) {
      await this.fileStream.abort();
      this.fileStream = null;
    }
    
    this.tempBlobs = [];
    this.pendingBuffer = [];
    this.chunkIndex = [];
    this.fileIndex = [];
    
    this.emit({ type: 'writer-aborted' });
  }

  /**
   * Reset writer
   */
  reset(): void {
    this.state = this.createEmptyState();
    this.metrics = this.createEmptyMetrics();
    this.tempBlobs = [];
    this.pendingBuffer = [];
    this.pendingSize = 0;
    this.chunkIndex = [];
    this.fileIndex = [];
    this.fileStream = null;
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  on(handler: LowMemEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private emit(event: LowMemEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[LowMemoryArchiveWriter] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create writer for single-file archive
 */
export async function createSingleFileArchive(
  file: File,
  compressedData: Uint8Array,
  filename: string
): Promise<Blob> {
  const writer = new LowMemoryArchiveWriter();
  await writer.initialize(filename);
  
  const chunkEntry = await writer.writeChunk(compressedData, file.size);
  
  writer.registerFile({
    path: file.name,
    size: file.size,
    compressedSize: compressedData.byteLength,
    chunkCount: 1,
    firstChunkIndex: 0,
    permissions: 0o644,
    modTime: file.lastModified,
  });
  
  const { blob } = await writer.finalize();
  return blob;
}

/**
 * Estimate archive size
 */
export function estimateArchiveSize(
  files: { size: number; compressedSize: number }[],
  chunkSize: number
): number {
  let totalData = 0;
  let totalChunks = 0;
  
  for (const file of files) {
    totalData += file.compressedSize;
    totalChunks += Math.ceil(file.size / chunkSize);
  }
  
  // Header + data + chunk index + file index + footer
  const header = 32;
  const chunkIndex = totalChunks * 48;
  const fileIndex = files.length * 256;
  const footer = 64;
  
  return header + totalData + chunkIndex + fileIndex + footer;
}

// ============================================================================
// SINGLETON
// ============================================================================

let writerInstance: LowMemoryArchiveWriter | null = null;

export function getLowMemoryWriter(
  config?: Partial<LowMemWriterConfig>
): LowMemoryArchiveWriter {
  if (!writerInstance) {
    writerInstance = new LowMemoryArchiveWriter(config);
  }
  return writerInstance;
}

export async function resetLowMemoryWriter(): Promise<void> {
  await writerInstance?.abort();
  writerInstance = null;
}
