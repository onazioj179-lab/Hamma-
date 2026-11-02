/**
 * SPK Hyper-Low-Memory Mode - Ultra Micro-Chunk Pipeline
 * Creator: OJ Treasure Onazi
 * 
 * Section 2: Ultra Micro-Chunk Pipeline
 * - Dynamic chunk sizing based on memory pressure
 * - Supports nano(64KB), micro(128KB), small(256KB), normal(1MB), large(4MB)
 * - Automatic downgrade under pressure
 */

import {
  KB, MB,
  type ChunkMode,
  CHUNK_SIZES,
  type MemoryPressureLevel,
  type LowMemEvent,
  type LowMemEventHandler,
} from './types';
import { getMemoryBudgetController } from './memory-budget';

// ============================================================================
// MICRO-CHUNK TYPES
// ============================================================================

export interface ChunkMetrics {
  totalChunks: number;
  processedChunks: number;
  failedChunks: number;
  avgProcessingTime: number;
  throughputBytesPerSec: number;
  currentMode: ChunkMode;
  modeSwitchCount: number;
}

export interface ChunkResult {
  chunkId: string;
  data: Uint8Array;
  offset: number;
  size: number;
  mode: ChunkMode;
  processingTime: number;
  compressed?: boolean;
  compressedSize?: number;
}

export interface ChunkRequest {
  fileId: string;
  offset: number;
  size: number;
  priority: 'high' | 'normal' | 'low';
  deadline?: number;
}

// ============================================================================
// CHUNK MODE CONTROLLER
// ============================================================================

export class ChunkModeController {
  private currentMode: ChunkMode = 'small';
  private baseMode: ChunkMode = 'small';
  private modeHistory: { mode: ChunkMode; timestamp: number; reason: string }[] = [];
  private lockMode = false;
  private eventHandlers: LowMemEventHandler[] = [];
  
  // Pressure thresholds for mode switching
  private readonly MODE_THRESHOLDS: Record<MemoryPressureLevel, ChunkMode> = {
    low: 'normal',
    medium: 'small',
    high: 'micro',
    critical: 'nano',
    emergency: 'nano',
  };

  constructor(initialMode: ChunkMode = 'small') {
    this.currentMode = initialMode;
    this.baseMode = initialMode;
  }

  /**
   * Get current chunk mode
   */
  getMode(): ChunkMode {
    return this.currentMode;
  }

  /**
   * Get current chunk size in bytes
   */
  getChunkSize(): number {
    return CHUNK_SIZES[this.currentMode];
  }

  /**
   * Set base mode (target when pressure is low)
   */
  setBaseMode(mode: ChunkMode): void {
    this.baseMode = mode;
    if (!this.lockMode) {
      this.updateModeForPressure('low');
    }
  }

  /**
   * Lock current mode (prevent automatic changes)
   */
  lock(): void {
    this.lockMode = true;
  }

  /**
   * Unlock mode (allow automatic changes)
   */
  unlock(): void {
    this.lockMode = false;
  }

  /**
   * Update mode based on memory pressure
   */
  updateModeForPressure(pressure: MemoryPressureLevel): ChunkMode {
    if (this.lockMode) return this.currentMode;
    
    const targetMode = this.MODE_THRESHOLDS[pressure];
    
    // Only downgrade, never upgrade automatically during operation
    if (this.compareMode(targetMode, this.currentMode) < 0) {
      this.setMode(targetMode, `pressure-${pressure}`);
    }
    
    return this.currentMode;
  }

  /**
   * Force mode change
   */
  setMode(mode: ChunkMode, reason: string = 'manual'): void {
    if (mode !== this.currentMode) {
      const oldMode = this.currentMode;
      this.currentMode = mode;
      
      this.modeHistory.push({
        mode,
        timestamp: Date.now(),
        reason,
      });
      
      // Trim history
      if (this.modeHistory.length > 50) {
        this.modeHistory.shift();
      }
      
      this.emit({
        type: 'chunk-mode-change',
        from: oldMode,
        to: mode,
        reason,
      });
    }
  }

  /**
   * Reset to base mode
   */
  reset(): void {
    this.setMode(this.baseMode, 'reset');
  }

  /**
   * Compare modes (-1 = a is smaller, 0 = equal, 1 = a is larger)
   */
  private compareMode(a: ChunkMode, b: ChunkMode): number {
    const sizeA = CHUNK_SIZES[a];
    const sizeB = CHUNK_SIZES[b];
    if (sizeA < sizeB) return -1;
    if (sizeA > sizeB) return 1;
    return 0;
  }

  /**
   * Get mode history
   */
  getHistory(): { mode: ChunkMode; timestamp: number; reason: string }[] {
    return [...this.modeHistory];
  }

  /**
   * Event handling
   */
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
        console.error('[ChunkModeController] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// MICRO-CHUNK PIPELINE
// ============================================================================

export class MicroChunkPipeline {
  private controller: ChunkModeController;
  private memoryController = getMemoryBudgetController();
  private metrics: ChunkMetrics;
  private activeChunks = new Map<string, ChunkRequest>();
  private pendingQueue: ChunkRequest[] = [];
  private maxConcurrent: number;
  private processingTimes: number[] = [];
  private eventHandlers: LowMemEventHandler[] = [];
  
  constructor(maxConcurrent: number = 4) {
    this.controller = new ChunkModeController('small');
    this.maxConcurrent = maxConcurrent;
    this.metrics = this.createEmptyMetrics();
    
    // Listen to memory pressure changes
    this.memoryController.on((event) => {
      if (event.type === 'pressure-change') {
        this.controller.updateModeForPressure(event.to as MemoryPressureLevel);
        this.adjustConcurrency();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Create chunks from file data
   */
  *createChunks(
    data: Uint8Array,
    fileId: string,
    startOffset: number = 0
  ): Generator<ChunkResult> {
    let offset = 0;
    let chunkIndex = 0;
    
    while (offset < data.length) {
      // Get current chunk size based on pressure
      const chunkSize = this.getAdaptiveChunkSize();
      const end = Math.min(offset + chunkSize, data.length);
      
      const startTime = performance.now();
      
      // Create chunk view (zero-copy when possible)
      const chunkData = data.subarray(offset, end);
      
      const processingTime = performance.now() - startTime;
      this.recordProcessingTime(processingTime);
      
      const result: ChunkResult = {
        chunkId: `${fileId}_chunk_${chunkIndex}`,
        data: chunkData,
        offset: startOffset + offset,
        size: end - offset,
        mode: this.controller.getMode(),
        processingTime,
      };
      
      this.metrics.totalChunks++;
      chunkIndex++;
      offset = end;
      
      yield result;
    }
  }

  /**
   * Get adaptive chunk size based on current pressure
   */
  getAdaptiveChunkSize(): number {
    const pressure = this.memoryController.getPressureLevel();
    this.controller.updateModeForPressure(pressure);
    return this.controller.getChunkSize();
  }

  /**
   * Queue a chunk request
   */
  queueChunk(request: ChunkRequest): void {
    if (this.activeChunks.size < this.maxConcurrent) {
      this.processChunk(request);
    } else {
      // Insert based on priority
      const insertIndex = this.findInsertIndex(request);
      this.pendingQueue.splice(insertIndex, 0, request);
    }
  }

  /**
   * Process chunk request
   */
  private async processChunk(request: ChunkRequest): Promise<void> {
    const chunkId = `${request.fileId}_${request.offset}`;
    this.activeChunks.set(chunkId, request);
    
    // Allocate memory for chunk
    const result = this.memoryController.allocate({
      id: `chunk_${chunkId}`,
      bytes: request.size,
      purpose: 'chunk',
      priority: request.priority === 'high' ? 'critical' : 'normal',
    });
    
    if (!result.success) {
      // Reduce chunk size and retry
      if (request.size > CHUNK_SIZES.nano) {
        const smallerSize = this.getSmallerSize(request.size);
        this.queueChunk({ ...request, size: smallerSize });
      } else {
        this.metrics.failedChunks++;
        this.emit({ type: 'chunk-failed', chunkId, reason: 'memory-limit' });
      }
      this.activeChunks.delete(chunkId);
      return;
    }
    
    // Simulate chunk processing (actual implementation would process data)
    this.metrics.processedChunks++;
    this.activeChunks.delete(chunkId);
    
    // Release memory
    this.memoryController.release(`chunk_${chunkId}`);
    
    // Process next in queue
    this.processNextInQueue();
  }

  /**
   * Process next chunk from queue
   */
  private processNextInQueue(): void {
    if (this.pendingQueue.length > 0 && this.activeChunks.size < this.maxConcurrent) {
      const next = this.pendingQueue.shift()!;
      this.processChunk(next);
    }
  }

  /**
   * Find insert index based on priority
   */
  private findInsertIndex(request: ChunkRequest): number {
    const priority = request.priority;
    
    for (let i = 0; i < this.pendingQueue.length; i++) {
      const existing = this.pendingQueue[i];
      if (priority === 'high' && existing.priority !== 'high') return i;
      if (priority === 'normal' && existing.priority === 'low') return i;
    }
    
    return this.pendingQueue.length;
  }

  /**
   * Get smaller chunk size
   */
  private getSmallerSize(currentSize: number): number {
    if (currentSize > CHUNK_SIZES.large) return CHUNK_SIZES.large;
    if (currentSize > CHUNK_SIZES.normal) return CHUNK_SIZES.normal;
    if (currentSize > CHUNK_SIZES.small) return CHUNK_SIZES.small;
    if (currentSize > CHUNK_SIZES.micro) return CHUNK_SIZES.micro;
    return CHUNK_SIZES.nano;
  }

  /**
   * Adjust concurrency based on pressure
   */
  private adjustConcurrency(): void {
    const pressure = this.memoryController.getPressureLevel();
    
    switch (pressure) {
      case 'emergency':
        this.maxConcurrent = 1;
        break;
      case 'critical':
        this.maxConcurrent = 1;
        break;
      case 'high':
        this.maxConcurrent = 2;
        break;
      case 'medium':
        this.maxConcurrent = 3;
        break;
      default:
        this.maxConcurrent = 4;
    }
    
    this.emit({ type: 'concurrency-change', maxConcurrent: this.maxConcurrent });
  }

  // ---------------------------------------------------------------------------
  // METRICS
  // ---------------------------------------------------------------------------

  /**
   * Record processing time
   */
  private recordProcessingTime(time: number): void {
    this.processingTimes.push(time);
    
    // Keep last 100 samples
    if (this.processingTimes.length > 100) {
      this.processingTimes.shift();
    }
    
    // Update average
    const sum = this.processingTimes.reduce((a, b) => a + b, 0);
    this.metrics.avgProcessingTime = sum / this.processingTimes.length;
  }

  /**
   * Get current metrics
   */
  getMetrics(): ChunkMetrics {
    return {
      ...this.metrics,
      currentMode: this.controller.getMode(),
      modeSwitchCount: this.controller.getHistory().length,
    };
  }

  /**
   * Create empty metrics
   */
  private createEmptyMetrics(): ChunkMetrics {
    return {
      totalChunks: 0,
      processedChunks: 0,
      failedChunks: 0,
      avgProcessingTime: 0,
      throughputBytesPerSec: 0,
      currentMode: 'small',
      modeSwitchCount: 0,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.createEmptyMetrics();
    this.processingTimes = [];
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Get chunk mode controller
   */
  getModeController(): ChunkModeController {
    return this.controller;
  }

  /**
   * Get current mode
   */
  getCurrentMode(): ChunkMode {
    return this.controller.getMode();
  }

  /**
   * Get current chunk size
   */
  getCurrentChunkSize(): number {
    return this.controller.getChunkSize();
  }

  /**
   * Get active chunk count
   */
  getActiveCount(): number {
    return this.activeChunks.size;
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.pendingQueue.length;
  }

  /**
   * Clear pending queue
   */
  clearQueue(): void {
    this.pendingQueue = [];
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
        console.error('[MicroChunkPipeline] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate optimal chunk count for file
 */
export function calculateChunkCount(
  fileSize: number,
  mode: ChunkMode = 'small'
): number {
  const chunkSize = CHUNK_SIZES[mode];
  return Math.ceil(fileSize / chunkSize);
}

/**
 * Recommend chunk mode for file size and available memory
 */
export function recommendChunkMode(
  fileSize: number,
  availableMemory: number
): ChunkMode {
  // Target: at least 4 chunks in memory at once
  const targetChunksInMemory = 4;
  const maxChunkSize = Math.floor(availableMemory / targetChunksInMemory);
  
  if (maxChunkSize >= CHUNK_SIZES.large) return 'large';
  if (maxChunkSize >= CHUNK_SIZES.normal) return 'normal';
  if (maxChunkSize >= CHUNK_SIZES.small) return 'small';
  if (maxChunkSize >= CHUNK_SIZES.micro) return 'micro';
  return 'nano';
}

/**
 * Estimate memory needed for chunking
 */
export function estimateChunkingMemory(
  fileSize: number,
  mode: ChunkMode,
  concurrency: number = 4
): number {
  const chunkSize = CHUNK_SIZES[mode];
  
  // Memory for chunks in flight + overhead
  const chunksMemory = chunkSize * concurrency;
  const overhead = 1 * MB; // Index, metadata, etc.
  
  return chunksMemory + overhead;
}

// ============================================================================
// SINGLETON
// ============================================================================

let pipelineInstance: MicroChunkPipeline | null = null;

export function getMicroChunkPipeline(maxConcurrent?: number): MicroChunkPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new MicroChunkPipeline(maxConcurrent);
  }
  return pipelineInstance;
}

export function resetMicroChunkPipeline(): void {
  pipelineInstance?.clearQueue();
  pipelineInstance?.resetMetrics();
  pipelineInstance = null;
}
