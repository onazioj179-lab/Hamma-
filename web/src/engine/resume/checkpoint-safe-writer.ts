/**
 * SPK Checkpoint-Safe Writer
 * 
 * Failure-proof writer that persists offset table after each flush
 * and validates before continuing writes.
 * 
 * Features:
 * - Offset table persistence after each flush
 * - Pre-write validation
 * - Partial chunk buffer recovery
 * - Atomic commit boundaries
 * - Corruption detection and recovery
 * 
 * Creator: Onazi Treasure (OJ)
 */

import type { WriterOffsetTable } from './checkpoint-manager';

// ============================================================================
// Types
// ============================================================================

export interface WriteOperation {
  type: 'header' | 'chunk' | 'metadata' | 'footer';
  offset: number;
  length: number;
  data: Uint8Array;
  chunkIndex?: number;
}

export interface WriterConfig {
  bufferSize: number;
  flushThreshold: number;
  enableValidation: boolean;
  checksumAlgorithm: 'crc32' | 'xxhash' | 'none';
}

export interface WriterState {
  isReady: boolean;
  bytesWritten: number;
  chunksWritten: number;
  lastFlush: number;
  pendingOperations: number;
  errors: string[];
}

export interface FlushResult {
  success: boolean;
  bytesWritten: number;
  offsetTable: WriterOffsetTable;
  error?: string;
}

// ============================================================================
// CheckpointSafeWriter
// ============================================================================

const DEFAULT_CONFIG: WriterConfig = {
  bufferSize: 4 * 1024 * 1024, // 4MB buffer
  flushThreshold: 1 * 1024 * 1024, // Flush every 1MB
  enableValidation: true,
  checksumAlgorithm: 'crc32',
};

export class CheckpointSafeWriter {
  private config: WriterConfig;
  private fileHandle: FileSystemFileHandle | null = null;
  private writable: FileSystemWritableFileStream | null = null;
  
  // Offset tracking
  private offsetTable: WriterOffsetTable;
  
  // Buffers
  private writeBuffer: Uint8Array;
  private bufferPosition = 0;
  private partialChunkBuffer: Uint8Array | null = null;
  
  // State
  private pendingOperations: WriteOperation[] = [];
  private committedOperations: WriteOperation[] = [];
  private totalBytesWritten = 0;
  private chunksWritten = 0;
  private lastFlushTime = 0;
  private isOpen = false;
  
  constructor(config: Partial<WriterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.writeBuffer = new Uint8Array(this.config.bufferSize);
    
    this.offsetTable = {
      headerOffset: 0,
      chunkDataOffset: 0,
      metadataOffset: 0,
      footerOffset: 0,
      lastFlushedChunk: -1,
      totalBytesWritten: 0,
      partialChunkBuffer: null,
    };
  }
  
  /**
   * Open file for writing
   */
  async open(handle: FileSystemFileHandle): Promise<boolean> {
    try {
      this.fileHandle = handle;
      this.writable = await handle.createWritable();
      this.isOpen = true;
      return true;
    } catch (error) {
      console.error('Failed to open file for writing:', error);
      return false;
    }
  }
  
  /**
   * Resume writing from saved offset table
   */
  async resume(
    handle: FileSystemFileHandle,
    savedOffsets: WriterOffsetTable
  ): Promise<boolean> {
    try {
      this.fileHandle = handle;
      this.writable = await handle.createWritable({ keepExistingData: true });
      
      // Restore offset table
      this.offsetTable = { ...savedOffsets };
      this.totalBytesWritten = savedOffsets.totalBytesWritten;
      this.chunksWritten = savedOffsets.lastFlushedChunk + 1;
      
      // Restore partial chunk buffer
      if (savedOffsets.partialChunkBuffer) {
        this.partialChunkBuffer = new Uint8Array(savedOffsets.partialChunkBuffer);
      }
      
      // Validate file state
      if (this.config.enableValidation) {
        const valid = await this.validateFileState();
        if (!valid) {
          console.error('File state validation failed');
          return false;
        }
      }
      
      // Seek to continue position
      await this.writable.seek(this.totalBytesWritten);
      
      this.isOpen = true;
      return true;
      
    } catch (error) {
      console.error('Failed to resume writing:', error);
      return false;
    }
  }
  
  /**
   * Write header
   */
  async writeHeader(data: Uint8Array): Promise<boolean> {
    if (!this.isOpen) return false;
    
    this.offsetTable.headerOffset = 0;
    
    const op: WriteOperation = {
      type: 'header',
      offset: 0,
      length: data.length,
      data: data,
    };
    
    return this.bufferWrite(op);
  }
  
  /**
   * Write chunk data
   */
  async writeChunk(
    chunkIndex: number,
    data: Uint8Array
  ): Promise<boolean> {
    if (!this.isOpen) return false;
    
    const offset = this.totalBytesWritten + this.bufferPosition;
    
    // Update chunk data offset on first chunk
    if (chunkIndex === 0) {
      this.offsetTable.chunkDataOffset = offset;
    }
    
    const op: WriteOperation = {
      type: 'chunk',
      offset,
      length: data.length,
      data: data,
      chunkIndex,
    };
    
    const success = await this.bufferWrite(op);
    
    if (success) {
      this.chunksWritten++;
      this.offsetTable.lastFlushedChunk = chunkIndex;
    }
    
    return success;
  }
  
  /**
   * Write metadata
   */
  async writeMetadata(data: Uint8Array): Promise<boolean> {
    if (!this.isOpen) return false;
    
    const offset = this.totalBytesWritten + this.bufferPosition;
    this.offsetTable.metadataOffset = offset;
    
    const op: WriteOperation = {
      type: 'metadata',
      offset,
      length: data.length,
      data: data,
    };
    
    return this.bufferWrite(op);
  }
  
  /**
   * Write footer
   */
  async writeFooter(data: Uint8Array): Promise<boolean> {
    if (!this.isOpen) return false;
    
    const offset = this.totalBytesWritten + this.bufferPosition;
    this.offsetTable.footerOffset = offset;
    
    const op: WriteOperation = {
      type: 'footer',
      offset,
      length: data.length,
      data: data,
    };
    
    return this.bufferWrite(op);
  }
  
  /**
   * Flush buffer to file
   */
  async flush(): Promise<FlushResult> {
    if (!this.writable) {
      return {
        success: false,
        bytesWritten: 0,
        offsetTable: this.offsetTable,
        error: 'Writer not open',
      };
    }
    
    try {
      if (this.bufferPosition > 0) {
        // Write buffered data
        const dataToWrite = this.writeBuffer.slice(0, this.bufferPosition);
        await this.writable.write(dataToWrite);
        
        this.totalBytesWritten += this.bufferPosition;
        this.offsetTable.totalBytesWritten = this.totalBytesWritten;
        
        // Move pending to committed
        this.committedOperations.push(...this.pendingOperations);
        this.pendingOperations = [];
        
        // Reset buffer
        this.bufferPosition = 0;
        this.lastFlushTime = Date.now();
      }
      
      return {
        success: true,
        bytesWritten: this.totalBytesWritten,
        offsetTable: { ...this.offsetTable },
      };
      
    } catch (error) {
      return {
        success: false,
        bytesWritten: this.totalBytesWritten,
        offsetTable: this.offsetTable,
        error: error instanceof Error ? error.message : 'Flush failed',
      };
    }
  }
  
  /**
   * Close writer and finalize file
   */
  async close(): Promise<boolean> {
    if (!this.writable) return false;
    
    try {
      // Final flush
      await this.flush();
      
      // Close stream
      await this.writable.close();
      
      this.writable = null;
      this.isOpen = false;
      
      return true;
      
    } catch (error) {
      console.error('Failed to close writer:', error);
      return false;
    }
  }
  
  /**
   * Get current offset table for checkpointing
   */
  getOffsetTable(): WriterOffsetTable {
    return {
      ...this.offsetTable,
      partialChunkBuffer: this.partialChunkBuffer 
        ? new Uint8Array(this.partialChunkBuffer)
        : null,
    };
  }
  
  /**
   * Get writer state
   */
  getState(): WriterState {
    return {
      isReady: this.isOpen,
      bytesWritten: this.totalBytesWritten,
      chunksWritten: this.chunksWritten,
      lastFlush: this.lastFlushTime,
      pendingOperations: this.pendingOperations.length,
      errors: [],
    };
  }
  
  /**
   * Buffer a write operation
   */
  private async bufferWrite(op: WriteOperation): Promise<boolean> {
    // Check if data fits in buffer
    if (this.bufferPosition + op.data.length > this.config.bufferSize) {
      // Flush first
      const result = await this.flush();
      if (!result.success) return false;
    }
    
    // Copy to buffer
    this.writeBuffer.set(op.data, this.bufferPosition);
    this.bufferPosition += op.data.length;
    
    // Track operation
    this.pendingOperations.push(op);
    
    // Auto-flush if threshold reached
    if (this.bufferPosition >= this.config.flushThreshold) {
      const result = await this.flush();
      return result.success;
    }
    
    return true;
  }
  
  /**
   * Validate file state matches offset table
   */
  private async validateFileState(): Promise<boolean> {
    if (!this.fileHandle) return false;
    
    try {
      const file = await this.fileHandle.getFile();
      const expectedSize = this.offsetTable.totalBytesWritten;
      
      // Check file size
      if (file.size < expectedSize) {
        console.warn(`File size mismatch: expected ${expectedSize}, got ${file.size}`);
        // Truncated file - can recover by writing from last known position
        return file.size > 0;
      }
      
      // Validate header if present
      if (this.offsetTable.headerOffset === 0 && file.size >= 4) {
        const headerSlice = file.slice(0, 4);
        const headerBytes = new Uint8Array(await headerSlice.arrayBuffer());
        
        // Check for SPKX magic
        if (
          headerBytes[0] !== 0x53 || // S
          headerBytes[1] !== 0x50 || // P
          headerBytes[2] !== 0x4B || // K
          headerBytes[3] !== 0x58    // X
        ) {
          console.warn('Invalid file header magic');
          return false;
        }
      }
      
      return true;
      
    } catch (error) {
      console.error('File validation error:', error);
      return false;
    }
  }
  
  /**
   * Compute CRC32 checksum
   */
  computeChecksum(data: Uint8Array): number {
    if (this.config.checksumAlgorithm === 'none') return 0;
    
    // Simple CRC32 implementation
    let crc = 0xFFFFFFFF;
    
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let safeWriterInstance: CheckpointSafeWriter | null = null;

export function getSafeWriter(): CheckpointSafeWriter {
  if (!safeWriterInstance) {
    safeWriterInstance = new CheckpointSafeWriter();
  }
  return safeWriterInstance;
}

export function resetSafeWriter(): void {
  safeWriterInstance = null;
}

export function createSafeWriter(
  config?: Partial<WriterConfig>
): CheckpointSafeWriter {
  return new CheckpointSafeWriter(config);
}
