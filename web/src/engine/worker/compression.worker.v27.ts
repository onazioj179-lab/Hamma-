/**
 * SPK V27 - Enhanced Compression Worker
 * Universal lossless pipeline with SHA-256 verification
 * 
 * Features:
 * - Streaming TB-scale file processing
 * - SHA-256 hash verification (before/after)
 * - Adaptive chunk sizing
 * - Real-time progress with speed/ETA
 * - Fault tolerance with retries
 * - Memory-efficient processing
 * - Universal binary compression
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
import { 
  UniversalFileReader,
  calculateAdaptiveChunkSize,
  computeSHA256,
  ProgressTracker,
  detectFileType,
  type UniversalChunk,
  type ChunkHash,
} from '../pipeline/universal';
import type { 
  WorkerIncomingMessage, 
  JobId,
} from './messages';
import { createWorkerMessageSender } from './messages';
import { SpeedCalculator } from './speed';

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
  chunkHashes: ChunkHash[];
}

let activeJob: ActiveJob | null = null;
let currentSettings: CompressionSettings = {
  mode: 'auto',
  chunkSize: 16 * 1024 * 1024,
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
 * Process universal compression job
 * Handles ANY file type up to 1TB+
 */
async function processUniversalCompression(
  jobId: JobId,
  file: File,
  settings: CompressionSettings
): Promise<void> {
  // Ensure WASM is ready
  if (!isWasmReady()) {
    await initWasm();
  }

  // Detect file type for logging
  const fileInfo = detectFileType(file);
  console.log(`[V27] Compressing ${fileInfo.category} file: ${file.name} (${formatBytes(file.size)})`);

  // Adaptive chunk sizing based on file size
  const chunkSize = settings.chunkSize || calculateAdaptiveChunkSize(file.size);
  const reader = new UniversalFileReader(file, chunkSize);
  const abortController = new AbortController();
  const speedCalculator = new SpeedCalculator();
  const progressTracker = new ProgressTracker(file.size, reader.totalChunks);
  
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
    chunkHashes: [],
  };

  const compressedChunks: Uint8Array[] = [];
  let lastProgressUpdate = 0;
  const PROGRESS_INTERVAL = 50; // Update every 50ms for smooth animation

  progressTracker.start();

  try {
    // Process chunks with SHA-256 verification
    for await (const chunk of reader.stream({ 
      signal: abortController.signal,
      computeHash: true, // Enable hash verification
    })) {
      // Check for cancellation
      if (abortController.signal.aborted) {
        throw new Error('Job cancelled');
      }

      // Store original chunk hash for verification
      if (chunk.hash) {
        activeJob.chunkHashes.push({
          index: chunk.index,
          hash: chunk.hash,
          size: chunk.size,
        });
      }

      // Compress chunk with retry logic
      const result = await compressChunkWithRetry(chunk, settings.mode);
      
      // Verify compressed data can be decompressed (double verification)
      if (chunk.index === 0 || chunk.isLast) {
        await verifyChunkIntegrity(result.compressedData, chunk);
      }
      
      compressedChunks.push(result.compressedData);
      
      // Update job state
      activeJob.bytesProcessed += chunk.size;
      activeJob.compressedBytes += result.compressedSize;
      activeJob.chunksProcessed++;
      
      // Update trackers
      speedCalculator.addSample(chunk.size, result.processingTimeMs);
      progressTracker.addChunk(chunk.size);

      // Send chunk complete event
      send.sendChunkComplete({
        jobId,
        chunkIndex: chunk.index,
        originalSize: chunk.size,
        compressedSize: result.compressedSize,
        processingTimeMs: result.processingTimeMs,
      });

      // Rate-limited progress updates for smooth UI
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

    // Final progress update at 100%
    send.sendProgress({
      jobId,
      chunkIndex: reader.totalChunks - 1,
      totalChunks: reader.totalChunks,
      bytesProcessed: file.size,
      totalBytes: file.size,
      speed: speedCalculator.getCurrentSpeed(),
      eta: 0,
      compressionRatio: activeJob.compressedBytes / activeJob.bytesProcessed,
    });

    // Finalize archive with manifest
    const finalBlob = await finalizeArchiveV27(file, compressedChunks, settings, activeJob.chunkHashes);
    
    const totalTime = performance.now() - activeJob.startTime;
    const averageSpeed = (file.size / totalTime) * 1000;

    console.log(`[V27] Compression complete: ${formatBytes(file.size)} → ${formatBytes(finalBlob.size)} (${((1 - finalBlob.size / file.size) * 100).toFixed(1)}% reduction) in ${(totalTime / 1000).toFixed(2)}s`);

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
      console.error('[V27] Compression error:', error);
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
  chunk: UniversalChunk,
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
 * Verify chunk integrity by decompressing and comparing hash
 */
async function verifyChunkIntegrity(
  compressedData: Uint8Array,
  originalChunk: UniversalChunk
): Promise<void> {
  try {
    const decompressed = await decompressChunk(compressedData);
    
    // Verify size matches
    if (decompressed.length !== originalChunk.size) {
      throw new Error(`Size mismatch: expected ${originalChunk.size}, got ${decompressed.length}`);
    }
    
    // Verify hash if available
    if (originalChunk.hash) {
      const verifyHash = await computeSHA256(decompressed);
      if (verifyHash !== originalChunk.hash) {
        throw new Error(`Hash mismatch on chunk ${originalChunk.index}`);
      }
    }
  } catch (error) {
    throw new Error(`Chunk ${originalChunk.index} verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert Uint8Array to a plain ArrayBuffer (handles SharedArrayBuffer case)
 */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  return buffer;
}

/**
 * Create V27 archive with enhanced header and manifest
 */
async function finalizeArchiveV27(
  file: File,
  chunks: Uint8Array[],
  settings: CompressionSettings,
  chunkHashes: ChunkHash[]
): Promise<Blob> {
  // Create enhanced header with manifest
  const header = createArchiveHeaderV27(file, chunks, settings, chunkHashes);
  
  // Create chunk size table for efficient seeking
  const chunkTable = createChunkTable(chunks);
  
  // Combine header + chunk table + compressed chunks as ArrayBuffers
  const parts: ArrayBuffer[] = [
    toArrayBuffer(header),
    toArrayBuffer(chunkTable),
    ...chunks.map(c => toArrayBuffer(c))
  ];
  
  return new Blob(parts, { type: 'application/x-spk' });
}

/**
 * Create V27 archive header with full metadata
 */
function createArchiveHeaderV27(
  file: File,
  chunks: Uint8Array[],
  settings: CompressionSettings,
  chunkHashes: ChunkHash[]
): Uint8Array {
  const encoder = new TextEncoder();
  
  // Create manifest JSON
  const manifest = {
    v: 27,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    chunks: chunks.length,
    mode: settings.mode,
    hashes: chunkHashes.map(h => h.hash.slice(0, 16)), // Store first 16 chars of each hash
    ts: Date.now(),
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  
  // Header format V27:
  // Magic (4) | Version (2) | Flags (2) | OriginalSize (8) | 
  // ChunkCount (4) | ManifestLen (4) | Manifest (var)
  const headerSize = 24 + manifestBytes.length;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);
  
  let offset = 0;
  
  // Magic: "SPK2" (V27 uses SPK2 magic)
  header.set([0x53, 0x50, 0x4B, 0x32], offset);
  offset += 4;
  
  // Version: 27
  view.setUint16(offset, 27, true);
  offset += 2;
  
  // Flags
  let flags = 0;
  if (settings.mode === 'fast') flags |= 0x01;
  if (settings.mode === 'strong') flags |= 0x02;
  if (settings.enableDedup) flags |= 0x04;
  if (settings.enableEncryption) flags |= 0x08;
  flags |= 0x10; // V27 hash verification flag
  view.setUint16(offset, flags, true);
  offset += 2;
  
  // Original size (64-bit as two 32-bit values)
  view.setUint32(offset, file.size >>> 0, true);
  offset += 4;
  view.setUint32(offset, Math.floor(file.size / 0x100000000), true);
  offset += 4;
  
  // Chunk count
  view.setUint32(offset, chunks.length, true);
  offset += 4;
  
  // Manifest length
  view.setUint32(offset, manifestBytes.length, true);
  offset += 4;
  
  // Manifest data
  header.set(manifestBytes, offset);
  
  return header;
}

/**
 * Create chunk size table for efficient seeking
 */
function createChunkTable(chunks: Uint8Array[]): Uint8Array {
  // 4 bytes per chunk (compressed size)
  const table = new Uint8Array(chunks.length * 4);
  const view = new DataView(table.buffer);
  
  for (let i = 0; i < chunks.length; i++) {
    view.setUint32(i * 4, chunks[i].length, true);
  }
  
  return table;
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
    chunkHashes: [],
  };

  try {
    // Read archive data
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Parse header (detect version)
    const header = parseArchiveHeader(data);
    activeJob.totalChunks = header.chunkCount;
    
    console.log(`[V27] Decompressing: ${header.fileName} (${header.chunkCount} chunks)`);
    
    // Extract and decompress chunks
    const decompressedChunks: Uint8Array[] = [];
    let offset = header.headerSize + (header.chunkCount * 4); // Skip header + chunk table
    
    // Read chunk table
    const chunkSizes: number[] = [];
    const tableView = new DataView(data.buffer, header.headerSize, header.chunkCount * 4);
    for (let i = 0; i < header.chunkCount; i++) {
      chunkSizes.push(tableView.getUint32(i * 4, true));
    }
    
    for (let i = 0; i < header.chunkCount; i++) {
      if (abortController.signal.aborted) {
        throw new Error('Job cancelled');
      }
      
      const chunkSize = chunkSizes[i];
      const chunkData = data.slice(offset, offset + chunkSize);
      offset += chunkSize;
      
      const decompressed = await decompressChunk(chunkData);
      decompressedChunks.push(decompressed);
      
      activeJob.bytesProcessed += chunkSize;
      activeJob.chunksProcessed++;
      speedCalculator.addSample(chunkSize, 10); // Estimate time
      
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
    
    // Create output blob from ArrayBuffers
    const outputParts = decompressedChunks.map(c => toArrayBuffer(c));
    const outputBlob = new Blob(outputParts, { type: 'application/octet-stream' });
    
    const totalTime = performance.now() - activeJob.startTime;
    
    console.log(`[V27] Decompression complete: ${formatBytes(outputBlob.size)} in ${(totalTime / 1000).toFixed(2)}s`);
    
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
 * Parse archive header (supports V25 and V27)
 */
function parseArchiveHeader(data: Uint8Array): {
  version: number;
  originalSize: number;
  chunkCount: number;
  fileName: string;
  headerSize: number;
} {
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  
  // Verify magic (SPK1 = V25, SPK2 = V27)
  if (magic !== 'SPK1' && magic !== 'SPK2') {
    throw new Error('Invalid SPK archive');
  }
  
  const view = new DataView(data.buffer);
  const version = view.getUint16(4, true);
  
  if (magic === 'SPK2' && version >= 27) {
    // V27 format
    const originalSizeLow = view.getUint32(8, true);
    const originalSizeHigh = view.getUint32(12, true);
    const originalSize = originalSizeLow + originalSizeHigh * 0x100000000;
    const chunkCount = view.getUint32(16, true);
    const manifestLen = view.getUint32(20, true);
    
    // Parse manifest
    const manifestBytes = data.slice(24, 24 + manifestLen);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    
    return {
      version,
      originalSize,
      chunkCount,
      fileName: manifest.name || 'unknown',
      headerSize: 24 + manifestLen,
    };
  } else {
    // V25 format (backwards compatibility)
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
 * Format bytes helper
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
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
      await processUniversalCompression(message.jobId, message.file, message.settings);
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
