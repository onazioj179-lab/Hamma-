/**
 * SPK Micro-Optimization Layer - UI Performance Optimizer
 * Creator: OJ Treasure Onazi
 * 
 * SECTION 9: UI PERFORMANCE OPTIMIZATION
 * - Debounced progress updates (30-60fps)
 * - Virtualized lists for file displays
 * - Lazy-load preview data
 * - Web Workers for UI-heavy preview
 * - Never block the main thread
 */

import type {
  UIOptimizationConfig,
  UIPerformanceStats,
  UpdateFrequency,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_UI_CONFIG: UIOptimizationConfig = {
  progressDebounceMs: 16,  // ~60fps
  updateFrequency: '60fps',
  virtualizedLists: true,
  virtualWindowSize: 50,
  lazyLoadPreviews: true,
  previewWorkerEnabled: true,
  neverBlockMainThread: true,
  maxMainThreadWorkMs: 8,  // Half a frame
  offloadHeavyCompute: true,
};

const FPS_INTERVALS: Record<UpdateFrequency, number> = {
  '60fps': 16,
  '30fps': 33,
  '15fps': 66,
  'adaptive': 16,  // Will adjust
};

// ============================================================================
// PROGRESS DEBOUNCER
// ============================================================================

interface ProgressState {
  value: number;
  label?: string;
  eta?: number;
  speed?: number;
}

class ProgressDebouncer {
  private lastUpdate = 0;
  private pendingUpdate: ProgressState | null = null;
  private intervalMs: number;
  private rafId: number | null = null;
  private onUpdate: (state: ProgressState) => void;

  constructor(intervalMs: number, onUpdate: (state: ProgressState) => void) {
    this.intervalMs = intervalMs;
    this.onUpdate = onUpdate;
  }

  /**
   * Update progress (debounced)
   */
  update(state: ProgressState): void {
    this.pendingUpdate = state;

    const now = performance.now();
    if (now - this.lastUpdate >= this.intervalMs) {
      this.flush();
    } else if (!this.rafId) {
      this.scheduleFlush();
    }
  }

  /**
   * Force immediate update
   */
  flush(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.pendingUpdate) {
      this.onUpdate(this.pendingUpdate);
      this.lastUpdate = performance.now();
      this.pendingUpdate = null;
    }
  }

  /**
   * Schedule flush on next frame
   */
  private scheduleFlush(): void {
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.flush();
    });
  }

  /**
   * Change interval
   */
  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;
  }

  /**
   * Clear pending updates
   */
  clear(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingUpdate = null;
  }
}

// ============================================================================
// VIRTUAL LIST MANAGER
// ============================================================================

interface VirtualItem<T> {
  index: number;
  data: T;
  top: number;
  height: number;
}

export class VirtualListManager<T> {
  private items: T[] = [];
  private itemHeight: number;
  private containerHeight: number;
  private scrollTop = 0;
  private windowSize: number;
  private overscan = 5;

  constructor(
    itemHeight: number,
    containerHeight: number,
    windowSize: number = 50
  ) {
    this.itemHeight = itemHeight;
    this.containerHeight = containerHeight;
    this.windowSize = windowSize;
  }

  /**
   * Set items
   */
  setItems(items: T[]): void {
    this.items = items;
  }

  /**
   * Update scroll position
   */
  setScrollTop(scrollTop: number): void {
    this.scrollTop = scrollTop;
  }

  /**
   * Set container height
   */
  setContainerHeight(height: number): void {
    this.containerHeight = height;
  }

  /**
   * Get visible items
   */
  getVisibleItems(): VirtualItem<T>[] {
    const startIndex = Math.max(
      0,
      Math.floor(this.scrollTop / this.itemHeight) - this.overscan
    );
    
    const visibleCount = Math.ceil(this.containerHeight / this.itemHeight);
    const endIndex = Math.min(
      this.items.length,
      startIndex + visibleCount + this.overscan * 2
    );

    const visible: VirtualItem<T>[] = [];
    
    for (let i = startIndex; i < endIndex; i++) {
      visible.push({
        index: i,
        data: this.items[i],
        top: i * this.itemHeight,
        height: this.itemHeight,
      });
    }

    return visible;
  }

  /**
   * Get total height
   */
  getTotalHeight(): number {
    return this.items.length * this.itemHeight;
  }

  /**
   * Get visible range
   */
  getVisibleRange(): { start: number; end: number } {
    const start = Math.floor(this.scrollTop / this.itemHeight);
    const end = Math.min(
      this.items.length,
      start + Math.ceil(this.containerHeight / this.itemHeight)
    );
    return { start, end };
  }

  /**
   * Scroll to index
   */
  getScrollTopForIndex(index: number): number {
    return index * this.itemHeight;
  }

  /**
   * Get item count
   */
  getItemCount(): number {
    return this.items.length;
  }
}

// ============================================================================
// LAZY LOADER
// ============================================================================

type LoadStatus = 'pending' | 'loading' | 'loaded' | 'error';

interface LazyItem<T> {
  id: string;
  status: LoadStatus;
  data: T | null;
  error?: Error;
}

export class LazyLoader<T> {
  private items: Map<string, LazyItem<T>> = new Map();
  private loadQueue: string[] = [];
  private loadingCount = 0;
  private maxConcurrent: number;
  private loader: (id: string) => Promise<T>;
  private onLoaded?: (id: string, data: T) => void;
  private onError?: (id: string, error: Error) => void;

  constructor(
    loader: (id: string) => Promise<T>,
    maxConcurrent: number = 3
  ) {
    this.loader = loader;
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Register item for lazy loading
   */
  register(id: string): void {
    if (!this.items.has(id)) {
      this.items.set(id, {
        id,
        status: 'pending',
        data: null,
      });
    }
  }

  /**
   * Request load (queued)
   */
  requestLoad(id: string): void {
    const item = this.items.get(id);
    if (!item || item.status !== 'pending') return;

    if (!this.loadQueue.includes(id)) {
      this.loadQueue.push(id);
    }

    this.processQueue();
  }

  /**
   * Request loads for visible items
   */
  requestVisible(ids: string[]): void {
    // Prioritize visible items
    for (const id of ids) {
      const queueIndex = this.loadQueue.indexOf(id);
      if (queueIndex > 0) {
        // Move to front
        this.loadQueue.splice(queueIndex, 1);
        this.loadQueue.unshift(id);
      } else if (queueIndex === -1) {
        this.register(id);
        this.loadQueue.unshift(id);
      }
    }

    this.processQueue();
  }

  /**
   * Process load queue
   */
  private async processQueue(): Promise<void> {
    while (this.loadingCount < this.maxConcurrent && this.loadQueue.length > 0) {
      const id = this.loadQueue.shift()!;
      const item = this.items.get(id);
      
      if (!item || item.status !== 'pending') continue;

      item.status = 'loading';
      this.loadingCount++;

      try {
        const data = await this.loader(id);
        item.status = 'loaded';
        item.data = data;
        this.onLoaded?.(id, data);
      } catch (error) {
        item.status = 'error';
        item.error = error as Error;
        this.onError?.(id, error as Error);
      } finally {
        this.loadingCount--;
        this.processQueue();
      }
    }
  }

  /**
   * Get item
   */
  get(id: string): LazyItem<T> | undefined {
    return this.items.get(id);
  }

  /**
   * Check if loaded
   */
  isLoaded(id: string): boolean {
    const item = this.items.get(id);
    return item?.status === 'loaded';
  }

  /**
   * Set callbacks
   */
  setCallbacks(
    onLoaded: (id: string, data: T) => void,
    onError?: (id: string, error: Error) => void
  ): void {
    this.onLoaded = onLoaded;
    this.onError = onError;
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.items.clear();
    this.loadQueue = [];
    this.loadingCount = 0;
  }

  /**
   * Get stats
   */
  getStats(): { total: number; loaded: number; pending: number; loading: number } {
    let loaded = 0, pending = 0, loading = 0;
    
    for (const item of this.items.values()) {
      switch (item.status) {
        case 'loaded': loaded++; break;
        case 'pending': pending++; break;
        case 'loading': loading++; break;
      }
    }

    return {
      total: this.items.size,
      loaded,
      pending,
      loading,
    };
  }
}

// ============================================================================
// MAIN THREAD PROTECTOR
// ============================================================================

class MainThreadProtector {
  private maxWorkMs: number;
  private taskQueue: Array<() => void | Promise<void>> = [];
  private isProcessing = false;
  private stats = {
    longTasks: 0,
    blockedMs: 0,
  };

  constructor(maxWorkMs: number = 8) {
    this.maxWorkMs = maxWorkMs;
  }

  /**
   * Schedule work that won't block main thread
   */
  schedule(task: () => void | Promise<void>): void {
    this.taskQueue.push(task);
    
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process task queue yielding to browser
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()!;
      const startTime = performance.now();

      try {
        await task();
      } catch (error) {
        console.error('Task error:', error);
      }

      const elapsed = performance.now() - startTime;
      
      if (elapsed > this.maxWorkMs) {
        this.stats.longTasks++;
        this.stats.blockedMs += elapsed;
      }

      // Yield to browser between tasks
      await this.yieldToMain();
    }

    this.isProcessing = false;
  }

  /**
   * Yield to main thread
   */
  private yieldToMain(): Promise<void> {
    return new Promise(resolve => {
      // Use setTimeout(0) for more reliable yielding
      setTimeout(resolve, 0);
    });
  }

  /**
   * Run chunked work
   */
  async runChunked<T>(
    items: T[],
    processor: (item: T, index: number) => void,
    chunkSize: number = 100
  ): Promise<void> {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const startTime = performance.now();

      for (let j = 0; j < chunk.length; j++) {
        processor(chunk[j], i + j);
      }

      const elapsed = performance.now() - startTime;
      
      if (elapsed > this.maxWorkMs) {
        this.stats.longTasks++;
        this.stats.blockedMs += elapsed;
        await this.yieldToMain();
      }
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.stats = { longTasks: 0, blockedMs: 0 };
  }
}

// ============================================================================
// FPS MONITOR
// ============================================================================

class FPSMonitor {
  private frameTimes: number[] = [];
  private lastFrameTime = 0;
  private maxSamples = 60;
  private rafId: number | null = null;
  private onFpsUpdate?: (fps: number) => void;

  /**
   * Start monitoring
   */
  start(): void {
    if (this.rafId) return;

    const frame = (timestamp: number) => {
      if (this.lastFrameTime > 0) {
        const frameTime = timestamp - this.lastFrameTime;
        this.frameTimes.push(frameTime);
        
        if (this.frameTimes.length > this.maxSamples) {
          this.frameTimes.shift();
        }

        if (this.frameTimes.length > 0 && this.frameTimes.length % 10 === 0) {
          this.onFpsUpdate?.(this.getFPS());
        }
      }

      this.lastFrameTime = timestamp;
      this.rafId = requestAnimationFrame(frame);
    };

    this.rafId = requestAnimationFrame(frame);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    if (this.frameTimes.length === 0) return 60;
    
    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return Math.round(1000 / avgFrameTime);
  }

  /**
   * Get average frame time
   */
  getAvgFrameTime(): number {
    if (this.frameTimes.length === 0) return 16;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  /**
   * Set FPS callback
   */
  onUpdate(callback: (fps: number) => void): void {
    this.onFpsUpdate = callback;
  }

  /**
   * Reset
   */
  reset(): void {
    this.frameTimes = [];
    this.lastFrameTime = 0;
  }
}

// ============================================================================
// UI OPTIMIZER
// ============================================================================

export class UIOptimizer {
  private config: UIOptimizationConfig;
  private progressDebouncer: ProgressDebouncer | null = null;
  private mainThreadProtector: MainThreadProtector;
  private fpsMonitor: FPSMonitor;

  private stats: UIPerformanceStats = {
    fps: 60,
    frameTime: 16,
    longTasks: 0,
    mainThreadBlocks: 0,
    renderTime: 0,
    updateLatency: 0,
    virtualizedItems: 0,
    lazyLoadedItems: 0,
  };

  private renderTimes: number[] = [];

  constructor(config: Partial<UIOptimizationConfig> = {}) {
    this.config = { ...DEFAULT_UI_CONFIG, ...config };
    this.mainThreadProtector = new MainThreadProtector(this.config.maxMainThreadWorkMs);
    this.fpsMonitor = new FPSMonitor();
  }

  /**
   * Initialize UI optimizer
   */
  initialize(): void {
    this.fpsMonitor.start();
    this.fpsMonitor.onUpdate((fps) => {
      this.stats.fps = fps;
      this.stats.frameTime = 1000 / fps;
      
      // Adapt update frequency if configured
      if (this.config.updateFrequency === 'adaptive') {
        this.adaptUpdateFrequency(fps);
      }
    });
  }

  /**
   * Adapt update frequency based on FPS
   */
  private adaptUpdateFrequency(fps: number): void {
    let targetInterval: number;
    
    if (fps < 20) {
      targetInterval = FPS_INTERVALS['15fps'];
    } else if (fps < 40) {
      targetInterval = FPS_INTERVALS['30fps'];
    } else {
      targetInterval = FPS_INTERVALS['60fps'];
    }

    if (this.progressDebouncer) {
      this.progressDebouncer.setInterval(targetInterval);
    }
  }

  /**
   * Create progress debouncer
   */
  createProgressDebouncer(onUpdate: (state: ProgressState) => void): ProgressDebouncer {
    const interval = FPS_INTERVALS[this.config.updateFrequency];
    this.progressDebouncer = new ProgressDebouncer(interval, onUpdate);
    return this.progressDebouncer;
  }

  /**
   * Create virtual list manager
   */
  createVirtualList<T>(
    itemHeight: number,
    containerHeight: number
  ): VirtualListManager<T> {
    return new VirtualListManager(
      itemHeight,
      containerHeight,
      this.config.virtualWindowSize
    );
  }

  /**
   * Create lazy loader
   */
  createLazyLoader<T>(
    loader: (id: string) => Promise<T>,
    maxConcurrent?: number
  ): LazyLoader<T> {
    return new LazyLoader(loader, maxConcurrent);
  }

  /**
   * Schedule non-blocking work
   */
  scheduleWork(task: () => void | Promise<void>): void {
    if (this.config.neverBlockMainThread) {
      this.mainThreadProtector.schedule(task);
    } else {
      task();
    }
  }

  /**
   * Run chunked processing
   */
  async processChunked<T>(
    items: T[],
    processor: (item: T, index: number) => void,
    chunkSize?: number
  ): Promise<void> {
    await this.mainThreadProtector.runChunked(items, processor, chunkSize);
  }

  /**
   * Record render time
   */
  recordRender(timeMs: number): void {
    this.renderTimes.push(timeMs);
    if (this.renderTimes.length > 100) {
      this.renderTimes.shift();
    }
    
    this.stats.renderTime = 
      this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length;
  }

  /**
   * Get statistics
   */
  getStats(): UIPerformanceStats {
    const protectorStats = this.mainThreadProtector.getStats();
    
    return {
      ...this.stats,
      longTasks: protectorStats.longTasks,
      mainThreadBlocks: protectorStats.longTasks,
    };
  }

  /**
   * Get configuration
   */
  getConfig(): UIOptimizationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<UIOptimizationConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (this.progressDebouncer && config.progressDebounceMs) {
      this.progressDebouncer.setInterval(config.progressDebounceMs);
    }
    
    if (config.maxMainThreadWorkMs) {
      this.mainThreadProtector = new MainThreadProtector(config.maxMainThreadWorkMs);
    }
  }

  /**
   * Reset optimizer
   */
  reset(): void {
    this.progressDebouncer?.clear();
    this.fpsMonitor.reset();
    this.mainThreadProtector.resetStats();
    this.renderTimes = [];
    
    this.stats = {
      fps: 60,
      frameTime: 16,
      longTasks: 0,
      mainThreadBlocks: 0,
      renderTime: 0,
      updateLatency: 0,
      virtualizedItems: 0,
      lazyLoadedItems: 0,
    };
  }

  /**
   * Destroy optimizer
   */
  destroy(): void {
    this.fpsMonitor.stop();
    this.progressDebouncer?.clear();
    this.reset();
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let uiOptimizerInstance: UIOptimizer | null = null;

export function getUIOptimizer(config?: Partial<UIOptimizationConfig>): UIOptimizer {
  if (!uiOptimizerInstance) {
    uiOptimizerInstance = new UIOptimizer(config);
    uiOptimizerInstance.initialize();
  }
  return uiOptimizerInstance;
}

export function resetUIOptimizer(): void {
  if (uiOptimizerInstance) {
    uiOptimizerInstance.destroy();
  }
  uiOptimizerInstance = null;
}
