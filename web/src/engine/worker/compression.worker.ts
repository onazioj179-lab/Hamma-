/**
 * SPK V25 - Compression Worker
 * Production-grade Web Worker for off-main-thread compression
 * 
 * Features:
 * - Streaming file processing via Blob.stream()
 * - Real-time progress with speed/ETA
 * - Fault tolerance and recovery
 * - Memory-efficient chunk processing
 * - Cancellation support
 */

import { 
  initWasm, 
  compressChunk, 
  decompressChunk,
  getWasmCapabilities,
  isWasmReady,
  cleanupMemoryPool,
} from '../wasm/bridge';
import type { CompressionMode, CompressionSettings, ChunkResult } from '../wasm/types';
import { DEFAULT_CHUNK_SIZE } from '../wasm/types';
import { 
  StreamingFileReader, 
  calculateOptimalChunkSize,
  type FileChunk 
} from '../streaming/reader';
import type { 
  WorkerIncomingMessage, 
  JobId,
} from './messages';
import { createWorkerMessageSender } from './messages';
// Speed Calculator - inline for worker compatibility
class SpeedCalculator {
  private samples: { bytes: number; timeMs: number; timestamp: number }[] = [];
  private totalBytes = 0;
  private totalTimeMs = 0;
  private readonly windowSize = 20;
  private readonly windowTimeMs = 5000;

  addSample(bytes: number, timeMs: number): void {
    const now = performance.now();
    this.samples.push({ bytes, timeMs, timestamp: now });
    this.totalBytes += bytes;
    this.totalTimeMs += timeMs;

    // Prune old samples
    while (this.samples.length > this.windowSize) {
      const removed = this.samples.shift()!;
      this.totalBytes -= removed.bytes;
      this.totalTimeMs -= removed.timeMs;
    }
    const cutoff = now - this.windowTimeMs;
    while (this.samples.length > 0 && this.samples[0].timestamp < cutoff) {
      const removed = this.samples.shift()!;
      this.totalBytes -= removed.bytes;
      this.totalTimeMs -= removed.timeMs;
    }
  }

  getCurrentSpeed(): number {
    if (this.samples.length === 0 || this.totalTimeMs === 0) return 0;
    const now = performance.now();
    let weightedBytes = 0;
    let weightedTime = 0;
    for (const sample of this.samples) {
      const age = now - sample.timestamp;
      const weight = Math.max(0, 1 - age / this.windowTimeMs);
      weightedBytes += sample.bytes * weight;
      weightedTime += sample.timeMs * weight;
    }
    return weightedTime === 0 ? 0 : (weightedBytes / weightedTime) * 1000;
  }

  getETA(remainingBytes: number): number {
    const speed = this.getCurrentSpeed();
    return speed === 0 || remainingBytes <= 0 ? 0 : remainingBytes / speed;
  }
}

// Message sender
const send = createWorkerMessageSender(
  (msg, transfer) => self.postMessage(msg, { transfer: transfer || [] })
);

// Active job state
interface ActiveJob {
  id: JobId;
  abortController: AbortController;
  startTime: number;
  bytesProcessed: number;
  compressedBytes: number;
  chunksProcessed: number;
  totalChunks: number;
  speedCalculator: SpeedCalculator;
}

let activeJob: ActiveJob | null = null;
let currentSettings: CompressionSettings = {
  mode: 'auto',
  chunkSize: DEFAULT_CHUNK_SIZE,
  enableDedup: false,
  enableEncryption: false,
};

/**
 * Initialize WASM on worker startup
 */
async function initialize(): Promise<void> {
  try {
    await initWasm();
    send.sendWasmReady({ capabilities: getWasmCapabilities() });
  } catch (error) {
    send.sendError({
      jobId: '',
      message: `WASM initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      code: 'WASM_INIT_FAILED',
      recoverable: false,
    });
  }
}

/**
 * Process compression job
 */
async function processCompression(
  jobId: JobId,
  file: File,
  settings: CompressionSettings
): Promise<void> {
  // Ensure WASM is ready
  if (!isWasmReady()) {
    await initWasm();
  }

  const chunkSize = settings.chunkSize || calculateOptimalChunkSize(file.size);
  const reader = new StreamingFileReader(file, chunkSize);
  const abortController = new AbortController();
  const speedCalculator = new SpeedCalculator();
  
  // Create job state
  activeJob = {
    id: jobId,
    abortController,
    startTime: performance.now(),
    bytesProcessed: 0,
    compressedBytes: 0,
    chunksProcessed: 0,
    totalChunks: reader.totalChunks,
    speedCalculator,
  };

  const compressedChunks: Uint8Array[] = [];
  let lastProgressUpdate = 0;
  const PROGRESS_INTERVAL = 75; // Update every 75ms

  try {
    // Process chunks
    for await (const chunk of reader.stream({ signal: abortController.signal })) {
      // Check for cancellation
      if (abortController.signal.aborted) {
        throw new Error('Job cancelled');
      }

      // Compress chunk
      const result = await compressChunkWithRetry(chunk, settings.mode);
      
      compressedChunks.push(result.compressedData);
      
      // Update job state
      activeJob.bytesProcessed += chunk.size;
      activeJob.compressedBytes += result.compressedSize;
      activeJob.chunksProcessed++;
      
      // Update speed calculator
      speedCalculator.addSample(chunk.size, result.processingTimeMs);

      // Send chunk complete
      send.sendChunkComplete({
        jobId,
        chunkIndex: chunk.index,
        originalSize: chunk.size,
        compressedSize: result.compressedSize,
        processingTimeMs: result.processingTimeMs,
      });

      // Rate-limited progress updates
      const now = performance.now();
      if (now - lastProgressUpdate >= PROGRESS_INTERVAL) {
        const speed = speedCalculator.getCurrentSpeed();
        const eta = speedCalculator.getETA(file.size - activeJob.bytesProcessed);
        
        send.sendProgress({
          jobId,
          chunkIndex: chunk.index,
          totalChunks: reader.totalChunks,
          bytesProcessed: activeJob.bytesProcessed,
          totalBytes: file.size,
          speed,
          eta,
          compressionRatio: activeJob.compressedBytes / activeJob.bytesProcessed,
        });
        
        lastProgressUpdate = now;
      }
    }

    // Finalize archive
    const finalBlob = await finalizeArchive(file, compressedChunks, settings);
    
    const totalTime = performance.now() - activeJob.startTime;
    const averageSpeed = (file.size / totalTime) * 1000;

    // Send completion
    send.sendComplete({
      jobId,
      outputBlob: finalBlob,
      originalSize: file.size,
      compressedSize: finalBlob.size,
      compressionRatio: finalBlob.size / file.size,
      totalTime,
      averageSpeed,
    });

  } catch (error) {
    if (abortController.signal.aborted) {
      send.sendCancelled({
        jobId,
        bytesProcessed: activeJob?.bytesProcessed || 0,
      });
    } else {
      send.sendError({
        jobId,
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'COMPRESSION_FAILED',
        recoverable: true,
      });
    }
  } finally {
    // Cleanup
    activeJob = null;
    cleanupMemoryPool();
  }
}

/**
 * Compress chunk with retry logic for fault tolerance
 */
async function compressChunkWithRetry(
  chunk: FileChunk,
  mode: CompressionMode,
  maxRetries: number = 3
): Promise<ChunkResult> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await compressChunk(chunk.data, chunk.index, mode);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
      }
    }
  }
  
  throw lastError || new Error('Chunk compression failed after retries');
}

/**
 * Convert Uint8Array to proper ArrayBuffer for Blob creation
 */
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  // Handle both regular ArrayBuffer and SharedArrayBuffer
  if (arr.buffer instanceof SharedArrayBuffer) {
    // Copy to regular ArrayBuffer for Blob compatibility
    const copy = new ArrayBuffer(arr.byteLength);
    new Uint8Array(copy).set(arr);
    return copy;
  }
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

/**
 * Finalize archive with header and metadata
 */
async function finalizeArchive(
  file: File,
  chunks: Uint8Array[],
  settings: CompressionSettings
): Promise<Blob> {
  // Create SPK archive header
  const header = createArchiveHeader(file, chunks, settings);
  
  // Convert all to ArrayBuffer for Blob compatibility
  const parts: BlobPart[] = [
    toArrayBuffer(header),
    ...chunks.map(c => toArrayBuffer(c))
  ];
  
  return new Blob(parts, { type: 'application/x-spk' });
}

/**
 * Create archive header
 */
function createArchiveHeader(
  file: File,
  chunks: Uint8Array[],
  settings: CompressionSettings
): Uint8Array {
  const encoder = new TextEncoder();
  const fileName = encoder.encode(file.name);
  
  // Header format:
  // Magic (4) | Version (2) | Flags (2) | OriginalSize (8) | ChunkCount (4) | FileNameLen (2) | FileName (var)
  const headerSize = 22 + fileName.length;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);
  
  let offset = 0;
  
  // Magic: "SPK1"
  header.set([0x53, 0x50, 0x4B, 0x31], offset);
  offset += 4;
  
  // Version: 25
  view.setUint16(offset, 25, true);
  offset += 2;
  
  // Flags
  let flags = 0;
  if (settings.mode === 'fast') flags |= 0x01;
  if (settings.mode === 'strong') flags |= 0x02;
  if (settings.enableDedup) flags |= 0x04;
  if (settings.enableEncryption) flags |= 0x08;
  view.setUint16(offset, flags, true);
  offset += 2;
  
  // Original size (as two 32-bit values for 64-bit support)
  view.setUint32(offset, file.size >>> 0, true);
  offset += 4;
  view.setUint32(offset, Math.floor(file.size / 0x100000000), true);
  offset += 4;
  
  // Chunk count
  view.setUint32(offset, chunks.length, true);
  offset += 4;
  
  // File name length
  view.setUint16(offset, fileName.length, true);
  offset += 2;
  
  // File name
  header.set(fileName, offset);
  
  return header;
}

/**
 * Process decompression job
 */
async function processDecompression(
  jobId: JobId,
  file: File
): Promise<void> {
  if (!isWasmReady()) {
    await initWasm();
  }

  const abortController = new AbortController();
  const speedCalculator = new SpeedCalculator();
  
  activeJob = {
    id: jobId,
    abortController,
    startTime: performance.now(),
    bytesProcessed: 0,
    compressedBytes: 0,
    chunksProcessed: 0,
    totalChunks: 0,
    speedCalculator,
  };

  try {
    // Read entire archive (for header parsing)
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Parse header
    const header = parseArchiveHeader(data);
    activeJob.totalChunks = header.chunkCount;
    
    // Extract and decompress chunks
    const decompressedChunks: Uint8Array[] = [];
    let offset = header.headerSize;
    
    for (let i = 0; i < header.chunkCount; i++) {
      if (abortController.signal.aborted) {
        throw new Error('Job cancelled');
      }
      
      // Read chunk size (first 4 bytes of each chunk block)
      const chunkSize = new DataView(data.buffer, offset).getUint32(0, true);
      offset += 4;
      
      const chunkData = data.slice(offset, offset + chunkSize);
      offset += chunkSize;
      
      const decompressed = await decompressChunk(chunkData);
      decompressedChunks.push(decompressed);
      
      activeJob.bytesProcessed += chunkSize;
      activeJob.chunksProcessed++;
      
      // Progress update
      send.sendProgress({
        jobId,
        chunkIndex: i,
        totalChunks: header.chunkCount,
        bytesProcessed: activeJob.bytesProcessed,
        totalBytes: file.size,
        speed: speedCalculator.getCurrentSpeed(),
        eta: speedCalculator.getETA(file.size - activeJob.bytesProcessed),
        compressionRatio: 1 / (header.originalSize / file.size),
      });
    }
    
    // Create output blob
    const outputBlob = new Blob(
      decompressedChunks.map(c => toArrayBuffer(c)), 
      { type: 'application/octet-stream' }
    );
    
    const totalTime = performance.now() - activeJob.startTime;
    
    send.sendComplete({
      jobId,
      outputBlob,
      originalSize: file.size,
      compressedSize: outputBlob.size,
      compressionRatio: file.size / outputBlob.size,
      totalTime,
      averageSpeed: (file.size / totalTime) * 1000,
    });
    
  } catch (error) {
    if (activeJob?.abortController.signal.aborted) {
      send.sendCancelled({
        jobId,
        bytesProcessed: activeJob?.bytesProcessed || 0,
      });
    } else {
      send.sendError({
        jobId,
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'DECOMPRESSION_FAILED',
        recoverable: true,
      });
    }
  } finally {
    activeJob = null;
    cleanupMemoryPool();
  }
}

/**
 * Parse archive header
 */
function parseArchiveHeader(data: Uint8Array): {
  version: number;
  originalSize: number;
  chunkCount: number;
  fileName: string;
  headerSize: number;
} {
  // Verify magic
  if (data[0] !== 0x53 || data[1] !== 0x50 || data[2] !== 0x4B || data[3] !== 0x31) {
    throw new Error('Invalid SPK archive');
  }
  
  const view = new DataView(data.buffer);
  
  const version = view.getUint16(4, true);
  const originalSizeLow = view.getUint32(8, true);
  const originalSizeHigh = view.getUint32(12, true);
  const originalSize = originalSizeLow + originalSizeHigh * 0x100000000;
  const chunkCount = view.getUint32(16, true);
  const fileNameLen = view.getUint16(20, true);
  const fileName = new TextDecoder().decode(data.slice(22, 22 + fileNameLen));
  
  return {
    version,
    originalSize,
    chunkCount,
    fileName,
    headerSize: 22 + fileNameLen,
  };
}

/**
 * Cancel active job
 */
function cancelJob(jobId: JobId): void {
  if (activeJob && activeJob.id === jobId) {
    activeJob.abortController.abort();
  }
}

/**
 * Worker message handler
 */
self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const message = event.data;
  
  switch (message.type) {
    case 'INIT_WASM':
      await initialize();
      break;
      
    case 'START_COMPRESSION':
      await processCompression(message.jobId, message.file, message.settings);
      break;
      
    case 'START_DECOMPRESSION':
      await processDecompression(message.jobId, message.file);
      break;
      
    case 'CANCEL_JOB':
      cancelJob(message.jobId);
      break;
      
    case 'SET_CHUNK_SIZE':
      currentSettings.chunkSize = message.chunkSize;
      break;
      
    case 'SET_MODE':
      currentSettings.mode = message.mode;
      break;
  }
};

// Initialize on worker load
initialize();
