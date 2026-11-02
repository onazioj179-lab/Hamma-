/**
 * SPK Implementation Blueprint - Event System
 * 
 * Event bus for runtime communication and telemetry.
 * Provides pub/sub pattern for coordinating across modules.
 * 
 * @module core/runtime/events
 * @version 1.0.0
 */

import type { Event, EventType, EventListener, ProgressEvent } from './types';

// ============================================================================
// Event Bus
// ============================================================================

/**
 * Central event bus for SPK runtime.
 * Manages event subscriptions and dispatch.
 */
export class EventBus {
  private listeners: Map<EventType, Set<EventListener>> = new Map();
  private eventHistory: Event[] = [];
  private maxHistory = 100;

  /**
   * Subscribe to an event type.
   */
  on<T = any>(type: EventType, listener: EventListener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    const listeners = this.listeners.get(type)!;
    listeners.add(listener as EventListener);

    // Return unsubscribe function
    return () => {
      listeners.delete(listener as EventListener);
      if (listeners.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  /**
   * Subscribe to an event type once.
   */
  once<T = any>(type: EventType, listener: EventListener<T>): void {
    const unsubscribe = this.on(type, (event) => {
      unsubscribe();
      listener(event);
    });
  }

  /**
   * Unsubscribe from an event type.
   */
  off<T = any>(type: EventType, listener: EventListener<T>): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.delete(listener as EventListener);
    }
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<T = any>(type: EventType, data: T, jobId?: string): void {
    const event: Event<T> = {
      type,
      timestamp: Date.now(),
      data,
      jobId,
    };

    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }

    // Notify listeners
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${type}:`, error);
        }
      });
    }
  }

  /**
   * Get event history.
   */
  getHistory(type?: EventType, limit?: number): Event[] {
    let history = type 
      ? this.eventHistory.filter(e => e.type === type)
      : this.eventHistory;

    if (limit) {
      history = history.slice(-limit);
    }

    return history;
  }

  /**
   * Clear event history.
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get active listener count for event type.
   */
  listenerCount(type: EventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  /**
   * Get all active event types.
   */
  activeEventTypes(): EventType[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Remove all listeners.
   */
  removeAllListeners(type?: EventType): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
    }
  }
}

// ============================================================================
// Event Emitters
// ============================================================================

/**
 * Helper class for emitting specific event types.
 */
export class EventEmitter {
  constructor(private bus: EventBus) {}

  // Compression events
  compressStart(jobId: string, fileCount: number, totalSize: number): void {
    this.bus.emit('compress-start', { fileCount, totalSize }, jobId);
  }

  compressProgress(jobId: string, progress: ProgressEvent): void {
    this.bus.emit('compress-progress', progress, jobId);
  }

  compressComplete(jobId: string, archiveId: string, stats: any): void {
    this.bus.emit('compress-complete', { archiveId, stats }, jobId);
  }

  compressError(jobId: string, error: Error): void {
    this.bus.emit('compress-error', { error: error.message }, jobId);
  }

  // Decompression events
  decompressStart(jobId: string, archiveSize: number): void {
    this.bus.emit('decompress-start', { archiveSize }, jobId);
  }

  decompressProgress(jobId: string, progress: ProgressEvent): void {
    this.bus.emit('decompress-progress', progress, jobId);
  }

  decompressComplete(jobId: string, fileCount: number): void {
    this.bus.emit('decompress-complete', { fileCount }, jobId);
  }

  decompressError(jobId: string, error: Error): void {
    this.bus.emit('decompress-error', { error: error.message }, jobId);
  }

  // Sharing events
  shareCreated(token: string, archiveId: string): void {
    this.bus.emit('share-created', { token, archiveId });
  }

  shareAccessed(token: string, timestamp: number): void {
    this.bus.emit('share-accessed', { token, timestamp });
  }

  // Worker events
  workerReady(workerId: number): void {
    this.bus.emit('worker-ready', { workerId });
  }

  workerError(workerId: number, error: string): void {
    this.bus.emit('worker-error', { workerId, error });
  }

  // AI events
  aiOptimization(recommendations: any): void {
    this.bus.emit('ai-optimization', recommendations);
  }

  // Status events
  statusChange(status: any): void {
    this.bus.emit('status-change', status);
  }
}

// ============================================================================
// Progress Tracker
// ============================================================================

/**
 * Tracks and emits progress updates for operations.
 */
export class ProgressTracker {
  private progress: ProgressEvent;
  private startTime: number;
  private lastEmit = 0;
  private emitInterval = 100; // ms

  constructor(
    private jobId: string,
    private emitter: EventEmitter,
    totalBytes: number,
    totalFiles: number,
    totalChunks: number
  ) {
    this.startTime = Date.now();
    this.progress = {
      stage: 'scanning',
      bytesProcessed: 0,
      bytesTotal: totalBytes,
      filesProcessed: 0,
      filesTotal: totalFiles,
      chunksProcessed: 0,
      chunksTotal: totalChunks,
      throughputBps: 0,
      estimatedTimeRemaining: 0,
      percentComplete: 0,
    };
  }

  /**
   * Update progress with new values.
   */
  update(updates: Partial<ProgressEvent>): void {
    Object.assign(this.progress, updates);

    // Calculate derived values
    const elapsed = (Date.now() - this.startTime) / 1000;
    this.progress.throughputBps = this.progress.bytesProcessed / elapsed;
    this.progress.percentComplete = 
      (this.progress.bytesProcessed / this.progress.bytesTotal) * 100;

    if (this.progress.throughputBps > 0) {
      const remaining = this.progress.bytesTotal - this.progress.bytesProcessed;
      this.progress.estimatedTimeRemaining = remaining / this.progress.throughputBps;
    }

    // Emit if enough time has passed
    const now = Date.now();
    if (now - this.lastEmit >= this.emitInterval) {
      this.emit();
      this.lastEmit = now;
    }
  }

  /**
   * Update stage.
   */
  setStage(stage: ProgressEvent['stage']): void {
    this.progress.stage = stage;
    this.emit();
  }

  /**
   * Update current file.
   */
  setCurrentFile(filename: string): void {
    this.progress.currentFile = filename;
  }

  /**
   * Increment counters.
   */
  incrementBytes(bytes: number): void {
    this.progress.bytesProcessed += bytes;
    this.update({});
  }

  incrementFiles(): void {
    this.progress.filesProcessed++;
    this.update({});
  }

  incrementChunks(): void {
    this.progress.chunksProcessed++;
    this.update({});
  }

  /**
   * Emit current progress.
   */
  private emit(): void {
    this.emitter.compressProgress(this.jobId, { ...this.progress });
  }

  /**
   * Get current progress.
   */
  getProgress(): ProgressEvent {
    return { ...this.progress };
  }

  /**
   * Mark as complete.
   */
  complete(): void {
    this.progress.stage = 'complete';
    this.progress.percentComplete = 100;
    this.emit();
  }
}

// ============================================================================
// Telemetry
// ============================================================================

/**
 * Collects and emits telemetry data.
 */
export class Telemetry {
  private metrics: Map<string, number[]> = new Map();

  constructor(_emitter: EventEmitter) {
    // Emitter reserved for future use
  }

  /**
   * Record a metric value.
   */
  record(metric: string, value: number): void {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }
    this.metrics.get(metric)!.push(value);
  }

  /**
   * Get metric statistics.
   */
  getStats(metric: string): {
    min: number;
    max: number;
    avg: number;
    count: number;
  } | null {
    const values = this.metrics.get(metric);
    if (!values || values.length === 0) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

    return { min, max, avg, count: values.length };
  }

  /**
   * Clear metrics.
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Get all metrics.
   */
  getAllMetrics(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const metric of this.metrics.keys()) {
      result[metric] = this.getStats(metric);
    }
    return result;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalBus: EventBus | null = null;
let globalEmitter: EventEmitter | null = null;
let globalTelemetry: Telemetry | null = null;

export function getEventBus(): EventBus {
  if (!globalBus) {
    globalBus = new EventBus();
  }
  return globalBus;
}

export function getEventEmitter(): EventEmitter {
  if (!globalEmitter) {
    globalEmitter = new EventEmitter(getEventBus());
  }
  return globalEmitter;
}

export function getTelemetry(): Telemetry {
  if (!globalTelemetry) {
    globalTelemetry = new Telemetry(getEventEmitter());
  }
  return globalTelemetry;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  EventBus,
  EventEmitter,
  ProgressTracker,
  Telemetry,
  getEventBus,
  getEventEmitter,
  getTelemetry,
};
