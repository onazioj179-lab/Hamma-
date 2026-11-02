/**
 * SPK V32 - Decompression Worker
 * 
 * Self-contained Web Worker for decompression.
 * Mirrors the compression worker architecture.
 */

// Wrap in function scope to avoid global conflicts
(function() {

// ============================================================================
// TYPES
// ============================================================================

interface DecompressJob {
  id: string;
  fileName: string;
  originalSize: number;
  totalChunks: number;
  processedChunks: Uint8Array[];
  startTime: number;
  cancelled: boolean;
}

// ============================================================================
// CRC32 TABLE
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

// ============================================================================
// LZ77 DECOMPRESSION
// ============================================================================

function lz77Decompress(compressed: Uint8Array): Uint8Array {
  if (compressed[0] !== 0x53 || compressed[1] !== 0x50 || 
      compressed[2] !== 0x4B || compressed[3] !== 0x33) {
    throw new Error('Invalid LZ77 data');
  }
  
  const originalSize = (compressed[4] << 24) | (compressed[5] << 16) | 
                       (compressed[6] << 8) | compressed[7];
  
  const output = new Uint8Array(originalSize);
  let outPos = 0;
  let inPos = 9;
  
  while (outPos < originalSize && inPos < compressed.length) {
    const flag = compressed[inPos++];
    
    if (flag === 0) {
      if (inPos < compressed.length) {
        output[outPos++] = compressed[inPos++];
      }
    } else if (flag === 1) {
      if (inPos + 2 < compressed.length) {
        const offset = (compressed[inPos] << 8) | compressed[inPos + 1];
        const length = compressed[inPos + 2];
        inPos += 3;
        
        const srcStart = outPos - offset;
        for (let i = 0; i < length && outPos < originalSize; i++) {
          output[outPos++] = output[srcStart + i];
        }
      }
    }
  }
  
  return output.slice(0, outPos);
}

// ============================================================================
// RLE DECOMPRESSION
// ============================================================================

function rleDecompress(compressed: Uint8Array): Uint8Array {
  if (compressed[0] !== 0x53 || compressed[1] !== 0x50 || 
      compressed[2] !== 0x4B || compressed[3] !== 0x52) {
    throw new Error('Invalid RLE data');
  }
  
  const originalSize = (compressed[4] << 24) | (compressed[5] << 16) | 
                       (compressed[6] << 8) | compressed[7];
  
  const output = new Uint8Array(originalSize);
  let outPos = 0;
  let inPos = 8;
  
  while (outPos < originalSize && inPos < compressed.length) {
    const count = compressed[inPos++];
    
    if (count < 128) {
      const literalCount = count + 1;
      for (let i = 0; i < literalCount && inPos < compressed.length && outPos < originalSize; i++) {
        output[outPos++] = compressed[inPos++];
      }
    } else {
      const repeatCount = count - 127;
      if (inPos < compressed.length) {
        const value = compressed[inPos++];
        for (let i = 0; i < repeatCount && outPos < originalSize; i++) {
          output[outPos++] = value;
        }
      }
    }
  }
  
  return output.slice(0, outPos);
}

// ============================================================================
// AUTO-DETECT DECOMPRESS
// ============================================================================

function decompressData(compressed: Uint8Array): Uint8Array {
  const magic = String.fromCharCode(compressed[0], compressed[1], compressed[2], compressed[3]);
  
  if (magic === 'SPK3') {
    return lz77Decompress(compressed);
  } else if (magic === 'SPKR') {
    return rleDecompress(compressed);
  } else {
    throw new Error(`Unknown format: ${magic}`);
  }
}

// ============================================================================
// WORKER STATE
// ============================================================================

let initialized = false;
let activeJob: DecompressJob | null = null;

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

// Worker global scope type
declare const self: Worker & typeof globalThis;

// Get proper worker context
const workerSelf = self;

function send(message: unknown, transfer?: Transferable[]): void {
  if (transfer) {
    workerSelf.postMessage(message, { transfer });
  } else {
    workerSelf.postMessage(message);
  }
}

workerSelf.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  
  switch (msg.type) {
    case 'INIT':
      initialized = true;
      send({ type: 'READY' });
      break;
      
    case 'START_DECOMPRESS_JOB':
      activeJob = {
        id: msg.jobId,
        fileName: msg.fileName,
        originalSize: msg.originalSize,
        totalChunks: msg.totalChunks,
        processedChunks: new Array(msg.totalChunks),
        startTime: Date.now(),
        cancelled: false,
      };
      send({
        type: 'JOB_STARTED',
        jobId: msg.jobId,
      });
      break;
      
    case 'DECOMPRESS_CHUNK':
      if (!activeJob || activeJob.id !== msg.jobId || activeJob.cancelled) {
        break;
      }
      
      try {
        const compressed = new Uint8Array(msg.data);
        
        // Verify checksum if provided
        if (msg.expectedChecksum !== undefined) {
          const checksum = crc32(compressed);
          if (checksum !== msg.expectedChecksum) {
            send({
              type: 'CHUNK_CHECKSUM_MISMATCH',
              jobId: msg.jobId,
              index: msg.index,
              expected: msg.expectedChecksum,
              actual: checksum,
            });
          }
        }
        
        const startTime = performance.now();
        const decompressed = decompressData(compressed);
        const durationMs = performance.now() - startTime;
        
        activeJob.processedChunks[msg.index] = decompressed;
        
        // Calculate progress
        const processedCount = activeJob.processedChunks.filter(Boolean).length;
        const bytesProcessed = activeJob.processedChunks
          .filter(Boolean)
          .reduce((sum, chunk) => sum + chunk.length, 0);
        
        send({
          type: 'CHUNK_DECOMPRESSED',
          jobId: msg.jobId,
          index: msg.index,
          originalSize: decompressed.length,
          compressedSize: compressed.length,
          durationMs,
          chunksProcessed: processedCount,
          totalChunks: activeJob.totalChunks,
          bytesProcessed,
        });
        
      } catch (error) {
        send({
          type: 'ERROR',
          jobId: msg.jobId,
          error: error instanceof Error ? error.message : 'Decompression failed',
        });
      }
      break;
      
    case 'FINALIZE_DECOMPRESS':
      if (!activeJob || activeJob.id !== msg.jobId) {
        send({ type: 'ERROR', error: 'No active job' });
        break;
      }
      
      try {
        // Verify all chunks present
        for (let i = 0; i < activeJob.totalChunks; i++) {
          if (!activeJob.processedChunks[i]) {
            throw new Error(`Missing chunk ${i}`);
          }
        }
        
        // Build final blob
        const blob = new Blob(activeJob.processedChunks as unknown as BlobPart[], { 
          type: msg.mimeType || 'application/octet-stream' 
        });
        
        const durationMs = Date.now() - activeJob.startTime;
        
        send({
          type: 'DECOMPRESS_COMPLETE',
          jobId: activeJob.id,
          blob,
          fileName: activeJob.fileName,
          originalSize: activeJob.originalSize,
          restoredSize: blob.size,
          durationMs,
          verified: blob.size === activeJob.originalSize,
        });
        
        activeJob = null;
        
      } catch (error) {
        send({
          type: 'ERROR',
          jobId: activeJob.id,
          error: error instanceof Error ? error.message : 'Finalize failed',
        });
      }
      break;
      
    case 'CANCEL':
      if (activeJob?.id === msg.jobId) {
        activeJob.cancelled = true;
        send({
          type: 'CANCELLED',
          jobId: msg.jobId,
        });
        activeJob = null;
      }
      break;
      
    case 'GET_STATUS':
      send({
        type: 'STATUS',
        initialized,
        hasActiveJob: activeJob !== null,
        activeJobId: activeJob?.id,
      });
      break;
  }
};

// Signal ready
send({ type: 'WORKER_LOADED' });

})(); // End function scope
