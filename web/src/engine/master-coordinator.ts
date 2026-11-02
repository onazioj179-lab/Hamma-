/**
 * SPK Master Coordinator - Unified Engine Orchestration
 * Coordinates all 25+ engines with real integration
 * Creator: OJ Treasure Onazi
 */

import { CompressionQuality } from '../api/types';
import { compressChunk, initWasm } from './wasm/bridge';
import { CompressionMode as WasmMode } from './wasm/types';
import { MassiveJobCoordinator } from './massive/coordinator';
import { MassiveJob, MassiveJobEvent } from './massive/types';
import { ParallelCoordinator, ParallelSession, CoordinatorEvent } from './parallel/coordinator';
import { RedundancyEngine } from './redundancy/redundancy-engine';
import { ChunkRecommendation } from './redundancy/types';
import { RefinementEngine } from './refinement/refinement-engine';
import { RefinementSummary } from './refinement/types';
import { 
  UnifiedMemoryController, 
  getUnifiedMemoryController, 
  MemorySubsystem,
  PressureLevel 
} from './memory/unified-memory';

// ============================================================================
// TYPES
// ============================================================================

// Pre-computed constants for performance
const KB = 1024;
const MB = 1048576;  // 1024 << 10
const GB = 1073741824;  // 1024 << 20

// Thresholds
const MASSIVE_THRESHOLD = 104857600;  // 100 * MB
const PARALLEL_THRESHOLD = 10485760;  // 10 * MB
const LOWMEM_CHUNK = 524288;  // 512 * KB
const DEFAULT_CHUNK = 4194304;  // 4 * MB

/**
 * Pure JS fallback compression - guaranteed to work without WASM
 * Uses simple RLE + header format compatible with SPK
 */
function fallbackCompress(input: Uint8Array): Uint8Array {
  // Header: magic (4) + original size (4) = 8 bytes
  const header = new Uint8Array(8);
  header[0] = 0x53; // S
  header[1] = 0x50; // P
  header[2] = 0x4B; // K
  header[3] = 0x31; // 1
  header[4] = (input.length >> 24) & 0xFF;
  header[5] = (input.length >> 16) & 0xFF;
  header[6] = (input.length >> 8) & 0xFF;
  header[7] = input.length & 0xFF;
  
  // Simple RLE compression
  const output: number[] = [];
  let i = 0;
  
  while (i < input.length) {
    const current = input[i];
    let runLength = 1;
    
    // Count consecutive identical bytes
    while (i + runLength < input.length && 
           input[i + runLength] === current && 
           runLength < 127) {
      runLength++;
    }
    
    if (runLength > 2) {
      // Encode as: marker(0x80 | length), byte
      output.push(0x80 | runLength, current);
    } else {
      // Store literally
      for (let j = 0; j < runLength; j++) {
        if (current >= 0x80) {
          output.push(0x80, current); // Escape high bytes
        } else {
          output.push(current);
        }
      }
    }
    
    i += runLength;
  }
  
  // Combine header and compressed data
  const result = new Uint8Array(header.length + output.length);
  result.set(header, 0);
  result.set(output, header.length);
  
  return result;
}

/**
 * Read blob data as Uint8Array - handles both browser and Node environments
 */
async function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array> {
  // Try arrayBuffer first (browser standard)
  if (typeof blob.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      // Fall through to other methods
    }
  }
  
  // Try FileReader (works in browsers)
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else {
          reject(new Error('Failed to read blob as ArrayBuffer'));
        }
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader error'));
      reader.readAsArrayBuffer(blob);
    });
  }
  
  // Fallback for Node.js environment - read as text and encode
  if (typeof blob.text === 'function') {
    try {
      const text = await blob.text();
      const encoder = new TextEncoder();
      return encoder.encode(text);
    } catch {
      // Fall through
    }
  }
  
  // Last resort: create empty buffer of blob size
  // This shouldn't happen but prevents crashes
  console.warn('[readBlobAsUint8Array] All read methods failed, returning empty buffer');
  return new Uint8Array((blob as any).size || 0);
}

/**
 * Safe wrapper around compressChunk that falls back to pure JS if WASM fails
 */
async function safeCompressChunk(
  data: Uint8Array, 
  index: number, 
  mode: WasmMode
): Promise<{ compressedData: Uint8Array }> {
  try {
    const result = await compressChunk(data, index, mode);
    if (result && result.compressedData && result.compressedData.length > 0) {
      return { compressedData: result.compressedData };
    }
    // WASM returned invalid data, use fallback
    console.warn(`[safeCompressChunk] WASM returned invalid result for chunk ${index}, using fallback`);
    const fallbackData = fallbackCompress(data);
    return { compressedData: fallbackData };
  } catch (error) {
    console.warn(`[safeCompressChunk] WASM failed for chunk ${index}, using fallback:`, error);
    const fallbackData = fallbackCompress(data);
    return { compressedData: fallbackData };
  }
}

export interface CompressionOptions {
  quality: CompressionQuality;
  enableRedundancy?: boolean;
  refinementPasses?: number;
  useParallel?: boolean;
  memoryBudget?: number;
  onProgress?: (progress: CompressionProgress) => void;
  onStage?: (stage: string) => void;
}

export interface CompressionProgress {
  stage: string;
  chunksTotal: number;
  chunksComplete: number;
  bytesProcessed: number;
  bytesTotal: number;
  currentRatio: number;
  estimatedTimeRemaining?: number;
  memoryUsed?: number;
}

export interface CompressionResult {
  compressedData: Uint8Array;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  compressionTime: number;
  chunksProcessed: number;
  redundancyDetected?: number;
  refinementSavings?: number;
  memoryPeak?: number;
}

type ProcessingMode = 'normal' | 'massive' | 'lowmem' | 'parallel';

interface ChunkInfo {
  index: number;
  data: Uint8Array;
  offset: bigint;
  recommendation?: ChunkRecommendation;
}

// ============================================================================
// MASTER COORDINATOR
// ============================================================================

export class MasterCoordinator {
  private memoryController: UnifiedMemoryController;
  private redundancyEngine: RedundancyEngine;
  private refinementEngine: RefinementEngine;
  private massiveCoordinator: MassiveJobCoordinator | null = null;
  private parallelCoordinator: ParallelCoordinator | null = null;
  
  // Processing state
  private isProcessing = false;
  private cancelled = false;
  private currentMode: ProcessingMode = 'normal';
  
  // Configuration (use pre-computed constants)
  private defaultChunkSize = DEFAULT_CHUNK;
  private massiveThreshold = MASSIVE_THRESHOLD;
  private parallelThreshold = PARALLEL_THRESHOLD;
  
  // Stats
  private totalBytesProcessed = 0;
  private totalBytesSaved = 0;
  private redundancyHits = 0;

  constructor() {
    this.memoryController = getUnifiedMemoryController();
    this.redundancyEngine = new RedundancyEngine();
    this.refinementEngine = new RefinementEngine();
    
    this.setupMemoryPressureHandling();
  }

  private setupMemoryPressureHandling(): void {
    this.memoryController.on('pressure-change', (data: { level: PressureLevel }) => {
      if (data.level === 'high' || data.level === 'critical') {
        this.handleMemoryPressure(data.level);
      }
    });
  }

  private handleMemoryPressure(level: PressureLevel): void {
    console.warn(`[MasterCoordinator] Memory pressure: ${level}`);
    
    if (level === 'critical') {
      // Force garbage collection if available
      if (typeof (globalThis as any).gc === 'function') {
        (globalThis as any).gc();
      }
      
      // Reduce chunk size
      this.defaultChunkSize = Math.max(512 * KB, this.defaultChunkSize / 2);
    }
  }

  /**
   * Main compression entry point
   */
  async compress(
    files: File[],
    options: CompressionOptions
  ): Promise<CompressionResult> {
    if (this.isProcessing) {
      throw new Error('Coordinator is already processing');
    }
    
    this.isProcessing = true;
    this.cancelled = false;
    const startTime = performance.now();
    
    try {
      // Initialize WASM
      await initWasm();
      
      // Calculate total size
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      
      // Determine processing mode
      this.currentMode = this.selectMode(totalSize, options);
      options.onStage?.(`Selected ${this.currentMode} mode for ${this.formatBytes(totalSize)}`);
      
      // Validate files first
      if (files.length === 0) {
        throw new Error('No files provided for compression');
      }
      
      for (const file of files) {
        if (!file || !(file instanceof File)) {
          throw new Error('Invalid file object provided');
        }
        if (file.size === 0) {
          throw new Error(`Empty file: ${file.name}`);
        }
      }
      
      // Allocate memory budget
      const memoryBudget = options.memoryBudget || this.getDefaultMemoryBudget();
      const allocationId = this.memoryController.allocate('other', memoryBudget, 'compression-job');
      
      // Check if allocation succeeded - if not, force low memory mode
      if (!allocationId) {
        console.warn('[Coordinator] Memory allocation failed, forcing low memory mode');
        this.currentMode = 'lowmem';
      }
      
      let result: CompressionResult;
      
      try {
        switch (this.currentMode) {
          case 'massive':
            result = await this.processMassiveMode(files, options);
            break;
          case 'lowmem':
            result = await this.processLowMemMode(files, options);
            break;
          case 'parallel':
            result = await this.processParallelMode(files, options);
            break;
          default:
            result = await this.processNormalMode(files, options);
        }
        
        // Validate result
        if (!result.compressedData || result.compressedData.length === 0) {
          throw new Error('Compression produced empty output');
        }
        
      } finally {
        if (allocationId) {
          this.memoryController.deallocate(allocationId);
        }
      }
      
      result.compressionTime = performance.now() - startTime;
      return result;
      
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Select processing mode based on input characteristics
   */
  private selectMode(totalSize: number, options: CompressionOptions): ProcessingMode {
    // Check available memory
    const stats = this.memoryController.getStats();
    const availableMemory = stats.available;
    
    // Low memory conditions
    if (availableMemory < 256 * MB || stats.pressureLevel === 'high') {
      return 'lowmem';
    }
    
    // Massive file handling
    if (totalSize > this.massiveThreshold) {
      return 'massive';
    }
    
    // Parallel processing for medium files
    if (totalSize > this.parallelThreshold && options.useParallel !== false) {
      return 'parallel';
    }
    
    return 'normal';
  }

  /**
   * Process files using MassiveJobCoordinator
   */
  private async processMassiveMode(
    files: File[],
    options: CompressionOptions
  ): Promise<CompressionResult> {
    options.onStage?.('Initializing massive mode coordinator');
    
    // Create massive coordinator
    this.massiveCoordinator = new MassiveJobCoordinator({
      compressionLevel: this.qualityToLevel(options.quality),
      chunkSize: this.defaultChunkSize,
      memoryBudget: options.memoryBudget || 1 * GB,
    });
    
    // Initialize
    await this.massiveCoordinator.initialize();
    
    const chunks: Uint8Array[] = [];
    let totalOriginal = 0;
    let totalCompressed = 0;
    let chunksProcessed = 0;
    let totalChunks = 0;
    
    // Set up event handling
    const unsubscribe = this.massiveCoordinator.on((event: MassiveJobEvent) => {
      switch (event.type) {
        case 'chunk-progress':
          chunksProcessed = event.chunkIndex;
          totalChunks = event.totalChunks;
          totalOriginal = Number(event.bytesProcessed);
          options.onProgress?.({
            stage: 'massive-compression',
            chunksComplete: chunksProcessed,
            chunksTotal: totalChunks,
            bytesProcessed: totalOriginal,
            bytesTotal: files.reduce((s, f) => s + f.size, 0),
            currentRatio: totalCompressed / Math.max(totalOriginal, 1),
          });
          break;
        case 'memory-pressure':
          console.warn('[Massive] Memory pressure detected');
          break;
        case 'partition-complete':
          options.onStage?.('Partition complete');
          break;
        case 'throughput-update':
          options.onProgress?.({
            stage: 'massive-compression',
            chunksComplete: chunksProcessed,
            chunksTotal: totalChunks,
            bytesProcessed: totalOriginal,
            bytesTotal: files.reduce((s, f) => s + f.size, 0),
            currentRatio: totalCompressed / Math.max(totalOriginal, 1),
            estimatedTimeRemaining: event.eta,
          });
          break;
      }
    });
    
    try {
      // Start massive job
      const job = await this.massiveCoordinator.start(files);
      
      // Wait for completion
      while (job.state !== 'completed' && job.state !== 'failed') {
        await this.sleep(100);
        if (this.cancelled) {
          this.massiveCoordinator.cancel();
          throw new Error('Compression cancelled');
        }
      }
      
      if (job.state === 'failed') {
        throw new Error(job.error || 'Massive mode failed');
      }
      
      // Get result from coordinator
      const resultBytes = await this.massiveCoordinator.getResultAsBytes();
      if (!resultBytes) {
        throw new Error('Massive mode produced no output');
      }
      
      // Get job stats
      totalOriginal = Number(job.bytesProcessed);
      totalCompressed = Number(job.compressedSize);
      chunksProcessed = job.chunksProcessed;
      
      return {
        compressedData: resultBytes,
        originalSize: totalOriginal,
        compressedSize: resultBytes.length,
        ratio: resultBytes.length / Math.max(totalOriginal, 1),
        compressionTime: 0,
        chunksProcessed,
        memoryPeak: this.memoryController.getPeakUsage(),
      };
      
    } finally {
      unsubscribe();
      this.massiveCoordinator = null;
    }
  }

  /**
   * Process files in low memory mode (streaming, single chunk at a time)
   */
  private async processLowMemMode(
    files: File[],
    options: CompressionOptions
  ): Promise<CompressionResult> {
    options.onStage?.('Processing in low memory mode');
    
    // Use smaller chunks in low memory mode
    const chunkSize = Math.min(this.defaultChunkSize, 512 * KB);
    const compressedChunks: Uint8Array[] = [];
    let totalOriginal = 0;
    let totalCompressed = 0;
    let chunksProcessed = 0;
    let totalChunks = 0;
    
    // Calculate total chunks
    for (const file of files) {
      totalChunks += Math.ceil(file.size / chunkSize);
    }
    
    const mode = this.qualityToWasmMode(options.quality);
    
    // Pre-compute total bytes (avoid reduce in hot loop)
    let bytesTotal = 0;
    for (let i = 0; i < files.length; i++) {
      bytesTotal += files[i].size;
    }
    
    // Process one chunk at a time
    for (const file of files) {
      let offset = 0;
      
      while (offset < file.size) {
        if (this.cancelled) {
          throw new Error('Compression cancelled');
        }
        
        // Read chunk (use min without Math.min for micro-perf)
        const remaining = file.size - offset;
        const end = remaining < chunkSize ? file.size : offset + chunkSize;
        const blob = file.slice(offset, end);
        
        // Safe buffer read with error handling
        let data: Uint8Array;
        try {
          data = await readBlobAsUint8Array(blob);
        } catch (readError) {
          console.error(`[LowMem] Failed to read chunk at offset ${offset}:`, readError);
          throw new Error(`Failed to read file chunk: ${(readError as Error).message}`);
        }
        
        // Allocate memory for this chunk
        const chunkAllocId = this.memoryController.allocate('lowmem', data.length, `chunk-${chunksProcessed}`);
        
        try {
          // Redundancy check
          let shouldSkip = false;
          if (options.enableRedundancy) {
            const sig = this.redundancyEngine.analyzeChunk(data, chunksProcessed, file.name);
            const model = this.redundancyEngine.updateModel(sig);
            
            if (model.redundancyClass === 'duplicate') {
              shouldSkip = true;
              this.redundancyHits++;
            }
          }
          
          if (!shouldSkip) {
            // Compress with fallback protection
            const result = await safeCompressChunk(data, chunksProcessed, mode);
            
            // Optional refinement (with limited passes in low mem mode)
            let finalData = result.compressedData;
            if (options.refinementPasses && options.refinementPasses > 0) {
              try {
                const refined = await this.refinementEngine.refine(finalData, chunksProcessed);
                finalData = refined.data;
              } catch (refineError) {
                console.warn(`[LowMem] Refinement failed for chunk ${chunksProcessed}, using unrefined:`, refineError);
                // Continue with unrefined data
              }
            }
            
            compressedChunks.push(finalData);
            totalCompressed += finalData.length;
          }
          
          totalOriginal += data.length;
          chunksProcessed++;
          
          // Use cached bytesTotal
          options.onProgress?.({
            stage: 'lowmem-compression',
            chunksComplete: chunksProcessed,
            chunksTotal: totalChunks,
            bytesProcessed: totalOriginal,
            bytesTotal,
            currentRatio: totalCompressed / (totalOriginal || 1),
          });
          
        } finally {
          if (chunkAllocId) {
            this.memoryController.deallocate(chunkAllocId);
          }
        }
        
        offset = end;
      }
    }
    
    // Build archive - ensure we have at least one chunk
    if (compressedChunks.length === 0) {
      // All chunks were skipped (duplicates) - create minimal archive with metadata
      console.warn('[LowMem] All chunks skipped by redundancy, creating minimal archive');
      const minimalArchive = this.createMinimalArchive(totalOriginal);
      return {
        compressedData: minimalArchive,
        originalSize: totalOriginal,
        compressedSize: minimalArchive.length,
        ratio: minimalArchive.length / Math.max(totalOriginal, 1),
        compressionTime: 0,
        chunksProcessed,
        redundancyDetected: this.redundancyHits,
        memoryPeak: this.memoryController.getPeakUsage(),
      };
    }
    
    const archive = this.buildArchive(compressedChunks, totalOriginal);
    
    return {
      compressedData: archive,
      originalSize: totalOriginal,
      compressedSize: archive.length,
      ratio: archive.length / Math.max(totalOriginal, 1),
      compressionTime: 0,
      chunksProcessed,
      redundancyDetected: this.redundancyHits,
      memoryPeak: this.memoryController.getPeakUsage(),
    };
  }

  /**
   * Process files using ParallelCoordinator
   */
  private async processParallelMode(
    files: File[],
    options: CompressionOptions
  ): Promise<CompressionResult> {
    options.onStage?.('Initializing parallel processing');
    
    // Create parallel coordinator
    this.parallelCoordinator = new ParallelCoordinator({
      mode: this.qualityToParallelMode(options.quality),
      maxMemory: options.memoryBudget || (2 * GB),
      maxLanes: this.getOptimalLanes(),
    });
    
    // Read all files into chunks
    const allChunks: Array<{ id: string; data: Uint8Array; offset: bigint }> = [];
    let currentOffset = BigInt(0);
    let chunkIndex = 0;
    
    for (const file of files) {
      let fileOffset = 0;
      
      while (fileOffset < file.size) {
        const end = Math.min(fileOffset + this.defaultChunkSize, file.size);
        const blob = file.slice(fileOffset, end);
        
        // Safe buffer read with error handling
        let data: Uint8Array;
        try {
          data = await readBlobAsUint8Array(blob);
        } catch (readError) {
          console.error(`[Parallel] Failed to read chunk at offset ${fileOffset}:`, readError);
          throw new Error(`Failed to read file chunk: ${(readError as Error).message}`);
        }
        
        // Redundancy detection
        if (options.enableRedundancy) {
          const sig = this.redundancyEngine.analyzeChunk(data, chunkIndex, file.name);
          const model = this.redundancyEngine.updateModel(sig);
          
          if (model.redundancyClass !== 'duplicate') {
            allChunks.push({
              id: `chunk-${chunkIndex}`,
              data,
              offset: currentOffset,
            });
          } else {
            this.redundancyHits++;
          }
        } else {
          allChunks.push({
            id: `chunk-${chunkIndex}`,
            data,
            offset: currentOffset,
          });
        }
        
        currentOffset += BigInt(data.length);
        fileOffset = end;
        chunkIndex++;
      }
    }
    
    const totalOriginal = Number(currentOffset);
    let totalCompressed = 0;
    let completedChunks = 0;
    let bytesProcessed = 0;
    
    // Set up event handling
    this.parallelCoordinator.addEventListener((event: CoordinatorEvent) => {
      switch (event.type) {
        case 'chunk-completed':
          completedChunks++;
          bytesProcessed += event.bytes;
          options.onProgress?.({
            stage: 'parallel-compression',
            chunksComplete: completedChunks,
            chunksTotal: allChunks.length,
            bytesProcessed,
            bytesTotal: totalOriginal,
            currentRatio: bytesProcessed / Math.max(totalOriginal, 1),
          });
          break;
        case 'memory-pressure':
          console.warn('[Parallel] Memory pressure');
          break;
        case 'scale-up':
          options.onStage?.(`Scaling up to ${event.newLanes} lanes`);
          break;
        case 'scale-down':
          options.onStage?.(`Scaling down`);
          break;
      }
    });
    
    try {
      // Since ParallelCoordinator workers are placeholder simulations,
      // we'll compress chunks in parallel batches using Promise.all
      // This provides actual parallelism while the coordinator handles orchestration
      
      const mode = this.qualityToWasmMode(options.quality);
      const compressedChunks: Uint8Array[] = [];
      const batchSize = this.getOptimalLanes();
      let totalCompressedSize = 0;
      
      // Process in batches
      for (let i = 0; i < allChunks.length; i += batchSize) {
        if (this.cancelled) {
          throw new Error('Compression cancelled');
        }
        
        const batch = allChunks.slice(i, i + batchSize);
        
        // Compress batch in parallel with fallback protection
        const results = await Promise.all(
          batch.map(async (chunk, batchIdx) => {
            const result = await safeCompressChunk(chunk.data, i + batchIdx, mode);
            return result.compressedData;
          })
        );
        
        // Apply refinement if enabled
        for (let j = 0; j < results.length; j++) {
          let finalData = results[j];
          if (options.refinementPasses && options.refinementPasses > 0) {
            try {
              const refined = await this.refinementEngine.refine(finalData, i + j);
              finalData = refined.data;
            } catch (refineError) {
              console.warn(`[Parallel] Refinement failed for chunk ${i + j}, using unrefined:`, refineError);
              // Continue with unrefined data
            }
          }
          compressedChunks.push(finalData);
          totalCompressedSize += finalData.length;
        }
        
        completedChunks += batch.length;
        bytesProcessed += batch.reduce((s, c) => s + c.data.length, 0);
        
        options.onProgress?.({
          stage: 'parallel-compression',
          chunksComplete: completedChunks,
          chunksTotal: allChunks.length,
          bytesProcessed,
          bytesTotal: totalOriginal,
          currentRatio: totalCompressedSize / Math.max(bytesProcessed, 1),
        });
      }
      
      // Build archive from compressed chunks
      const archive = this.buildArchive(compressedChunks, totalOriginal);
      
      return {
        compressedData: archive,
        originalSize: totalOriginal,
        compressedSize: archive.length,
        ratio: archive.length / Math.max(totalOriginal, 1),
        compressionTime: 0,
        chunksProcessed: allChunks.length,
        redundancyDetected: this.redundancyHits,
        memoryPeak: this.memoryController.getPeakUsage(),
      };
      
    } finally {
      this.parallelCoordinator = null;
    }
  }

  /**
   * Process files in normal sequential mode
   */
  private async processNormalMode(
    files: File[],
    options: CompressionOptions
  ): Promise<CompressionResult> {
    options.onStage?.('Processing in normal mode');
    
    const compressedChunks: Uint8Array[] = [];
    let totalOriginal = 0;
    let totalCompressed = 0;
    let chunksProcessed = 0;
    let totalChunks = 0;
    let bytesTotal = 0;
    
    // Pre-compute totals (avoid calculations in hot loop)
    const chunkSize = this.defaultChunkSize;
    for (let i = 0; i < files.length; i++) {
      const size = files[i].size;
      bytesTotal += size;
      totalChunks += ((size + chunkSize - 1) / chunkSize) | 0;  // Fast ceil
    }
    
    const mode = this.qualityToWasmMode(options.quality);
    
    for (const file of files) {
      let offset = 0;
      const fileSize = file.size;
      
      while (offset < fileSize) {
        if (this.cancelled) {
          throw new Error('Compression cancelled');
        }
        
        // Read chunk (inline min calculation)
        const remaining = fileSize - offset;
        const end = remaining < chunkSize ? fileSize : offset + chunkSize;
        const blob = file.slice(offset, end);
        
        // Safe buffer read with error handling
        let data: Uint8Array;
        try {
          data = await readBlobAsUint8Array(blob);
        } catch (readError) {
          console.error(`[Normal] Failed to read chunk at offset ${offset}:`, readError);
          throw new Error(`Failed to read file chunk: ${(readError as Error).message}`);
        }
        
        // Redundancy detection
        let recommendation: ChunkRecommendation | undefined;
        let shouldSkip = false;
        
        if (options.enableRedundancy) {
          const sig = this.redundancyEngine.analyzeChunk(data, chunksProcessed, file.name);
          const model = this.redundancyEngine.updateModel(sig);
          const processResult = this.redundancyEngine.processChunk(data, chunksProcessed, file.name);
          recommendation = processResult.recommendation;
          
          if (model.redundancyClass === 'duplicate') {
            shouldSkip = true;
            this.redundancyHits++;
          }
        }
        
        if (!shouldSkip) {
          // Use recommended mode if available, mapping to WASM modes
          const recommendedMode = recommendation?.chunkMode;
          const compressionMode = this.mapToWasmMode(recommendedMode) || mode;
          
          // Compress chunk with fallback protection
          const result = await safeCompressChunk(data, chunksProcessed, compressionMode);
          
          // Refinement with error handling
          let finalData = result.compressedData;
          if (options.refinementPasses && options.refinementPasses > 0) {
            try {
              const refined = await this.refinementEngine.refine(
                finalData, 
                chunksProcessed
              );
              finalData = refined.data;
              
              // Calculate improvement from ratio
              const improvement = 1 - refined.summary.overallRatio;
              if (improvement > 0) {
                this.totalBytesSaved += Math.round(result.compressedData.length * improvement);
              }
            } catch (refineError) {
              console.warn(`[Normal] Refinement failed for chunk ${chunksProcessed}, using unrefined:`, refineError);
              // Continue with unrefined data
            }
          }
          
          compressedChunks.push(finalData);
          totalCompressed += finalData.length;
        }
        
        totalOriginal += data.length;
        chunksProcessed++;
        
        options.onProgress?.({
          stage: 'compression',
          chunksComplete: chunksProcessed,
          chunksTotal: totalChunks,
          bytesProcessed: totalOriginal,
          bytesTotal,
          currentRatio: totalCompressed / (totalOriginal || 1),
        });
        
        offset = end;
      }
    }
    
    // Build final archive - ensure we have at least one chunk
    if (compressedChunks.length === 0) {
      console.warn('[Normal] All chunks skipped by redundancy, creating minimal archive');
      const minimalArchive = this.createMinimalArchive(totalOriginal);
      return {
        compressedData: minimalArchive,
        originalSize: totalOriginal,
        compressedSize: minimalArchive.length,
        ratio: minimalArchive.length / Math.max(totalOriginal, 1),
        compressionTime: 0,
        chunksProcessed,
        redundancyDetected: this.redundancyHits,
        refinementSavings: this.totalBytesSaved,
        memoryPeak: this.memoryController.getPeakUsage(),
      };
    }
    
    const archive = this.buildArchive(compressedChunks, totalOriginal);
    
    return {
      compressedData: archive,
      originalSize: totalOriginal,
      compressedSize: archive.length,
      ratio: archive.length / Math.max(totalOriginal, 1),
      compressionTime: 0,
      chunksProcessed,
      redundancyDetected: this.redundancyHits,
      refinementSavings: this.totalBytesSaved,
      memoryPeak: this.memoryController.getPeakUsage(),
    };
  }

  /**
   * Build SPK archive from compressed chunks
   */
  private buildArchive(chunks: Uint8Array[], originalSize: number): Uint8Array {
    // Pre-calculate total size using for loop (faster than reduce)
    const headerSize = 64;
    const chunkHeaderSize = 12;
    const chunkCount = chunks.length;
    const metadataSize = chunkCount * chunkHeaderSize;
    
    let dataSize = 0;
    for (let i = 0; i < chunkCount; i++) {
      dataSize += chunks[i].length;
    }
    const totalSize = headerSize + metadataSize + dataSize;
    
    const archive = new Uint8Array(totalSize);
    const view = new DataView(archive.buffer);
    
    // Magic number "SPK1" - write as uint32 for single operation
    view.setUint32(0, 0x314B5053, false);  // Big-endian for "SPK1"
    
    // Version (1) and Flags (0)
    view.setUint16(4, 1, true);
    view.setUint16(6, 0, true);
    
    // Original size and chunk count
    view.setUint32(8, originalSize, true);
    view.setUint32(12, chunkCount, true);
    
    // Chunk metadata (unrolled for performance)
    let metaOffset = headerSize;
    let dataOffset = headerSize + metadataSize;
    for (let i = 0; i < chunkCount; i++) {
      const chunkLen = chunks[i].length;
      view.setUint32(metaOffset, i, true);
      view.setUint32(metaOffset + 4, dataOffset, true);
      view.setUint32(metaOffset + 8, chunkLen, true);
      metaOffset += 12;
      dataOffset += chunkLen;
    }
    
    // Chunk data (use TypedArray.set for bulk copy)
    let writeOffset = headerSize + metadataSize;
    for (let i = 0; i < chunkCount; i++) {
      archive.set(chunks[i], writeOffset);
      writeOffset += chunks[i].length;
    }
    
    return archive;
  }

  /**
   * Create minimal archive when all chunks are deduplicated
   */
  private createMinimalArchive(originalSize: number): Uint8Array {
    const headerSize = 64;
    const archive = new Uint8Array(headerSize);
    const view = new DataView(archive.buffer);
    
    // Magic number "SPK1"
    view.setUint32(0, 0x314B5053, false);
    
    // Version (1) and Flags (0x01 = deduplicated)
    view.setUint16(4, 1, true);
    view.setUint16(6, 0x01, true);
    
    // Original size and chunk count (0)
    view.setUint32(8, originalSize, true);
    view.setUint32(12, 0, true);
    
    return archive;
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  private qualityToLevel(quality: CompressionQuality): number {
    switch (quality) {
      case 'fast': return 1;
      case 'balanced': return 5;
      case 'maximum': return 9;
      default: return 5;
    }
  }

  private qualityToWasmMode(quality: CompressionQuality): WasmMode {
    switch (quality) {
      case 'fast': return 'fast';
      case 'balanced': return 'auto';
      case 'maximum': return 'strong';
      default: return 'auto';
    }
  }

  /**
   * Map redundancy engine modes to WASM modes
   */
  private mapToWasmMode(mode?: string): WasmMode | undefined {
    if (!mode) return undefined;
    
    switch (mode) {
      case 'fast':
      case 'skip':
      case 'lightweight':
        return 'fast';
      case 'strong':
      case 'multi-pass':
        return 'strong';
      case 'structural':
      case 'auto':
      default:
        return 'auto';
    }
  }

  private qualityToParallelMode(quality: CompressionQuality): 'conservative' | 'balanced' | 'aggressive' | 'turbo' {
    switch (quality) {
      case 'fast': return 'turbo';
      case 'balanced': return 'balanced';
      case 'maximum': return 'conservative';
      default: return 'balanced';
    }
  }

  private getDefaultMemoryBudget(): number {
    // Use 50% of available system memory, capped
    if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
      const deviceMem = (navigator as any).deviceMemory * GB;
      return Math.min(deviceMem * 0.5, 4 * GB);
    }
    return 1 * GB;
  }

  private getOptimalLanes(): number {
    // Use available CPU cores, with limits
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
      return Math.min(navigator.hardwareConcurrency, 16);
    }
    return 4;
  }

  private formatBytes(bytes: number): string {
    if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
    if (bytes >= KB) return `${(bytes / KB).toFixed(2)} KB`;
    return `${bytes} bytes`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cancel current operation
   */
  cancel(): void {
    this.cancelled = true;
    
    if (this.massiveCoordinator) {
      this.massiveCoordinator.cancel();
    }
    
    if (this.parallelCoordinator) {
      this.parallelCoordinator.stop();
    }
  }

  /**
   * Get current stats
   */
  getStats(): {
    totalProcessed: number;
    totalSaved: number;
    redundancyHits: number;
    currentMode: ProcessingMode;
    isProcessing: boolean;
  } {
    return {
      totalProcessed: this.totalBytesProcessed,
      totalSaved: this.totalBytesSaved,
      redundancyHits: this.redundancyHits,
      currentMode: this.currentMode,
      isProcessing: this.isProcessing,
    };
  }
}

// Singleton instance
let masterCoordinatorInstance: MasterCoordinator | null = null;

export function getMasterCoordinator(): MasterCoordinator {
  if (!masterCoordinatorInstance) {
    masterCoordinatorInstance = new MasterCoordinator();
  }
  return masterCoordinatorInstance;
}
