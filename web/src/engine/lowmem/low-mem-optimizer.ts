/**
 * SPK Hyper-Low-Memory Mode - Low-RAM AI Optimizer
 * Creator: OJ Treasure Onazi
 * 
 * Section 7: Low-RAM AI Optimizer Ruleset
 * - Simple heuristics for chunk/worker decisions
 * - No ML models (too memory heavy)
 * - Fast lookup tables for decisions
 * - Memory-aware recommendations
 */

import {
  KB, MB, GB,
  type ChunkMode,
  CHUNK_SIZES,
  type LowMemAIConfig,
  type AIRecommendation,
  DEFAULT_LOW_MEM_AI_CONFIG,
  type WorkerProfile,
  type WorkerProfileName,
  WORKER_PROFILES,
  type LowMemEvent,
  type LowMemEventHandler,
} from './types';
import { getMemoryBudgetController } from './memory-budget';

// ============================================================================
// AI OPTIMIZER TYPES
// ============================================================================

export interface FileAnalysis {
  fileType: string;
  size: number;
  entropy: number;
  compressible: boolean;
  recommendedChunkMode: ChunkMode;
  recommendedAlgorithm: string;
}

export interface OptimizationContext {
  fileCount: number;
  totalSize: number;
  avgFileSize: number;
  memoryAvailable: number;
  memoryPressure: string;
  currentChunkMode: ChunkMode;
  currentWorkerCount: number;
}

export interface OptimizationResult {
  chunkMode: ChunkMode;
  workerProfile: WorkerProfileName;
  algorithm: string;
  concurrency: number;
  estimatedTime: number;
  estimatedMemory: number;
  confidence: number;
  reasoning: string[];
}

// ============================================================================
// LOOKUP TABLES
// ============================================================================

/**
 * File extension to compression algorithm mapping
 */
const EXTENSION_ALGORITHM_MAP: Record<string, string> = {
  // Already compressed
  '.zip': 'store',
  '.gz': 'store',
  '.bz2': 'store',
  '.xz': 'store',
  '.7z': 'store',
  '.rar': 'store',
  '.jpg': 'store',
  '.jpeg': 'store',
  '.png': 'store',
  '.gif': 'store',
  '.webp': 'store',
  '.mp3': 'store',
  '.mp4': 'store',
  '.mkv': 'store',
  '.avi': 'store',
  '.mov': 'store',
  '.webm': 'store',
  '.flac': 'store',
  '.aac': 'store',
  
  // Highly compressible text
  '.txt': 'zstd',
  '.log': 'zstd',
  '.json': 'zstd',
  '.xml': 'zstd',
  '.html': 'zstd',
  '.css': 'zstd',
  '.js': 'zstd',
  '.ts': 'zstd',
  '.md': 'zstd',
  '.csv': 'zstd',
  '.sql': 'zstd',
  '.yaml': 'zstd',
  '.yml': 'zstd',
  
  // Binary but compressible
  '.exe': 'lz4',
  '.dll': 'lz4',
  '.so': 'lz4',
  '.pdf': 'lz4',
  '.doc': 'lz4',
  '.docx': 'lz4',
  '.ppt': 'lz4',
  '.pptx': 'lz4',
  '.xls': 'lz4',
  '.xlsx': 'lz4',
  
  // Default
  '*': 'zstd',
};

/**
 * File size to chunk mode mapping
 */
const SIZE_CHUNK_MAP: Array<{ maxSize: number; mode: ChunkMode }> = [
  { maxSize: 256 * KB, mode: 'nano' },
  { maxSize: 1 * MB, mode: 'micro' },
  { maxSize: 10 * MB, mode: 'small' },
  { maxSize: 100 * MB, mode: 'normal' },
  { maxSize: Infinity, mode: 'large' },
];

/**
 * Memory pressure to concurrency mapping
 */
const PRESSURE_CONCURRENCY_MAP: Record<string, number> = {
  low: 4,
  medium: 3,
  high: 2,
  critical: 1,
  emergency: 1,
};

// ============================================================================
// LOW-RAM AI OPTIMIZER
// ============================================================================

export class LowRAMAIOptimizer {
  private config: LowMemAIConfig;
  private memoryController = getMemoryBudgetController();
  private eventHandlers: LowMemEventHandler[] = [];
  
  // Simple decision cache
  private decisionCache = new Map<string, OptimizationResult>();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config?: Partial<LowMemAIConfig>) {
    this.config = { ...DEFAULT_LOW_MEM_AI_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Analyze a file and recommend settings
   */
  analyzeFile(
    file: File | { name: string; size: number; type?: string }
  ): FileAnalysis {
    const ext = this.getExtension(file.name);
    const algorithm = EXTENSION_ALGORITHM_MAP[ext] ?? EXTENSION_ALGORITHM_MAP['*'];
    const compressible = algorithm !== 'store';
    
    // Estimate entropy based on file type
    const entropy = compressible ? 0.5 : 0.9;
    
    // Recommend chunk mode based on size
    const chunkMode = this.recommendChunkModeForSize(file.size);
    
    return {
      fileType: ext || 'unknown',
      size: file.size,
      entropy,
      compressible,
      recommendedChunkMode: chunkMode,
      recommendedAlgorithm: algorithm,
    };
  }

  /**
   * Get optimized settings for compression job
   */
  optimize(context: OptimizationContext): OptimizationResult {
    // Check cache
    const cacheKey = this.getCacheKey(context);
    const cached = this.decisionCache.get(cacheKey);
    if (cached) {
      this.cacheHits++;
      return cached;
    }
    this.cacheMisses++;
    
    const reasoning: string[] = [];
    
    // Determine chunk mode
    const chunkMode = this.selectChunkMode(context, reasoning);
    
    // Determine worker profile
    const workerProfile = this.selectWorkerProfile(context, reasoning);
    
    // Determine algorithm
    const algorithm = this.selectAlgorithm(context, reasoning);
    
    // Determine concurrency
    const concurrency = this.selectConcurrency(context, reasoning);
    
    // Estimate time and memory
    const estimates = this.estimateResources(context, chunkMode, workerProfile, concurrency);
    
    const result: OptimizationResult = {
      chunkMode,
      workerProfile,
      algorithm,
      concurrency,
      estimatedTime: estimates.time,
      estimatedMemory: estimates.memory,
      confidence: this.calculateConfidence(context),
      reasoning,
    };
    
    // Cache result
    if (this.decisionCache.size < this.config.maxCacheSize) {
      this.decisionCache.set(cacheKey, result);
    }
    
    this.emit({ type: 'optimization-complete', result });
    
    return result;
  }

  /**
   * Get quick recommendation (no full analysis)
   */
  quickRecommend(
    fileSize: number,
    memoryAvailable: number
  ): AIRecommendation {
    const chunkMode = this.recommendChunkModeForMemory(fileSize, memoryAvailable);
    const workerCount = this.recommendWorkerCount(memoryAvailable);
    
    return {
      chunkMode,
      workerCount,
      algorithm: 'zstd',
      flushInterval: this.recommendFlushInterval(memoryAvailable),
    };
  }

  // ---------------------------------------------------------------------------
  // SELECTION LOGIC
  // ---------------------------------------------------------------------------

  /**
   * Select optimal chunk mode
   */
  private selectChunkMode(
    context: OptimizationContext,
    reasoning: string[]
  ): ChunkMode {
    // Start with size-based recommendation
    let mode = this.recommendChunkModeForSize(context.avgFileSize);
    
    // Adjust for memory pressure
    if (context.memoryPressure === 'critical' || context.memoryPressure === 'emergency') {
      mode = 'nano';
      reasoning.push('Using nano chunks due to critical memory pressure');
    } else if (context.memoryPressure === 'high') {
      mode = 'micro';
      reasoning.push('Reduced to micro chunks due to high memory pressure');
    } else if (context.memoryAvailable < 100 * MB) {
      mode = 'micro';
      reasoning.push('Using micro chunks due to low available memory');
    } else {
      reasoning.push(`Selected ${mode} chunks based on average file size`);
    }
    
    return mode;
  }

  /**
   * Select optimal worker profile
   */
  private selectWorkerProfile(
    context: OptimizationContext,
    reasoning: string[]
  ): WorkerProfileName {
    const available = context.memoryAvailable;
    
    if (available < 200 * MB || context.memoryPressure === 'critical') {
      reasoning.push('Using ultra-low worker profile due to memory constraints');
      return 'ultra_low';
    }
    
    if (available < 400 * MB || context.memoryPressure === 'high') {
      reasoning.push('Using low worker profile');
      return 'low';
    }
    
    if (available < 800 * MB) {
      reasoning.push('Using normal worker profile');
      return 'normal';
    }
    
    reasoning.push('Using high worker profile - sufficient memory available');
    return 'high';
  }

  /**
   * Select compression algorithm
   */
  private selectAlgorithm(
    context: OptimizationContext,
    reasoning: string[]
  ): string {
    // In low memory mode, prefer faster algorithms
    if (context.memoryPressure === 'critical' || context.memoryPressure === 'emergency') {
      reasoning.push('Using LZ4 for speed under memory pressure');
      return 'lz4';
    }
    
    // Default to zstd for good balance
    reasoning.push('Using zstd for balanced compression');
    return 'zstd';
  }

  /**
   * Select concurrency level
   */
  private selectConcurrency(
    context: OptimizationContext,
    reasoning: string[]
  ): number {
    const baseConcurrency = PRESSURE_CONCURRENCY_MAP[context.memoryPressure] ?? 2;
    
    // Adjust for file count
    const fileAdjusted = Math.min(baseConcurrency, Math.ceil(context.fileCount / 10));
    
    // Never exceed current worker count
    const final = Math.min(fileAdjusted, context.currentWorkerCount);
    
    reasoning.push(`Concurrency set to ${final} based on pressure and file count`);
    
    return Math.max(1, final);
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Recommend chunk mode for file size
   */
  private recommendChunkModeForSize(size: number): ChunkMode {
    for (const entry of SIZE_CHUNK_MAP) {
      if (size <= entry.maxSize) return entry.mode;
    }
    return 'large';
  }

  /**
   * Recommend chunk mode for available memory
   */
  private recommendChunkModeForMemory(
    fileSize: number,
    memoryAvailable: number
  ): ChunkMode {
    // Target: 4 chunks in memory at once
    const targetChunkSize = Math.floor(memoryAvailable / 4);
    
    if (targetChunkSize >= CHUNK_SIZES.large) return 'large';
    if (targetChunkSize >= CHUNK_SIZES.normal) return 'normal';
    if (targetChunkSize >= CHUNK_SIZES.small) return 'small';
    if (targetChunkSize >= CHUNK_SIZES.micro) return 'micro';
    return 'nano';
  }

  /**
   * Recommend worker count
   */
  private recommendWorkerCount(memoryAvailable: number): number {
    // Each worker needs ~100MB
    const maxWorkers = Math.floor(memoryAvailable / (100 * MB));
    return Math.max(1, Math.min(maxWorkers, 4));
  }

  /**
   * Recommend flush interval
   */
  private recommendFlushInterval(memoryAvailable: number): number {
    if (memoryAvailable < 200 * MB) return 1000;
    if (memoryAvailable < 500 * MB) return 2000;
    return 5000;
  }

  /**
   * Estimate resource usage
   */
  private estimateResources(
    context: OptimizationContext,
    chunkMode: ChunkMode,
    workerProfile: WorkerProfileName,
    concurrency: number
  ): { time: number; memory: number } {
    const chunkSize = CHUNK_SIZES[chunkMode];
    const profile = WORKER_PROFILES[workerProfile];
    
    // Estimate time (MB/s throughput based on mode)
    const throughputMBps = chunkMode === 'nano' ? 10 : chunkMode === 'micro' ? 20 : 50;
    const time = (context.totalSize / MB) / throughputMBps / concurrency;
    
    // Estimate memory
    const chunkMemory = chunkSize * concurrency * 2; // Input + output
    const workerMemory = profile.memoryLimit * profile.workerCount;
    const memory = chunkMemory + workerMemory + 20 * MB; // 20MB overhead
    
    return { time, memory };
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(context: OptimizationContext): number {
    // Higher confidence with more information
    let confidence = 0.5;
    
    if (context.fileCount > 0) confidence += 0.1;
    if (context.totalSize > 0) confidence += 0.1;
    if (context.memoryAvailable > 100 * MB) confidence += 0.1;
    if (context.memoryPressure !== 'critical') confidence += 0.1;
    
    return Math.min(1, confidence);
  }

  /**
   * Get cache key for context
   */
  private getCacheKey(context: OptimizationContext): string {
    return `${context.memoryPressure}_${Math.floor(context.avgFileSize / MB)}_${context.fileCount}`;
  }

  /**
   * Get file extension
   */
  private getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  }

  // ---------------------------------------------------------------------------
  // CACHE MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Clear decision cache
   */
  clearCache(): void {
    this.decisionCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.decisionCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  on(handler: LowMemEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private emit(event: LowMemEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[LowRAMAIOptimizer] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get recommended algorithm for file
 */
export function getAlgorithmForFile(filename: string): string {
  const ext = filename.lastIndexOf('.') >= 0
    ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
    : '';
  return EXTENSION_ALGORITHM_MAP[ext] ?? EXTENSION_ALGORITHM_MAP['*'];
}

/**
 * Check if file type is already compressed
 */
export function isCompressedFileType(filename: string): boolean {
  return getAlgorithmForFile(filename) === 'store';
}

/**
 * Get compression level for memory budget
 */
export function getCompressionLevel(
  memoryBudget: number,
  algorithm: string
): number {
  // Lower memory = lower compression level
  if (memoryBudget < 200 * MB) {
    return algorithm === 'zstd' ? 1 : 1;
  }
  if (memoryBudget < 500 * MB) {
    return algorithm === 'zstd' ? 3 : 5;
  }
  return algorithm === 'zstd' ? 6 : 9;
}

// ============================================================================
// SINGLETON
// ============================================================================

let optimizerInstance: LowRAMAIOptimizer | null = null;

export function getLowRAMAIOptimizer(
  config?: Partial<LowMemAIConfig>
): LowRAMAIOptimizer {
  if (!optimizerInstance) {
    optimizerInstance = new LowRAMAIOptimizer(config);
  }
  return optimizerInstance;
}

export function resetLowRAMAIOptimizer(): void {
  optimizerInstance?.clearCache();
  optimizerInstance = null;
}
