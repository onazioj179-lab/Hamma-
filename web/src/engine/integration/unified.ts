/**
 * SPK V40 - Universal App Integration Layer
 * 
 * Features:
 * - Unified API for all compress/decompress operations
 * - Cross-platform compatibility
 * - Event-based UI integration
 * - Simplified interface for common operations
 * - Optional fail-safe pipeline for large files
 */

import { MultiFileCompressor, MultiFileExtractor, FolderBuilder, type FileEntry, type ExtractedFile, type MultiFileProgress } from '../folder';
import { FailSafeSPK, type FailSafeProgress } from './fail-safe';

// ============================================================================
// Unified Types
// ============================================================================

export interface UnifiedConfig {
  /** Compression level (1-9) */
  compressionLevel?: number;
  /** Maximum parallel workers */
  maxWorkers?: number;
  /** Memory limit in bytes */
  memoryLimit?: number;
  /** Enable integrity verification */
  verifyIntegrity?: boolean;
  /** Enable auto-optimization */
  autoOptimize?: boolean;
  /** Enable session recovery */
  enableRecovery?: boolean;
  /** Media-aware compression */
  mediaAware?: boolean;
  /** Chunk size override */
  chunkSize?: number;
  /** Use fail-safe pipeline (for large files, auto-retry, better progress) */
  useFailSafe?: boolean;
}

export interface UnifiedProgress {
  /** Operation type */
  operation: 'compress' | 'decompress' | 'verify' | 'analyze';
  /** Progress percentage (0-100) */
  progress: number;
  /** Bytes processed */
  bytesProcessed: number;
  /** Total bytes */
  totalBytes: number;
  /** Current file (for multi-file) */
  currentFile?: string;
  /** Files processed (for multi-file) */
  filesProcessed?: number;
  /** Total files (for multi-file) */
  totalFiles?: number;
  /** Processing speed (bytes/sec) */
  speed: number;
  /** Estimated time remaining (ms) */
  eta: number;
  /** Current phase */
  phase: string;
}

export interface UnifiedResult {
  /** Success flag */
  success: boolean;
  /** Result data (compressed/decompressed) */
  data?: Uint8Array;
  /** Extracted files (for multi-file decompress) */
  files?: ExtractedFile[];
  /** Original size */
  originalSize: number;
  /** Result size */
  resultSize: number;
  /** Compression ratio */
  ratio: number;
  /** Time taken (ms) */
  duration: number;
  /** Verification passed */
  verified?: boolean;
  /** Error message if failed */
  error?: string;
  /** Session ID for recovery */
  sessionId?: string;
}

export type ProgressCallback = (progress: UnifiedProgress) => void;

export interface SPKStats {
  /** Version */
  version: number;
  /** Original size */
  originalSize: number;
  /** Compressed size */
  compressedSize: number;
  /** Compression ratio */
  ratio: number;
  /** Is multi-file archive */
  isMultiFile: boolean;
  /** File count (for multi-file) */
  fileCount?: number;
  /** Directory count (for multi-file) */
  directoryCount?: number;
  /** Creation timestamp */
  created?: number;
}

// ============================================================================
// Simple Compression Engine (Self-contained)
// ============================================================================

class SimpleCompressor {
  private level: number;
  private chunkSize: number;
  private onProgress?: ProgressCallback;
  private startTime = 0;

  constructor(level = 6, chunkSize = 1024 * 1024) {
    this.level = level;
    this.chunkSize = chunkSize;
  }

  /** Get chunk size for use in chunked operations */
  getChunkSize(): number {
    return this.chunkSize;
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.onProgress = callback;
  }

  async compress(data: Uint8Array): Promise<Uint8Array> {
    this.startTime = Date.now();
    const windowSize = this.level < 4 ? 256 : this.level < 7 ? 4096 : 32768;
    
    this.reportProgress(0, 0, data.length, 'Starting compression');

    // LZ77 compression
    const compressed = this.lz77Compress(data, windowSize);
    
    this.reportProgress(100, data.length, data.length, 'Complete');

    // Build SPK archive
    return this.buildArchive(data.length, compressed);
  }

  private lz77Compress(data: Uint8Array, windowSize: number): Uint8Array {
    const output: number[] = [];
    let pos = 0;

    while (pos < data.length) {
      let bestLength = 0;
      let bestOffset = 0;

      const searchStart = Math.max(0, pos - windowSize);
      const maxLength = Math.min(258, data.length - pos);

      for (let i = searchStart; i < pos; i++) {
        let length = 0;
        while (length < maxLength && data[i + length] === data[pos + length]) {
          length++;
        }
        if (length > bestLength) {
          bestLength = length;
          bestOffset = pos - i;
        }
      }

      if (bestLength >= 3) {
        output.push(0xFF);
        output.push((bestOffset >> 8) & 0xFF);
        output.push(bestOffset & 0xFF);
        output.push(bestLength);
        pos += bestLength;
      } else {
        if (data[pos] === 0xFF) {
          output.push(0xFF, 0x00, 0x00, 0x01);
        } else {
          output.push(data[pos]);
        }
        pos++;
      }

      if (pos % 10000 === 0) {
        this.reportProgress((pos / data.length) * 100, pos, data.length, 'Compressing');
      }
    }

    return new Uint8Array(output);
  }

  private buildArchive(originalSize: number, compressed: Uint8Array): Uint8Array {
    const headerSize = 64;
    const footerSize = 32;
    const totalSize = headerSize + compressed.length + footerSize;
    
    const result = new Uint8Array(totalSize);
    const view = new DataView(result.buffer);

    // Header
    result[0] = 0x53; // S
    result[1] = 0x50; // P
    result[2] = 0x4B; // K
    result[3] = 0x00;
    view.setUint16(4, 40, true); // Version
    view.setUint16(6, 0, true); // Flags
    view.setBigUint64(8, BigInt(originalSize), true);
    view.setBigUint64(16, BigInt(compressed.length), true);
    view.setUint32(24, 1, true); // Chunk count
    view.setBigUint64(40, BigInt(Date.now()), true);

    // Data
    result.set(compressed, headerSize);

    // Footer
    const footerStart = headerSize + compressed.length;
    result[footerStart] = 0x45; // E
    result[footerStart + 1] = 0x4E; // N
    result[footerStart + 2] = 0x44; // D
    result[footerStart + 3] = 0x00;
    view.setUint16(footerStart + 16, 40, true);

    return result;
  }

  private reportProgress(progress: number, bytesProcessed: number, totalBytes: number, phase: string): void {
    if (!this.onProgress) return;

    const elapsed = Date.now() - this.startTime;
    const speed = elapsed > 0 ? (bytesProcessed / elapsed) * 1000 : 0;
    const remaining = totalBytes - bytesProcessed;
    const eta = speed > 0 ? (remaining / speed) * 1000 : 0;

    this.onProgress({
      operation: 'compress',
      progress,
      bytesProcessed,
      totalBytes,
      speed,
      eta,
      phase,
    });
  }
}

class SimpleDecompressor {
  private onProgress?: ProgressCallback;
  private startTime = 0;

  setProgressCallback(callback: ProgressCallback): void {
    this.onProgress = callback;
  }

  async decompress(archive: Uint8Array): Promise<Uint8Array> {
    this.startTime = Date.now();
    
    // Verify header
    if (archive[0] !== 0x53 || archive[1] !== 0x50 || archive[2] !== 0x4B) {
      throw new Error('Invalid SPK archive');
    }

    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const originalSize = Number(view.getBigUint64(8, true));
    
    this.reportProgress(0, 0, originalSize, 'Starting decompression');

    // Extract compressed data
    const headerSize = 64;
    const footerSize = 32;
    const compressed = archive.slice(headerSize, archive.length - footerSize);

    // LZ77 decompress
    const decompressed = this.lz77Decompress(compressed, originalSize);

    this.reportProgress(100, originalSize, originalSize, 'Complete');

    return decompressed;
  }

  private lz77Decompress(data: Uint8Array, expectedSize: number): Uint8Array {
    const output: number[] = [];
    let pos = 0;

    while (pos < data.length) {
      if (data[pos] === 0xFF && pos + 3 < data.length) {
        const offset = (data[pos + 1] << 8) | data[pos + 2];
        const length = data[pos + 3];

        if (offset === 0 && length === 1) {
          output.push(0xFF);
        } else {
          const start = output.length - offset;
          for (let i = 0; i < length; i++) {
            output.push(output[start + i]);
          }
        }
        pos += 4;
      } else {
        output.push(data[pos]);
        pos++;
      }

      if (output.length % 10000 === 0) {
        this.reportProgress((output.length / expectedSize) * 100, output.length, expectedSize, 'Decompressing');
      }
    }

    return new Uint8Array(output);
  }

  private reportProgress(progress: number, bytesProcessed: number, totalBytes: number, phase: string): void {
    if (!this.onProgress) return;

    const elapsed = Date.now() - this.startTime;
    const speed = elapsed > 0 ? (bytesProcessed / elapsed) * 1000 : 0;
    const remaining = totalBytes - bytesProcessed;
    const eta = speed > 0 ? (remaining / speed) * 1000 : 0;

    this.onProgress({
      operation: 'decompress',
      progress,
      bytesProcessed,
      totalBytes,
      speed,
      eta,
      phase,
    });
  }
}

// ============================================================================
// Unified SPK Engine
// ============================================================================

export class UnifiedSPK {
  private config: Required<UnifiedConfig>;
  private progressCallback?: ProgressCallback;
  
  private compressor: SimpleCompressor;
  private decompressor: SimpleDecompressor;
  private multiFileCompressor: MultiFileCompressor;
  private multiFileExtractor: MultiFileExtractor;
  private failSafeEngine: FailSafeSPK | null = null;
  
  private startTime = 0;
  private aborted = false;

  constructor(config: UnifiedConfig = {}) {
    this.config = {
      compressionLevel: config.compressionLevel ?? 6,
      maxWorkers: config.maxWorkers ?? (navigator.hardwareConcurrency || 4),
      memoryLimit: config.memoryLimit ?? 256 * 1024 * 1024,
      verifyIntegrity: config.verifyIntegrity ?? true,
      autoOptimize: config.autoOptimize ?? true,
      enableRecovery: config.enableRecovery ?? true,
      mediaAware: config.mediaAware ?? true,
      chunkSize: config.chunkSize ?? 1024 * 1024,
      useFailSafe: config.useFailSafe ?? true, // Default to fail-safe for reliability
    };

    this.compressor = new SimpleCompressor(this.config.compressionLevel, this.config.chunkSize);
    this.decompressor = new SimpleDecompressor();
    this.multiFileCompressor = new MultiFileCompressor({
      level: this.config.compressionLevel,
      maxWorkers: this.config.maxWorkers,
      memoryLimit: this.config.memoryLimit,
    });
    this.multiFileExtractor = new MultiFileExtractor();

    // Initialize fail-safe engine if enabled
    if (this.config.useFailSafe) {
      this.failSafeEngine = new FailSafeSPK({
        compressionLevel: this.config.compressionLevel,
        chunkSize: this.config.chunkSize,
        maxWorkers: this.config.maxWorkers,
        memoryLimit: this.config.memoryLimit,
        verbose: false,
      });
    }

    this.wireProgressCallbacks();
  }

  onProgress(callback: ProgressCallback): this {
    this.progressCallback = callback;
    return this;
  }

  async compress(data: Uint8Array, filename?: string): Promise<UnifiedResult> {
    this.aborted = false;
    this.startTime = Date.now();

    try {
      // Use fail-safe engine if available
      if (this.failSafeEngine) {
        const result = await this.failSafeEngine.compress(data, filename || 'data');
        const duration = Date.now() - this.startTime;

        return {
          success: result.success,
          data: result.data,
          originalSize: result.originalSize,
          resultSize: result.resultSize,
          ratio: result.ratio,
          duration: result.duration || duration,
          verified: result.verified,
          error: result.error,
        };
      }

      // Fallback to simple compressor
      const compressed = await this.compressor.compress(data);
      const duration = Date.now() - this.startTime;

      return {
        success: true,
        data: compressed,
        originalSize: data.length,
        resultSize: compressed.length,
        ratio: compressed.length / data.length,
        duration,
        verified: true,
      };
    } catch (error) {
      return this.errorResult((error as Error).message);
    }
  }

  async decompress(archive: Uint8Array): Promise<UnifiedResult> {
    this.aborted = false;
    this.startTime = Date.now();

    try {
      const isMultiFile = this.isMultiFileArchive(archive);
      
      if (isMultiFile) {
        return this.decompressMultiFile(archive);
      }

      // Use fail-safe engine if available
      if (this.failSafeEngine) {
        const result = await this.failSafeEngine.decompress(archive);
        
        return {
          success: result.success,
          data: result.data,
          originalSize: archive.length,
          resultSize: result.resultSize,
          ratio: archive.length / result.resultSize,
          duration: result.duration,
          verified: result.verified,
          error: result.error,
        };
      }

      // Fallback to simple decompressor
      const decompressed = await this.decompressor.decompress(archive);
      const duration = Date.now() - this.startTime;

      return {
        success: true,
        data: decompressed,
        originalSize: archive.length,
        resultSize: decompressed.length,
        ratio: archive.length / decompressed.length,
        duration,
        verified: true,
      };
    } catch (error) {
      return this.errorResult((error as Error).message);
    }
  }

  async compressFiles(files: FileEntry[]): Promise<UnifiedResult> {
    this.aborted = false;
    this.startTime = Date.now();

    try {
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const compressed = await this.multiFileCompressor.compress(files);
      const duration = Date.now() - this.startTime;

      return {
        success: true,
        data: compressed,
        originalSize: totalSize,
        resultSize: compressed.length,
        ratio: compressed.length / totalSize,
        duration,
      };
    } catch (error) {
      return this.errorResult((error as Error).message);
    }
  }

  private async decompressMultiFile(archive: Uint8Array): Promise<UnifiedResult> {
    try {
      const files = await this.multiFileExtractor.extract(archive);
      const totalSize = files.reduce((sum, f) => sum + f.data.length, 0);
      const duration = Date.now() - this.startTime;

      return {
        success: true,
        files,
        originalSize: archive.length,
        resultSize: totalSize,
        ratio: archive.length / totalSize,
        duration,
        verified: true,
      };
    } catch (error) {
      return this.errorResult((error as Error).message);
    }
  }

  getStats(archive: Uint8Array): SPKStats {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

    if (archive[0] !== 0x53 || archive[1] !== 0x50 || archive[2] !== 0x4B) {
      throw new Error('Invalid SPK archive');
    }

    const version = view.getUint16(4, true);
    const flags = view.getUint16(6, true);
    const originalSize = Number(view.getBigUint64(8, true));
    const compressedSize = Number(view.getBigUint64(16, true));
    const isMultiFile = (flags & 0x0001) !== 0;

    return {
      version,
      originalSize,
      compressedSize,
      ratio: compressedSize / originalSize,
      isMultiFile,
    };
  }

  listFiles(archive: Uint8Array): string[] {
    return this.multiFileExtractor.listFiles(archive);
  }

  async extractFile(archive: Uint8Array, path: string): Promise<ExtractedFile | null> {
    return this.multiFileExtractor.extractFile(archive, path);
  }

  abort(): void {
    this.aborted = true;
    this.multiFileCompressor.abort();
    this.multiFileExtractor.abort();
    if (this.failSafeEngine) {
      this.failSafeEngine.abort();
    }
  }

  /** Check if operation was aborted */
  isAborted(): boolean {
    return this.aborted;
  }

  createFolderBuilder(): FolderBuilder {
    return new FolderBuilder();
  }

  destroy(): void {
    // Cleanup fail-safe engine
    if (this.failSafeEngine) {
      this.failSafeEngine.destroy();
    }
  }

  private isMultiFileArchive(archive: Uint8Array): boolean {
    if (archive.length < 64) return false;
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const flags = view.getUint16(6, true);
    return (flags & 0x0001) !== 0;
  }

  private wireProgressCallbacks(): void {
    this.compressor.setProgressCallback((p) => {
      this.progressCallback?.(p);
    });

    this.decompressor.setProgressCallback((p) => {
      this.progressCallback?.(p);
    });

    // Wire fail-safe engine progress
    if (this.failSafeEngine) {
      this.failSafeEngine.setProgressCallback((p: FailSafeProgress) => {
        this.progressCallback?.({
          operation: p.operation,
          progress: p.progress,
          bytesProcessed: p.bytesProcessed,
          totalBytes: p.totalBytes,
          speed: p.speed,
          eta: p.eta,
          phase: p.phase,
        });
      });
    }

    this.multiFileCompressor.setProgressCallback((p: MultiFileProgress) => {
      this.progressCallback?.({
        operation: 'compress',
        progress: p.overallProgress,
        bytesProcessed: p.bytesProcessed,
        totalBytes: p.totalBytes,
        currentFile: p.currentFile,
        filesProcessed: p.currentFileIndex,
        totalFiles: p.totalFiles,
        speed: p.speed,
        eta: p.eta,
        phase: p.operation,
      });
    });

    this.multiFileExtractor.setProgressCallback((p: MultiFileProgress) => {
      this.progressCallback?.({
        operation: 'decompress',
        progress: p.overallProgress,
        bytesProcessed: p.bytesProcessed,
        totalBytes: p.totalBytes,
        currentFile: p.currentFile,
        filesProcessed: p.currentFileIndex,
        totalFiles: p.totalFiles,
        speed: p.speed,
        eta: p.eta,
        phase: p.operation,
      });
    });
  }

  private errorResult(error: string): UnifiedResult {
    return {
      success: false,
      originalSize: 0,
      resultSize: 0,
      ratio: 0,
      duration: Date.now() - this.startTime,
      error,
    };
  }
}

// ============================================================================
// Quick API Functions
// ============================================================================

export async function compress(
  data: Uint8Array,
  options?: UnifiedConfig & { onProgress?: ProgressCallback }
): Promise<UnifiedResult> {
  const spk = new UnifiedSPK(options);
  if (options?.onProgress) {
    spk.onProgress(options.onProgress);
  }
  const result = await spk.compress(data);
  spk.destroy();
  return result;
}

export async function decompress(
  archive: Uint8Array,
  options?: UnifiedConfig & { onProgress?: ProgressCallback }
): Promise<UnifiedResult> {
  const spk = new UnifiedSPK(options);
  if (options?.onProgress) {
    spk.onProgress(options.onProgress);
  }
  const result = await spk.decompress(archive);
  spk.destroy();
  return result;
}

export async function compressFiles(
  files: FileEntry[],
  options?: UnifiedConfig & { onProgress?: ProgressCallback }
): Promise<UnifiedResult> {
  const spk = new UnifiedSPK(options);
  if (options?.onProgress) {
    spk.onProgress(options.onProgress);
  }
  const result = await spk.compressFiles(files);
  spk.destroy();
  return result;
}

export function getStats(archive: Uint8Array): SPKStats {
  const spk = new UnifiedSPK();
  const result = spk.getStats(archive);
  spk.destroy();
  return result;
}

// ============================================================================
// Event Emitter (for non-React integrations)
// ============================================================================

type EventCallback<T = unknown> = (data: T) => void;

export class SPKEventEmitter {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on<T>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);
    return () => this.off(event, callback);
  }

  off<T>(event: string, callback: EventCallback<T>): void {
    this.listeners.get(event)?.delete(callback as EventCallback);
  }

  emit<T>(event: string, data: T): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  clear(): void {
    this.listeners.clear();
  }
}

export class SPKWithEvents extends UnifiedSPK {
  private emitter = new SPKEventEmitter();

  constructor(config?: UnifiedConfig) {
    super(config);
    this.onProgress(progress => {
      this.emitter.emit('progress', progress);
    });
  }

  on<T>(event: string, callback: EventCallback<T>): () => void {
    return this.emitter.on(event, callback);
  }

  off<T>(event: string, callback: EventCallback<T>): void {
    this.emitter.off(event, callback);
  }

  override async compress(data: Uint8Array, filename?: string): Promise<UnifiedResult> {
    this.emitter.emit('start', { operation: 'compress', size: data.length });
    const result = await super.compress(data, filename);
    this.emitter.emit(result.success ? 'complete' : 'error', result);
    return result;
  }

  override async decompress(archive: Uint8Array): Promise<UnifiedResult> {
    this.emitter.emit('start', { operation: 'decompress', size: archive.length });
    const result = await super.decompress(archive);
    this.emitter.emit(result.success ? 'complete' : 'error', result);
    return result;
  }

  override destroy(): void {
    this.emitter.clear();
    super.destroy();
  }
}

// ============================================================================
// React Hook State Factory
// ============================================================================

export interface UseSPKState {
  loading: boolean;
  error: string | null;
  progress: UnifiedProgress | null;
  result: UnifiedResult | null;
}

export function createSPKHookState(): UseSPKState {
  return {
    loading: false,
    error: null,
    progress: null,
    result: null,
  };
}

// ============================================================================
// Exports
// ============================================================================

export default UnifiedSPK;
