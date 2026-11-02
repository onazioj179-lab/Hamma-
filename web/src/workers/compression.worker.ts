// SPK V24 - Compression Worker
// Runs in separate thread to prevent UI freezing

import { loadSpkWasm, type ProgressEvent, type CompressionMode } from '../wasm';

// Worker message types
interface WorkerRequest {
  id: string;
  type: 'compress' | 'decompress' | 'cancel';
  data?: ArrayBuffer;
  fileName?: string;
  options?: {
    mode: CompressionMode;
    chunkSize: number;
  };
}

interface WorkerResponse {
  id: string;
  type: 'progress' | 'complete' | 'error' | 'cancelled';
  progress?: ProgressEvent;
  result?: ArrayBuffer;
  stats?: {
    originalSize: number;
    resultSize: number;
    ratio: number;
    duration: number;
    speedMbps: number;
  };
  error?: string;
}

// Active operations
const activeOperations = new Map<string, { cancelled: boolean }>();

// Get chunk size based on mode
const getChunkSize = (mode: CompressionMode, fileSize: number): number => {
  switch (mode) {
    case 'fast':
      return 256 * 1024; // 256KB - faster, less compression
    case 'balanced':
      return 1024 * 1024; // 1MB - balanced
    case 'strong':
      return 4 * 1024 * 1024; // 4MB - slower, better compression
    case 'auto':
    default:
      // Auto-adjust based on file size
      if (fileSize < 10 * 1024 * 1024) return 256 * 1024; // <10MB: 256KB
      if (fileSize < 100 * 1024 * 1024) return 1024 * 1024; // <100MB: 1MB
      if (fileSize < 1024 * 1024 * 1024) return 2 * 1024 * 1024; // <1GB: 2MB
      return 4 * 1024 * 1024; // >1GB: 4MB
  }
};

// Process compression
const processCompression = async (
  id: string,
  data: ArrayBuffer,
  mode: CompressionMode,
  postProgress: (event: ProgressEvent) => void
): Promise<ArrayBuffer> => {
  const wasm = await loadSpkWasm();
  const input = new Uint8Array(data);
  const totalBytes = input.length;
  const chunkSize = getChunkSize(mode, totalBytes);
  const totalChunks = Math.ceil(totalBytes / chunkSize);
  
  const operation = activeOperations.get(id);
  const compressor = wasm.createCompressor(chunkSize);
  const startTime = performance.now();
  let processedBytes = 0;
  
  // Process in chunks
  for (let i = 0; i < totalChunks; i++) {
    if (operation?.cancelled) {
      compressor.cancel();
      throw new Error('Operation cancelled');
    }
    
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const chunk = input.slice(start, end);
    
    compressor.feedChunk(chunk);
    processedBytes = end;
    
    // Calculate speed
    const elapsed = (performance.now() - startTime) / 1000;
    const speedMbps = elapsed > 0 ? (processedBytes / (1024 * 1024)) / elapsed : 0;
    
    postProgress({
      bytesProcessed: processedBytes,
      totalBytes,
      chunksProcessed: i + 1,
      totalChunks,
      speedMbps,
      phase: 'processing',
    });
    
    // Yield to prevent blocking
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  // Finalize
  postProgress({
    bytesProcessed: totalBytes,
    totalBytes,
    chunksProcessed: totalChunks,
    totalChunks,
    speedMbps: 0,
    phase: 'finalizing',
  });
  
  const result = compressor.finish();
  return result.buffer as ArrayBuffer;
};

// Process decompression
const processDecompression = async (
  id: string,
  data: ArrayBuffer,
  postProgress: (event: ProgressEvent) => void
): Promise<ArrayBuffer> => {
  const wasm = await loadSpkWasm();
  const input = new Uint8Array(data);
  
  // Validate archive
  const validation = wasm.validateArchive(input);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid SPK archive');
  }
  
  const operation = activeOperations.get(id);
  const totalBytes = input.length;
  const chunkSize = 1024 * 1024; // 1MB chunks for decompression
  const totalChunks = Math.ceil(totalBytes / chunkSize);
  
  const decompressor = wasm.createDecompressor();
  const startTime = performance.now();
  let processedBytes = 0;
  
  // Skip header (8 bytes)
  const dataStart = 8;
  const dataLength = totalBytes - dataStart;
  
  for (let i = 0; i < totalChunks; i++) {
    if (operation?.cancelled) {
      decompressor.cancel();
      throw new Error('Operation cancelled');
    }
    
    const start = dataStart + i * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const chunk = input.slice(start, end);
    
    decompressor.feedChunk(chunk);
    processedBytes = end - dataStart;
    
    const elapsed = (performance.now() - startTime) / 1000;
    const speedMbps = elapsed > 0 ? (processedBytes / (1024 * 1024)) / elapsed : 0;
    
    postProgress({
      bytesProcessed: processedBytes,
      totalBytes: dataLength,
      chunksProcessed: i + 1,
      totalChunks,
      speedMbps,
      phase: 'processing',
    });
    
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  postProgress({
    bytesProcessed: dataLength,
    totalBytes: dataLength,
    chunksProcessed: totalChunks,
    totalChunks,
    speedMbps: 0,
    phase: 'finalizing',
  });
  
  const result = decompressor.finish();
  return result.buffer as ArrayBuffer;
};

// Message handler
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, type, data, options } = e.data;
  
  const postResponse = (response: Omit<WorkerResponse, 'id'>) => {
    self.postMessage({ id, ...response } as WorkerResponse);
  };
  
  const postProgress = (progress: ProgressEvent) => {
    postResponse({ type: 'progress', progress });
  };
  
  if (type === 'cancel') {
    const operation = activeOperations.get(id);
    if (operation) {
      operation.cancelled = true;
    }
    return;
  }
  
  if (!data) {
    postResponse({ type: 'error', error: 'No data provided' });
    return;
  }
  
  // Track operation
  activeOperations.set(id, { cancelled: false });
  const startTime = performance.now();
  
  try {
    let result: ArrayBuffer;
    
    if (type === 'compress') {
      result = await processCompression(
        id,
        data,
        options?.mode || 'auto',
        postProgress
      );
    } else {
      result = await processDecompression(id, data, postProgress);
    }
    
    const duration = (performance.now() - startTime) / 1000;
    const speedMbps = duration > 0 ? (data.byteLength / (1024 * 1024)) / duration : 0;
    
    postResponse({
      type: 'complete',
      result,
      stats: {
        originalSize: data.byteLength,
        resultSize: result.byteLength,
        ratio: type === 'compress' 
          ? 1 - (result.byteLength / data.byteLength)
          : (result.byteLength / data.byteLength) - 1,
        duration,
        speedMbps,
      },
    });
  } catch (error) {
    if ((error as Error).message === 'Operation cancelled') {
      postResponse({ type: 'cancelled' });
    } else {
      postResponse({ 
        type: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } finally {
    activeOperations.delete(id);
  }
};
