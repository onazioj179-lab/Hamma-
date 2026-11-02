/**
 * SPK Implementation Blueprint - Chunk Reader
 * 
 * Reads files and splits them into chunks for compression.
 * Handles streaming reads and manifest parsing for decompression.
 * 
 * @module core/pipeline/chunkReader
 * @version 1.0.0
 */

import type { Chunk } from './scheduler';

// ============================================================================
// Types
// ============================================================================

export interface ReadConfig {
  defaultChunkSize: number;
  maxConcurrentReads: number;
  bufferSize: number;
  useStreaming: boolean;
}

export interface FileManifest {
  version: number;
  files: FileEntry[];
  chunks: ChunkMetadata[];
  metadata: ArchiveMetadata;
  checksum: string;
}

export interface FileEntry {
  path: string;
  size: number;
  compressedSize: number;
  checksum: string;
  chunkIds: string[];
  modified: number;
  permissions?: number;
}

export interface ChunkMetadata {
  id: string;
  fileId: string;
  index: number;
  offset: number;
  size: number;
  compressedSize: number;
  checksum: string;
}

export interface ArchiveMetadata {
  created: number;
  version: string;
  compression: string;
  encrypted: boolean;
  totalSize: number;
  totalCompressedSize: number;
  fileCount: number;
  chunkCount: number;
}

export interface ReadProgress {
  bytesRead: number;
  chunksRead: number;
  currentFile: string;
}

// ============================================================================
// Chunk Reader
// ============================================================================

/**
 * Reads and chunks files for compression pipeline.
 * Also handles reading compressed archives for decompression.
 */
export class ChunkReader {
  private activeReads = 0;
  private readQueue: Array<() => Promise<void>> = [];

  constructor(private config: ReadConfig) {}

  /**
   * Scan files and create chunk descriptors.
   */
  async scanFiles(files: File[], chunkSize?: number): Promise<Chunk[]> {
    const size = chunkSize ?? this.config.defaultChunkSize;
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      const fileId = `file_${fileIndex}`;
      const numChunks = Math.ceil(file.size / size);

      for (let i = 0; i < numChunks; i++) {
        const offset = i * size;
        const chunkSize = Math.min(size, file.size - offset);

        chunks.push({
          id: `chunk_${chunkIndex++}`,
          jobId: '', // Will be set by coordinator
          fileId,
          index: i,
          offset,
          size: chunkSize,
          priority: 0,
          state: 'pending',
          attempts: 0,
          createdAt: Date.now(),
        });
      }
    }

    return chunks;
  }

  /**
   * Read chunk data from a file.
   */
  async readChunk(file: File, chunk: Chunk): Promise<Uint8Array> {
    // Wait for available slot
    if (this.activeReads >= this.config.maxConcurrentReads) {
      await new Promise<void>(resolve => {
        this.readQueue.push(() => Promise.resolve(resolve()));
      });
    }

    this.activeReads++;

    try {
      if (this.config.useStreaming && typeof file.stream === 'function') {
        return await this.readChunkStreaming(file, chunk);
      } else {
        return await this.readChunkSlice(file, chunk);
      }
    } finally {
      this.activeReads--;
      
      // Process next queued read
      const next = this.readQueue.shift();
      if (next) next();
    }
  }

  /**
   * Read chunk using File.slice (traditional method).
   */
  private async readChunkSlice(file: File, chunk: Chunk): Promise<Uint8Array> {
    const blob = file.slice(chunk.offset, chunk.offset + chunk.size);
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Read chunk using streaming API.
   */
  private async readChunkStreaming(file: File, chunk: Chunk): Promise<Uint8Array> {
    const stream = file.stream();
    const reader = stream.getReader();
    
    const buffer = new Uint8Array(chunk.size);
    let position = 0;
    let bytesSkipped = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        // Skip bytes until we reach chunk offset
        if (bytesSkipped < chunk.offset) {
          const skipAmount = Math.min(value.length, chunk.offset - bytesSkipped);
          bytesSkipped += skipAmount;
          
          if (skipAmount < value.length) {
            // We're at the chunk, copy remaining bytes
            const copyAmount = Math.min(value.length - skipAmount, chunk.size - position);
            buffer.set(value.slice(skipAmount, skipAmount + copyAmount), position);
            position += copyAmount;
          }
          continue;
        }

        // Copy chunk data
        const copyAmount = Math.min(value.length, chunk.size - position);
        buffer.set(value.slice(0, copyAmount), position);
        position += copyAmount;

        if (position >= chunk.size) break;
      }

      return buffer.slice(0, position);

    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Read archive manifest for decompression.
   */
  async readManifest(archive: Blob): Promise<FileManifest> {
    // Read last 512 bytes for manifest footer
    const footerSize = 512;
    const footerBlob = archive.slice(-footerSize);
    const footerBuffer = await footerBlob.arrayBuffer();
    const footerView = new DataView(footerBuffer);

    // Read manifest offset (last 8 bytes)
    const manifestOffset = Number(footerView.getBigUint64(footerSize - 8, true));
    const manifestSize = Number(footerView.getBigUint64(footerSize - 16, true));

    // Read manifest
    const manifestBlob = archive.slice(manifestOffset, manifestOffset + manifestSize);
    const manifestBuffer = await manifestBlob.arrayBuffer();
    const manifestText = new TextDecoder().decode(manifestBuffer);

    try {
      return JSON.parse(manifestText) as FileManifest;
    } catch (error) {
      throw new Error('Invalid archive manifest');
    }
  }

  /**
   * Read chunks for a specific file from archive.
   */
  async readFileChunks(archive: Blob, file: FileEntry): Promise<Chunk[]> {
    const manifest = await this.readManifest(archive);
    const fileChunks: Chunk[] = [];

    for (const chunkId of file.chunkIds) {
      const metadata = manifest.chunks.find(c => c.id === chunkId);
      if (!metadata) continue;

      // Read compressed chunk data
      const chunkBlob = archive.slice(
        metadata.offset,
        metadata.offset + metadata.compressedSize
      );
      const chunkData = new Uint8Array(await chunkBlob.arrayBuffer());

      fileChunks.push({
        id: metadata.id,
        jobId: '', // Will be set by coordinator
        fileId: metadata.fileId,
        index: metadata.index,
        offset: metadata.offset,
        size: metadata.size,
        data: chunkData,
        priority: 0,
        state: 'pending',
        attempts: 0,
        createdAt: Date.now(),
      });
    }

    return fileChunks;
  }

  /**
   * Read chunk by ID from archive.
   */
  async readChunkById(archive: Blob, chunkId: string): Promise<Uint8Array> {
    const manifest = await this.readManifest(archive);
    const metadata = manifest.chunks.find(c => c.id === chunkId);
    
    if (!metadata) {
      throw new Error(`Chunk ${chunkId} not found in archive`);
    }

    const chunkBlob = archive.slice(
      metadata.offset,
      metadata.offset + metadata.compressedSize
    );
    
    return new Uint8Array(await chunkBlob.arrayBuffer());
  }

  /**
   * Get file entry from manifest by path.
   */
  async getFileEntry(archive: Blob, path: string): Promise<FileEntry | null> {
    const manifest = await this.readManifest(archive);
    return manifest.files.find(f => f.path === path) ?? null;
  }

  /**
   * List all files in archive.
   */
  async listFiles(archive: Blob): Promise<string[]> {
    const manifest = await this.readManifest(archive);
    return manifest.files.map(f => f.path);
  }

  /**
   * Get archive metadata.
   */
  async getArchiveMetadata(archive: Blob): Promise<ArchiveMetadata> {
    const manifest = await this.readManifest(archive);
    return manifest.metadata;
  }

  /**
   * Validate archive integrity.
   */
  async validateArchive(archive: Blob): Promise<boolean> {
    try {
      const manifest = await this.readManifest(archive);
      
      // Verify manifest structure
      if (!manifest.version || !manifest.files || !manifest.chunks) {
        return false;
      }

      // Verify all referenced chunks exist
      for (const file of manifest.files) {
        for (const chunkId of file.chunkIds) {
          const chunk = manifest.chunks.find(c => c.id === chunkId);
          if (!chunk) return false;
        }
      }

      return true;

    } catch {
      return false;
    }
  }

  /**
   * Create a streaming reader for large files.
   */
  createStreamReader(file: File, chunkSize?: number): ReadableStream<Chunk> {
    const size = chunkSize ?? this.config.defaultChunkSize;
    let offset = 0;
    let chunkIndex = 0;

    return new ReadableStream({
      pull: async (controller) => {
        if (offset >= file.size) {
          controller.close();
          return;
        }

        const currentSize = Math.min(size, file.size - offset);
        const blob = file.slice(offset, offset + currentSize);
        const data = new Uint8Array(await blob.arrayBuffer());

        const chunk: Chunk = {
          id: `chunk_${chunkIndex++}`,
          jobId: '',
          fileId: 'stream',
          index: chunkIndex - 1,
          offset,
          size: currentSize,
          data,
          priority: 0,
          state: 'pending',
          attempts: 0,
          createdAt: Date.now(),
        };

        controller.enqueue(chunk);
        offset += currentSize;
      },
    });
  }

  /**
   * Reset reader state.
   */
  reset(): void {
    this.activeReads = 0;
    this.readQueue = [];
  }
}

// ============================================================================
// Exports
// ============================================================================

export default ChunkReader;
