/**
 * SPK V31 - Standalone Compression Worker
 * 
 * Self-contained Web Worker that performs actual compression.
 * No external imports - everything is inlined for worker compatibility.
 * 
 * Features:
 * - Real LZ77/RLE compression algorithms
 * - Streaming chunk processing
 * - Archive building
 * - Progress reporting
 * - Error recovery
 */

// Wrap in function scope to avoid global conflicts
(function() {

// ============================================================================
// TYPES
// ============================================================================

type CompressionMode = 'fast' | 'balanced' | 'strong' | 'auto';

interface ProcessedChunk {
  index: number;
  originalSize: number;
  compressedSize: number;
  compressedData: Uint8Array;
  checksum: number;
  hash: string;
  durationMs: number;
}

interface JobState {
  id: string;
  mode: CompressionMode;
  fileName: string;
  mimeType: string;
  originalSize: number;
  chunkSize: number;
  totalChunks: number;
  processedChunks: ProcessedChunk[];
  startTime: number;
  cancelled: boolean;
}

// ============================================================================
// CRC32 IMPLEMENTATION
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function sha256(data: Uint8Array): Promise<string> {
  // Handle SharedArrayBuffer by copying to ArrayBuffer
  let buffer: ArrayBuffer;
  if (data.buffer instanceof SharedArrayBuffer) {
    buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
  } else {
    buffer = (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// LZ77 COMPRESSION (REAL IMPLEMENTATION)
// ============================================================================

function lz77Compress(input: Uint8Array, level: number): Uint8Array {
  const windowSize = level === 0 ? 256 : level === 1 ? 4096 : 32768;
  const minMatch = 3;
  const maxMatch = 258;
  
  const output: number[] = [];
  let pos = 0;
  
  // Header: SPK3 magic + original size + level
  output.push(0x53, 0x50, 0x4B, 0x33); // "SPK3"
  output.push(
    (input.length >> 24) & 0xFF,
    (input.length >> 16) & 0xFF,
    (input.length >> 8) & 0xFF,
    input.length & 0xFF
  );
  output.push(level);
  
  while (pos < input.length) {
    let bestLength = 0;
    let bestOffset = 0;
    
    // Search for matches in sliding window
    const searchStart = Math.max(0, pos - windowSize);
    
    for (let i = searchStart; i < pos; i++) {
      let len = 0;
      while (len < maxMatch && 
             pos + len < input.length && 
             input[i + len] === input[pos + len]) {
        len++;
      }
      
      if (len >= minMatch && len > bestLength) {
        bestLength = len;
        bestOffset = pos - i;
      }
    }
    
    if (bestLength >= minMatch) {
      // Output match: [0xFF][offset high][offset low][length]
      output.push(0xFF);
      output.push((bestOffset >> 8) & 0xFF);
      output.push(bestOffset & 0xFF);
      output.push(bestLength);
      pos += bestLength;
    } else {
      // Output literal (escape 0xFF)
      if (input[pos] === 0xFF) {
        output.push(0xFF, 0x00, 0x00, 0x01);
        output.push(input[pos]);
      } else {
        output.push(input[pos]);
      }
      pos++;
    }
  }
  
  return new Uint8Array(output);
}

function lz77Decompress(input: Uint8Array): Uint8Array {
  // Verify header
  if (input.length < 9 ||
      input[0] !== 0x53 || input[1] !== 0x50 ||
      input[2] !== 0x4B || input[3] !== 0x33) {
    throw new Error('Invalid LZ77 chunk header');
  }
  
  const originalSize = 
    (input[4] << 24) | (input[5] << 16) | (input[6] << 8) | input[7];
  
  const output = new Uint8Array(originalSize);
  let outPos = 0;
  let inPos = 9; // Skip header + level byte
  
  while (inPos < input.length && outPos < originalSize) {
    if (input[inPos] === 0xFF && inPos + 3 < input.length) {
      const offsetHigh = input[inPos + 1];
      const offsetLow = input[inPos + 2];
      const length = input[inPos + 3];
      
      if (offsetHigh === 0 && offsetLow === 0 && length === 1) {
        // Escaped literal 0xFF
        inPos += 4;
        if (inPos < input.length) {
          output[outPos++] = input[inPos++];
        }
      } else {
        // Match reference
        const offset = (offsetHigh << 8) | offsetLow;
        const start = outPos - offset;
        
        for (let i = 0; i < length && outPos < originalSize; i++) {
          output[outPos++] = output[start + i];
        }
        inPos += 4;
      }
    } else {
      output[outPos++] = input[inPos++];
    }
  }
  
  return output;
}

// ============================================================================
// RLE COMPRESSION (FOR REPETITIVE DATA)
// ============================================================================

function rleCompress(input: Uint8Array): Uint8Array {
  const output: number[] = [];
  
  // Header: SPKR magic + original size
  output.push(0x53, 0x50, 0x4B, 0x52); // "SPKR"
  output.push(
    (input.length >> 24) & 0xFF,
    (input.length >> 16) & 0xFF,
    (input.length >> 8) & 0xFF,
    input.length & 0xFF
  );
  
  let i = 0;
  while (i < input.length) {
    let runLength = 1;
    const byte = input[i];
    
    while (i + runLength < input.length && 
           input[i + runLength] === byte && 
           runLength < 255) {
      runLength++;
    }
    
    if (runLength >= 4) {
      // Encoded run
      output.push(0xFE, byte, runLength);
    } else if (byte === 0xFE) {
      // Escape 0xFE
      output.push(0xFE, byte, 1);
    } else {
      // Literals
      for (let j = 0; j < runLength; j++) {
        output.push(byte);
      }
    }
    
    i += runLength;
  }
  
  return new Uint8Array(output);
}

function rleDecompress(input: Uint8Array): Uint8Array {
  if (input.length < 8 ||
      input[0] !== 0x53 || input[1] !== 0x50 ||
      input[2] !== 0x4B || input[3] !== 0x52) {
    throw new Error('Invalid RLE chunk header');
  }
  
  const originalSize = 
    (input[4] << 24) | (input[5] << 16) | (input[6] << 8) | input[7];
  
  const output = new Uint8Array(originalSize);
  let outPos = 0;
  let inPos = 8;
  
  while (inPos < input.length && outPos < originalSize) {
    if (input[inPos] === 0xFE && inPos + 2 < input.length) {
      const byte = input[inPos + 1];
      const count = input[inPos + 2];
      for (let i = 0; i < count && outPos < originalSize; i++) {
        output[outPos++] = byte;
      }
      inPos += 3;
    } else {
      output[outPos++] = input[inPos++];
    }
  }
  
  return output;
}

// ============================================================================
// COMPRESSION LOGIC
// ============================================================================

function estimateEntropy(data: Uint8Array): number {
  if (data.length === 0) return 0;
  
  const sampleSize = Math.min(data.length, 4096);
  const step = Math.max(1, Math.floor(data.length / sampleSize));
  
  const counts = new Uint32Array(256);
  let samples = 0;
  
  for (let i = 0; i < data.length; i += step) {
    counts[data[i]]++;
    samples++;
  }
  
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (counts[i] > 0) {
      const p = counts[i] / samples;
      entropy -= p * Math.log2(p);
    }
  }
  
  return entropy / 8; // Normalize to 0-1
}

function getModeLevel(mode: CompressionMode): number {
  switch (mode) {
    case 'fast': return 0;
    case 'balanced': return 1;
    case 'strong': return 2;
    case 'auto': return 1;
    default: return 1;
  }
}

function storeUncompressed(data: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.length + 9);
  output[0] = 0x53; // S
  output[1] = 0x50; // P
  output[2] = 0x4B; // K
  output[3] = 0x55; // U (uncompressed)
  output[4] = (data.length >> 24) & 0xFF;
  output[5] = (data.length >> 16) & 0xFF;
  output[6] = (data.length >> 8) & 0xFF;
  output[7] = data.length & 0xFF;
  output[8] = 0x00; // Flags
  output.set(data, 9);
  return output;
}

async function compressData(
  data: Uint8Array, 
  index: number, 
  mode: CompressionMode
): Promise<ProcessedChunk> {
  const startTime = performance.now();
  const level = getModeLevel(mode);
  
  // Choose compression method based on data characteristics
  let compressedData: Uint8Array;
  const entropy = estimateEntropy(data);
  
  if (entropy < 0.5) {
    // Low entropy (repetitive) - use RLE
    compressedData = rleCompress(data);
  } else {
    // Normal data - use LZ77
    compressedData = lz77Compress(data, level);
  }
  
  // If compression expanded data, store uncompressed
  if (compressedData.length >= data.length) {
    compressedData = storeUncompressed(data);
  }
  
  const checksum = crc32(compressedData);
  const hash = await sha256(compressedData);
  const durationMs = performance.now() - startTime;
  
  return {
    index,
    originalSize: data.length,
    compressedSize: compressedData.length,
    compressedData,
    checksum,
    hash,
    durationMs,
  };
}

function decompressData(data: Uint8Array): Uint8Array {
  if (data.length < 4) {
    throw new Error('Invalid chunk: too short');
  }
  
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  
  switch (magic) {
    case 'SPK3': return lz77Decompress(data);
    case 'SPKR': return rleDecompress(data);
    case 'SPKU': return extractUncompressed(data);
    default: throw new Error(`Unknown chunk format: ${magic}`);
  }
}

function extractUncompressed(data: Uint8Array): Uint8Array {
  if (data.length < 9) {
    throw new Error('Invalid uncompressed chunk');
  }
  const size = 
    (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
  return data.slice(9, 9 + size);
}

// ============================================================================
// ARCHIVE BUILDING
// ============================================================================

const SPK_MAGIC = new Uint8Array([0x53, 0x50, 0x4B, 0x21]); // "SPK!"
const SPK_VERSION = 31;
const HEADER_SIZE = 64;
const FOOTER_SIZE = 32;

function buildArchive(job: JobState): Blob {
  // Sort chunks by index
  const chunks = [...job.processedChunks].sort((a, b) => a.index - b.index);
  
  // Calculate total compressed size for chunks
  let chunksDataSize = 0;
  for (const chunk of chunks) {
    chunksDataSize += 4 + chunk.compressedSize; // 4-byte size prefix + data
  }
  
  // Build manifest
  const manifest = {
    version: SPK_VERSION,
    fileName: job.fileName,
    mimeType: job.mimeType,
    originalSize: job.originalSize,
    compressedSize: 0, // Updated later
    chunkSize: job.chunkSize,
    totalChunks: chunks.length,
    chunks: chunks.map(c => ({
      index: c.index,
      originalSize: c.originalSize,
      compressedSize: c.compressedSize,
      checksum: c.checksum,
      hash: c.hash,
    })),
    mode: job.mode,
    createdAt: Date.now(),
  };
  
  const manifestJson = JSON.stringify(manifest);
  const manifestBytes = new TextEncoder().encode(manifestJson);
  
  // Build archive parts
  const parts: ArrayBuffer[] = [];
  
  // 1. HEADER (64 bytes)
  const header = new ArrayBuffer(HEADER_SIZE);
  const headerView = new DataView(header);
  const headerBytes = new Uint8Array(header);
  
  // Magic
  headerBytes.set(SPK_MAGIC, 0);
  // Version
  headerView.setUint16(4, SPK_VERSION, true);
  // Flags
  let flags = job.mode === 'fast' ? 0 : job.mode === 'balanced' ? 1 : 2;
  flags |= 0x30; // has manifest + chunk table
  headerView.setUint16(6, flags, true);
  // Original size (64-bit)
  headerView.setBigUint64(8, BigInt(job.originalSize), true);
  // Chunk count
  headerView.setUint32(16, chunks.length, true);
  // Chunk size
  headerView.setUint32(20, job.chunkSize, true);
  // Chunks end offset
  const chunksEndOffset = HEADER_SIZE + chunksDataSize;
  headerView.setBigUint64(24, BigInt(chunksEndOffset), true);
  // Manifest offset
  const manifestOffset = chunksEndOffset;
  headerView.setBigUint64(32, BigInt(manifestOffset), true);
  // File name length + name (up to 20 chars)
  const fileNameBytes = new TextEncoder().encode(job.fileName);
  const truncatedName = fileNameBytes.slice(0, 20);
  headerView.setUint16(44, truncatedName.length, true);
  headerBytes.set(truncatedName, 46);
  
  parts.push(header);
  
  // 2. COMPRESSED CHUNKS with 4-byte size prefixes
  for (const chunk of chunks) {
    const sizePrefix = new ArrayBuffer(4);
    new DataView(sizePrefix).setUint32(0, chunk.compressedSize, true);
    parts.push(sizePrefix as ArrayBuffer);
    
    // Convert Uint8Array to ArrayBuffer properly (handle SharedArrayBuffer)
    let chunkBuffer: ArrayBuffer;
    if (chunk.compressedData.buffer instanceof SharedArrayBuffer) {
      chunkBuffer = new ArrayBuffer(chunk.compressedData.byteLength);
      new Uint8Array(chunkBuffer).set(chunk.compressedData);
    } else {
      chunkBuffer = (chunk.compressedData.buffer as ArrayBuffer).slice(
        chunk.compressedData.byteOffset,
        chunk.compressedData.byteOffset + chunk.compressedData.byteLength
      );
    }
    parts.push(chunkBuffer as ArrayBuffer);
  }
  
  // 3. MANIFEST with 4-byte size prefix
  const manifestSizePrefix = new ArrayBuffer(4);
  new DataView(manifestSizePrefix).setUint32(0, manifestBytes.length, true);
  parts.push(manifestSizePrefix);
  parts.push(manifestBytes.buffer.slice(
    manifestBytes.byteOffset,
    manifestBytes.byteOffset + manifestBytes.byteLength
  ));
  
  // 4. FOOTER (32 bytes)
  const footer = new ArrayBuffer(FOOTER_SIZE);
  const footerView = new DataView(footer);
  const footerBytes = new Uint8Array(footer);
  
  // Footer magic "!KPS"
  footerBytes.set([0x21, 0x4B, 0x50, 0x53], 0);
  // Chunk table offset (same as chunks start for simplicity)
  footerView.setBigUint64(4, BigInt(HEADER_SIZE), true);
  // Manifest offset
  footerView.setBigUint64(12, BigInt(manifestOffset), true);
  // Original size
  footerView.setBigUint64(20, BigInt(job.originalSize), true);
  // CRC32 of footer (first 28 bytes)
  const footerCrc = crc32(new Uint8Array(footer, 0, 28));
  footerView.setUint32(28, footerCrc, true);
  
  parts.push(footer);
  
  // Create Blob
  return new Blob(parts, { type: 'application/x-spk' });
}

// ============================================================================
// WORKER STATE
// ============================================================================

let activeJob: JobState | null = null;
let initialized = false;

// Speed tracking
const speedSamples: Array<{ time: number; bytes: number }> = [];
const MAX_SAMPLES = 50;

function addSpeedSample(bytes: number): void {
  speedSamples.push({ time: Date.now(), bytes });
  while (speedSamples.length > MAX_SAMPLES) {
    speedSamples.shift();
  }
}

function calculateSpeed(): number {
  if (speedSamples.length < 2) return 0;
  
  const windowStart = Date.now() - 5000;
  const samples = speedSamples.filter(s => s.time >= windowStart);
  
  if (samples.length < 2) return 0;
  
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = (last.time - first.time) / 1000;
  const bytes = samples.reduce((sum, s) => sum + s.bytes, 0);
  
  return dt > 0 ? bytes / dt : 0;
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

function send(msg: any, transfer?: Transferable[]): void {
  self.postMessage(msg, { transfer: transfer || [] });
}

async function handleMessage(msg: any): Promise<void> {
  switch (msg.type) {
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    case 'INIT':
    case 'INIT_WASM':
      initialized = true;
      send({
        type: 'READY',
        workerId: `spk-v31-${Date.now()}`,
        capabilities: {
          hasRealCompression: true,
          supportedModes: ['fast', 'balanced', 'strong', 'auto'],
          maxMemory: 256 * 1024 * 1024,
        },
      });
      send({ type: 'WASM_READY', version: SPK_VERSION });
      break;
    
    // ========================================================================
    // START JOB
    // ========================================================================
    case 'START_JOB':
    case 'START_STREAM':
      if (activeJob) {
        send({ type: 'ERROR', jobId: msg.jobId, message: 'Worker busy' });
        return;
      }
      
      activeJob = {
        id: msg.jobId,
        mode: msg.mode || msg.settings?.mode || 'balanced',
        fileName: msg.fileName || 'archive',
        mimeType: msg.mimeType || 'application/octet-stream',
        originalSize: msg.totalBytes || msg.originalSize || 0,
        chunkSize: msg.chunkSize || msg.settings?.chunkSize || 4 * 1024 * 1024,
        totalChunks: msg.totalChunks || 0,
        processedChunks: [],
        startTime: Date.now(),
        cancelled: false,
      };
      
      speedSamples.length = 0;
      send({ type: 'JOB_STARTED', jobId: msg.jobId });
      break;
    
    // ========================================================================
    // PROCESS CHUNK
    // ========================================================================
    case 'PROCESS_CHUNK':
    case 'SEND_CHUNK':
      if (!activeJob || activeJob.id !== msg.jobId) {
        send({ type: 'ERROR', jobId: msg.jobId, message: 'No active job' });
        return;
      }
      
      if (activeJob.cancelled) return;
      
      try {
        const data = new Uint8Array(msg.data);
        const processed = await compressData(data, msg.index ?? msg.seq, activeJob.mode);
        
        activeJob.processedChunks.push(processed);
        addSpeedSample(processed.originalSize);
        
        const bytesProcessed = activeJob.processedChunks.reduce(
          (sum, c) => sum + c.originalSize, 0
        );
        const bytesCompressed = activeJob.processedChunks.reduce(
          (sum, c) => sum + c.compressedSize, 0
        );
        
        // Send chunk processed
        send({
          type: 'CHUNK_PROCESSED',
          jobId: msg.jobId,
          index: processed.index,
          seq: processed.index,
          originalSize: processed.originalSize,
          compressedSize: processed.compressedSize,
          checksum: processed.checksum,
          hash: processed.hash,
          durationMs: processed.durationMs,
        });
        
        // Send progress
        const speed = calculateSpeed();
        const remaining = activeJob.originalSize - bytesProcessed;
        const eta = speed > 0 ? remaining / speed : 0;
        
        send({
          type: 'PROGRESS',
          jobId: msg.jobId,
          chunksProcessed: activeJob.processedChunks.length,
          totalChunks: activeJob.totalChunks,
          bytesProcessed,
          totalBytes: activeJob.originalSize,
          bytesCompressed,
          speed,
          eta,
          ratio: bytesProcessed > 0 ? bytesCompressed / bytesProcessed : 1,
        });
        
        // Auto-finalize if last chunk
        if (msg.isLast) {
          await finalizeJob();
        }
        
      } catch (error) {
        send({
          type: 'CHUNK_ERROR',
          jobId: msg.jobId,
          index: msg.index ?? msg.seq,
          error: error instanceof Error ? error.message : 'Compression failed',
        });
      }
      break;
    
    // ========================================================================
    // FINALIZE
    // ========================================================================
    case 'FINALIZE':
    case 'FLUSH_ARCHIVE':
      await finalizeJob();
      break;
    
    // ========================================================================
    // CANCEL
    // ========================================================================
    case 'CANCEL':
      if (activeJob && activeJob.id === msg.jobId) {
        const job = activeJob;
        job.cancelled = true;
        send({
          type: 'CANCELLED',
          jobId: msg.jobId,
          chunksProcessed: job.processedChunks.length,
          bytesProcessed: job.processedChunks.reduce(
            (sum, c) => sum + c.originalSize, 0
          ),
        });
        activeJob = null;
      }
      break;
    
    // ========================================================================
    // DECOMPRESS
    // ========================================================================
    case 'DECOMPRESS_CHUNK':
      try {
        const data = new Uint8Array(msg.data);
        const decompressed = decompressData(data);
        send({
          type: 'CHUNK_DECOMPRESSED',
          jobId: msg.jobId,
          index: msg.index,
          data: decompressed.buffer,
          size: decompressed.length,
        }, [decompressed.buffer]);
      } catch (error) {
        send({
          type: 'DECOMPRESS_ERROR',
          jobId: msg.jobId,
          index: msg.index,
          error: error instanceof Error ? error.message : 'Decompression failed',
        });
      }
      break;
    
    // ========================================================================
    // STATS
    // ========================================================================
    case 'GET_STATS':
      send({
        type: 'STATS',
        initialized,
        hasActiveJob: activeJob !== null,
        activeJobId: activeJob?.id,
        chunksProcessed: activeJob?.processedChunks.length ?? 0,
      });
      break;
  }
}

async function finalizeJob(): Promise<void> {
  if (!activeJob) {
    send({ type: 'ERROR', message: 'No active job to finalize' });
    return;
  }
  
  if (activeJob.cancelled) return;
  
  const currentJob = activeJob;
  
  try {
    // Build final archive
    const blob = buildArchive(currentJob);
    const durationMs = Date.now() - currentJob.startTime;
    
    const totalOriginal = currentJob.processedChunks.reduce(
      (sum, c) => sum + c.originalSize, 0
    );
    
    send({
      type: 'FINAL_BLOB',
      jobId: currentJob.id,
      blob,
      originalSize: totalOriginal,
      compressedSize: blob.size,
      totalChunks: currentJob.processedChunks.length,
      durationMs,
      ratio: totalOriginal > 0 ? blob.size / totalOriginal : 1,
      averageSpeed: totalOriginal / (durationMs / 1000),
      manifest: {
        version: SPK_VERSION,
        fileName: currentJob.fileName,
        originalSize: totalOriginal,
        compressedSize: blob.size,
        chunks: currentJob.processedChunks.length,
      },
    });
    
    // Cleanup
    activeJob = null;
    speedSamples.length = 0;
    
  } catch (error) {
    send({
      type: 'ERROR',
      jobId: currentJob.id,
      error: error instanceof Error ? error.message : 'Finalize failed',
    });
  }
}

// ============================================================================
// WORKER SETUP
// ============================================================================

self.onmessage = async (event: MessageEvent) => {
  try {
    await handleMessage(event.data);
  } catch (error) {
    send({
      type: 'ERROR',
      jobId: event.data?.jobId,
      error: error instanceof Error ? error.message : 'Worker error',
    });
  }
};

// Auto-initialize
initialized = true;
send({ type: 'READY', workerId: `spk-v31-${Date.now()}` });

console.log('[SPK V31 Worker] Initialized with real compression');

})(); // End function scope
