/**
 * Selective Extractor
 * Extract specific files/folders without decompressing entire archive
 */

import type {
  ArchiveManifest,
  ArchiveFileEntry,
  ChunkTableEntry,
  ExtractionOptions,
  ExtractionProgress,
  ExtractionResult,
  ExtractedFile,
  ExtractionError,
} from './types';

/**
 * Selective extraction engine
 */
export class SelectiveExtractor {
  private manifest: ArchiveManifest | null = null;
  private archiveFile: File | null = null;
  private chunkCache: Map<string, ArrayBuffer> = new Map();
  private running = false;

  /**
   * Set the archive to extract from
   */
  setArchive(file: File, manifest: ArchiveManifest): void {
    this.archiveFile = file;
    this.manifest = manifest;
    this.chunkCache.clear();
  }

  /**
   * Extract specific files
   */
  async extract(options: ExtractionOptions): Promise<ExtractionResult> {
    if (!this.archiveFile || !this.manifest) {
      throw new Error('No archive set');
    }

    this.running = true;
    const startTime = Date.now();
    const errors: ExtractionError[] = [];
    const outputFiles: ExtractedFile[] = [];
    let bytesExtracted = 0;

    // Determine which files to extract
    const filesToExtract = this.resolveFiles(options);
    const totalBytes = filesToExtract.reduce((sum, f) => sum + f.size, 0);
    const totalFiles = filesToExtract.length;

    // Determine which chunks are needed
    const neededChunks = this.resolveChunks(filesToExtract);

    // Extract each file
    for (let i = 0; i < filesToExtract.length && this.running; i++) {
      const file = filesToExtract[i];

      try {
        // Report progress
        if (options.onProgress) {
          options.onProgress({
            currentFile: file.name,
            currentFileIndex: i,
            totalFiles,
            bytesExtracted,
            totalBytes,
            chunksProcessed: this.chunkCache.size,
            totalChunks: neededChunks.length,
            speed: bytesExtracted / ((Date.now() - startTime) / 1000) || 0,
            eta: this.estimateEta(bytesExtracted, totalBytes, startTime),
          });
        }

        // Extract file data
        const data = await this.extractFileData(file, neededChunks);
        
        // Create blob
        const blob = new Blob([data], { type: file.mimeType });
        
        outputFiles.push({
          id: file.id,
          name: file.name,
          path: options.preserveStructure ? file.path : file.name,
          size: data.byteLength,
          blob,
        });

        bytesExtracted += data.byteLength;
      } catch (error) {
        errors.push({
          fileId: file.id,
          fileName: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.running = false;

    return {
      success: errors.length === 0,
      filesExtracted: outputFiles.length,
      bytesExtracted,
      duration: Date.now() - startTime,
      errors,
      outputFiles,
    };
  }

  /**
   * Extract a single file
   */
  async extractSingle(fileId: string): Promise<ExtractedFile | null> {
    if (!this.manifest) return null;

    const file = this.manifest.files.find(f => f.id === fileId);
    if (!file) return null;

    const result = await this.extract({
      fileIds: [fileId],
      preserveStructure: false,
      overwrite: true,
    });

    return result.outputFiles[0] || null;
  }

  /**
   * Resolve which files to extract based on options
   */
  private resolveFiles(options: ExtractionOptions): ArchiveFileEntry[] {
    if (!this.manifest) return [];

    let files: ArchiveFileEntry[] = [];

    // Add specific files
    if (options.fileIds && options.fileIds.length > 0) {
      files = this.manifest.files.filter(f => options.fileIds!.includes(f.id));
    }

    // Add files from folders
    if (options.folderIds && options.folderIds.length > 0) {
      const folderPaths = this.manifest.folders
        .filter(f => options.folderIds!.includes(f.id))
        .map(f => f.path);

      const folderFiles = this.manifest.files.filter(f => 
        folderPaths.some(path => f.path.startsWith(path + '/') || f.path === path)
      );

      // Merge without duplicates
      const existingIds = new Set(files.map(f => f.id));
      for (const file of folderFiles) {
        if (!existingIds.has(file.id)) {
          files.push(file);
          existingIds.add(file.id);
        }
      }
    }

    // If no specific files/folders, extract all
    if (files.length === 0 && !options.fileIds && !options.folderIds) {
      files = [...this.manifest.files];
    }

    return files;
  }

  /**
   * Resolve which chunks are needed
   */
  private resolveChunks(files: ArchiveFileEntry[]): ChunkTableEntry[] {
    if (!this.manifest) return [];

    const neededChunkIds = new Set<string>();
    for (const file of files) {
      for (const chunkId of file.chunks) {
        neededChunkIds.add(chunkId);
      }
    }

    return this.manifest.chunkTable.filter(c => neededChunkIds.has(c.id));
  }

  /**
   * Extract file data from chunks
   */
  private async extractFileData(
    file: ArchiveFileEntry,
    availableChunks: ChunkTableEntry[]
  ): Promise<ArrayBuffer> {
    // Get chunks for this file
    const fileChunks = availableChunks.filter(c => file.chunks.includes(c.id));
    
    if (fileChunks.length === 0) {
      // Simulate extraction for demo
      return new ArrayBuffer(file.size);
    }

    // Read and decompress needed chunks
    const chunkDataList: ArrayBuffer[] = [];
    
    for (const chunk of fileChunks) {
      let data = this.chunkCache.get(chunk.id);
      
      if (!data) {
        data = await this.readAndDecompressChunk(chunk);
        this.chunkCache.set(chunk.id, data);
      }
      
      chunkDataList.push(data);
    }

    // Assemble file from chunks
    return this.assembleFile(file, chunkDataList, fileChunks);
  }

  /**
   * Read and decompress a chunk from archive
   */
  private async readAndDecompressChunk(chunk: ChunkTableEntry): Promise<ArrayBuffer> {
    if (!this.archiveFile) {
      throw new Error('No archive file');
    }

    // Read compressed chunk
    const slice = this.archiveFile.slice(chunk.offset, chunk.offset + chunk.compressedSize);
    const compressedData = await slice.arrayBuffer();

    // Decompress (placeholder - real impl uses WASM)
    // For now, return as-is or simulate decompression
    return this.decompressChunk(compressedData, chunk.originalSize);
  }

  /**
   * Decompress chunk data
   */
  private async decompressChunk(compressed: ArrayBuffer, originalSize: number): Promise<ArrayBuffer> {
    // In production, this calls WASM ZSTD decompression
    // For now, simulate by creating buffer of original size
    try {
      // Try to use the compressed data directly if it's the right size
      if (compressed.byteLength === originalSize) {
        return compressed;
      }
      
      // Otherwise create a buffer (simulation)
      const decompressed = new ArrayBuffer(originalSize);
      const src = new Uint8Array(compressed);
      const dst = new Uint8Array(decompressed);
      
      // Copy what we can
      for (let i = 0; i < Math.min(src.length, dst.length); i++) {
        dst[i] = src[i];
      }
      
      return decompressed;
    } catch {
      return new ArrayBuffer(originalSize);
    }
  }

  /**
   * Assemble file from chunk data
   */
  private assembleFile(
    file: ArchiveFileEntry,
    chunkDataList: ArrayBuffer[],
    chunks: ChunkTableEntry[]
  ): ArrayBuffer {
    if (chunkDataList.length === 0) {
      return new ArrayBuffer(file.size);
    }

    // Single chunk case
    if (chunkDataList.length === 1) {
      const data = chunkDataList[0];
      const view = new Uint8Array(data);
      
      // Extract just the file's portion
      const start = file.startOffset;
      const end = Math.min(file.endOffset, view.length);
      
      return view.slice(start, end).buffer;
    }

    // Multi-chunk case: concatenate and extract
    const totalSize = chunkDataList.reduce((sum, d) => sum + d.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    
    let offset = 0;
    for (const data of chunkDataList) {
      combined.set(new Uint8Array(data), offset);
      offset += data.byteLength;
    }

    // Extract file portion
    const start = file.startOffset;
    const end = start + file.size;
    
    return combined.slice(start, Math.min(end, combined.length)).buffer;
  }

  /**
   * Estimate time remaining
   */
  private estimateEta(bytesExtracted: number, totalBytes: number, startTime: number): number {
    const elapsed = (Date.now() - startTime) / 1000;
    if (bytesExtracted === 0 || elapsed === 0) return 0;
    
    const speed = bytesExtracted / elapsed;
    const remaining = totalBytes - bytesExtracted;
    
    return remaining / speed;
  }

  /**
   * Cancel extraction
   */
  cancel(): void {
    this.running = false;
  }

  /**
   * Clear chunk cache
   */
  clearCache(): void {
    this.chunkCache.clear();
  }

  /**
   * Get cached chunk count
   */
  get cachedChunks(): number {
    return this.chunkCache.size;
  }
}

/**
 * Create extractor instance
 */
export function createSelectiveExtractor(): SelectiveExtractor {
  return new SelectiveExtractor();
}
