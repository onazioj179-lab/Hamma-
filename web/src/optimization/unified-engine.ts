/**
 * SPK Micro-Optimization Layer - Unified Engine
 * Creator: OJ Treasure Onazi
 * 
 * Central coordinator for all optimization subsystems:
 * - WASM Optimizer
 * - Worker Pool Optimizer
 * - Coordinator Optimizer
 * - Memory Optimizer
 * - I/O Optimizer
 * - Archive Writer Optimizer
 * - AI Optimizer Engine
 * - UI Optimizer
 * 
 * Targets:
 * - Low-end: 500MB/min
 * - Average: 5-20GB/min
 * - High-end: 50-100GB/min+
 * - Enterprise: 200GB/min+ (cluster mode future)
 */

import type {
  MicroOptimizationConfig,
  MicroOptimizationStats,
  OptimizationMode,
  DeviceProfile,
  GlobalOptimizationTargets,
  OptimizationEvent,
  OptimizationEventHandler,
  MemoryPressure,
  TestProfile,
  TestResult,
} from './types';

import { WasmOptimizer, getWasmOptimizer, resetWasmOptimizer } from './wasm-optimizer';
import { WorkerPoolOptimizer, getWorkerPoolOptimizer, resetWorkerPoolOptimizer } from './worker-optimizer';
import { CoordinatorOptimizer, getCoordinatorOptimizer, resetCoordinatorOptimizer } from './coordinator-optimizer';
import { MemoryOptimizer, getMemoryOptimizer, resetMemoryOptimizer } from './memory-optimizer';
import { IOOptimizer, getIOOptimizer, resetIOOptimizer } from './io-optimizer';
import { ArchiveWriterOptimizer, getArchiveWriterOptimizer, resetArchiveWriterOptimizer } from './archive-optimizer';
import { AIOptimizerEngine, getAIOptimizerEngine, resetAIOptimizerEngine } from './ai-optimizer';
import { UIOptimizer, getUIOptimizer, resetUIOptimizer } from './ui-optimizer';

// ============================================================================
// CONSTANTS
// ============================================================================

const MB = 1024 * 1024;
const GB = 1024 * MB;

const DEFAULT_TARGETS: GlobalOptimizationTargets = {
  throughput: {
    lowEnd: 500 * MB / 60,       // 500MB/min = ~8.3MB/s
    average: 10 * GB / 60,       // 10GB/min = ~166MB/s
    highEnd: 75 * GB / 60,       // 75GB/min = ~1.25GB/s
    enterprise: 200 * GB / 60,   // 200GB/min = ~3.3GB/s
  },
  latency: {
    chunkPipeline: 5,            // < 5ms
    workerRoundtrip: 1,          // < 1ms
    aiDecisionLoop: 100,         // < 100ms
    uiUpdate: 16,                // 60fps
  },
  memory: {
    maxUsage: 600 * MB,          // 600MB max
    softLimit: 400 * MB,         // Start throttling
    criticalLimit: 500 * MB,     // Emergency
    microChunkThreshold: 256 * MB,
  },
};

// ============================================================================
// TEST PROFILES
// ============================================================================

const TEST_PROFILES: TestProfile[] = [
  {
    category: 'small',
    minSize: 10 * MB,
    maxSize: 100 * MB,
    expectedThroughput: 50 * MB,  // 50MB/s
    maxLatency: 50,
    maxMemory: 200 * MB,
    allowedErrors: 0,
    allowedStalls: 1,
  },
  {
    category: 'mid',
    minSize: 500 * MB,
    maxSize: 5 * GB,
    expectedThroughput: 100 * MB,  // 100MB/s
    maxLatency: 100,
    maxMemory: 400 * MB,
    allowedErrors: 1,
    allowedStalls: 3,
  },
  {
    category: 'large',
    minSize: 10 * GB,
    maxSize: 100 * GB,
    expectedThroughput: 150 * MB,  // 150MB/s
    maxLatency: 200,
    maxMemory: 500 * MB,
    allowedErrors: 2,
    allowedStalls: 5,
  },
  {
    category: 'ultra-large',
    minSize: 500 * GB,
    maxSize: 10 * 1024 * GB,  // 10TB
    expectedThroughput: 100 * MB,  // 100MB/s (stability over speed)
    maxLatency: 500,
    maxMemory: 600 * MB,
    allowedErrors: 5,
    allowedStalls: 10,
  },
];

// ============================================================================
// DEVICE PROFILE DETECTOR
// ============================================================================

function detectDeviceProfile(): DeviceProfile {
  const cores = navigator.hardwareConcurrency || 4;
  
  // @ts-expect-error - Chrome-specific API
  const memory = navigator.deviceMemory || 4;
  
  if (cores >= 16 && memory >= 16) {
    return 'server';
  }
  if (cores >= 8 && memory >= 8) {
    return 'workstation';
  }
  if (cores >= 4 && memory >= 4) {
    return 'desktop';
  }
  if (cores >= 2) {
    return 'laptop';
  }
  return 'mobile';
}

// ============================================================================
// UNIFIED OPTIMIZATION ENGINE
// ============================================================================

export class UnifiedOptimizationEngine {
  private config: MicroOptimizationConfig;
  private targets: GlobalOptimizationTargets;
  private mode: OptimizationMode = 'balanced';
  private deviceProfile: DeviceProfile;
  private initialized = false;
  private startTime = 0;

  // Subsystems
  private wasm!: WasmOptimizer;
  private workerPool!: WorkerPoolOptimizer;
  private coordinator!: CoordinatorOptimizer;
  private memory!: MemoryOptimizer;
  private io!: IOOptimizer;
  private archiveWriter!: ArchiveWriterOptimizer;
  private ai!: AIOptimizerEngine;
  private ui!: UIOptimizer;

  // Event handling
  private eventHandlers: OptimizationEventHandler[] = [];

  // Statistics
  private stats: MicroOptimizationStats;

  constructor(config?: Partial<MicroOptimizationConfig>) {
    this.deviceProfile = detectDeviceProfile();
    this.targets = { ...DEFAULT_TARGETS };
    
    // Build default config based on device profile
    this.config = this.buildDefaultConfig(config);
    
    this.stats = this.createInitialStats();
  }

  /**
   * Build default configuration based on device profile
   */
  private buildDefaultConfig(overrides?: Partial<MicroOptimizationConfig>): MicroOptimizationConfig {
    const deviceMultipliers: Record<DeviceProfile, number> = {
      mobile: 0.5,
      laptop: 0.75,
      desktop: 1.0,
      workstation: 1.5,
      server: 2.0,
    };

    const mult = deviceMultipliers[this.deviceProfile];
    const cores = navigator.hardwareConcurrency || 4;

    return {
      mode: 'balanced',
      deviceProfile: this.deviceProfile,
      targets: this.targets,
      
      wasm: {
        optimizationLevel: 'O3',
        ltoEnabled: true,
        simdEnabled: true,
        boundaryAlignment: 64 * 1024,
        fastPathChunkSizes: [1 * MB, 2 * MB, 4 * MB],
        memoryStrategy: 'pooled',
        initialMemoryPages: Math.floor(256 * mult),
        maxMemoryPages: Math.floor(16384 * mult),
        pageAlignment: 64 * 1024,
        pointerPoolEnabled: true,
        pointerPoolSize: Math.floor(64 * mult),
        reduceAllocChurn: true,
        streamingWriteEnabled: true,
        zeroCopyEnabled: true,
        exposePointersToJs: true,
      },
      
      workers: {
        persistentWorkers: true,
        neverRecreatePerChunk: true,
        useTransferables: true,
        transferableTypes: ['ArrayBuffer', 'MessagePort'],
        preloadWasm: true,
        wasmWarmupEnabled: true,
        warmupChunkCount: 3,
        warmupChunkSize: 64 * 1024,
        batchStrategy: 'adaptive',
        batchSize: Math.floor(10 * mult),
        batchIntervalMs: 50,
        reduceEventSpam: true,
        workerCountStrategy: 'adaptive',
        compressionWorkerCount: Math.max(2, cores - 1),
        decompressionWorkerCount: cores,
        maxWorkers: Math.min(16, cores * 2),
        minWorkers: 2,
      },
      
      coordinator: {
        preScheduleEnabled: true,
        preScheduleBatchSize: Math.floor(5 * mult),
        predictiveEnabled: true,
        measureWorkerSpeed: true,
        weightByPerformance: true,
        minPendingQueue: 2,
        maxPendingQueue: Math.floor(20 * mult),
        overlapReading: true,
        overlapScheduling: true,
        overlapWriting: true,
        useAtomicFlags: true,
        avoidMutexStructures: true,
        lockFreeQueues: true,
      },
      
      memory: {
        reuseAllBuffers: true,
        recycleStrategy: 'aggressive',
        hybridPoolEnabled: true,
        poolTiers: {
          small: { maxSize: 512 * 1024, count: Math.floor(32 * mult) },
          medium: { maxSize: 4 * MB, count: Math.floor(16 * mult) },
          large: { maxSize: 16 * MB, count: Math.floor(8 * mult) },
          huge: { maxSize: 64 * MB, count: Math.floor(2 * mult) },
        },
        dynamicChunkSizing: true,
        chunkSizeMultiplier: 1.25,
        chunkSizeDivider: 2,
        memoryHighThreshold: 0.8,
        memoryLowThreshold: 0.4,
        neverCombineLargeBuffers: true,
        streamAppendOnly: true,
        maxCombineSize: 1 * MB,
      },
      
      io: {
        useNativeStreams: true,
        neverLoadFullFile: true,
        preCalculateBoundaries: true,
        boundaryAlignment: 64 * 1024,
        backpressureStrategy: 'throttle',
        coordinateWithWorkers: true,
        onlyReadWhenCapacity: true,
        zeroCopySlicing: true,
        useSubarray: true,
        avoidBufferCopies: true,
      },
      
      archive: {
        accumulationStrategy: 'stream-writer',
        avoidLargeConcatenations: true,
        writeMetadataLate: true,
        generateFooterOnce: true,
        avoidRecalculations: true,
        useTypedArrays: true,
        offsetArrayType: 'Uint32Array',
        metricArrayType: 'Float32Array',
        metadataCompression: 'auto',
        metadataCompressionLevel: 3,
      },
      
      ai: {
        evaluationIntervalMs: 200,
        predictiveModelsEnabled: true,
        workerStallPrediction: true,
        bottleneckPrediction: true,
        memoryPressurePrediction: true,
        stabilityFirstMode: false,
        prioritizeRolloverSafe: true,
        avoidAggressiveGrowth: true,
        maxChunkGrowthRate: 1.25,
        burstModeEnabled: true,
        burstModeThreshold: 100 * MB,
        burstMaxThroughput: true,
      },
      
      ui: {
        progressDebounceMs: 16,
        updateFrequency: '60fps',
        virtualizedLists: true,
        virtualWindowSize: 50,
        lazyLoadPreviews: true,
        previewWorkerEnabled: true,
        neverBlockMainThread: true,
        maxMainThreadWorkMs: 8,
        offloadHeavyCompute: true,
      },
      
      ...overrides,
    };
  }

  /**
   * Create initial stats object
   */
  private createInitialStats(): MicroOptimizationStats {
    return {
      timestamp: Date.now(),
      uptime: 0,
      mode: this.mode,
      metrics: {
        timestamp: Date.now(),
        throughputBps: 0,
        throughputMBps: 0,
        latencyMs: 0,
        memoryUsage: 0,
        memoryPressure: 'low',
        cpuUsage: 0,
        workerUtilization: 0,
        wasmEfficiency: 0,
        ioEfficiency: 0,
        errorRate: 0,
        stallCount: 0,
      },
      wasm: {
        moduleLoadTime: 0,
        jitWarmupTime: 0,
        avgChunkProcessTime: 0,
        simdOperations: 0,
        memoryAllocations: 0,
        memoryDeallocations: 0,
        pointerPoolHits: 0,
        pointerPoolMisses: 0,
        fastPathHits: 0,
        slowPathHits: 0,
      },
      workers: {
        totalWorkers: 0,
        activeWorkers: 0,
        idleWorkers: 0,
        stalledWorkers: 0,
        totalChunksProcessed: 0,
        totalBytesProcessed: 0,
        avgThroughputBps: 0,
        loadBalance: 0,
      },
      coordinator: {
        chunksScheduled: 0,
        chunksCompleted: 0,
        chunksPending: 0,
        chunksInFlight: 0,
        avgSchedulingLatency: 0,
        avgCompletionLatency: 0,
        workerUtilization: [],
        pipelineEfficiency: 0,
        starvationEvents: 0,
        backpressureEvents: 0,
      },
      memory: {
        totalAllocated: 0,
        totalAvailable: 0,
        peakUsage: 0,
        currentUsage: 0,
        pressure: 'low',
        gcCycles: 0,
        poolStats: [],
        chunkSizeHistory: [],
        allocationRate: 0,
        deallocationRate: 0,
      },
      io: {
        bytesRead: 0,
        bytesWritten: 0,
        readOperations: 0,
        writeOperations: 0,
        avgReadLatency: 0,
        avgWriteLatency: 0,
        backpressureEvents: 0,
        zeroCopyOperations: 0,
        bufferCopies: 0,
        streamEfficiency: 0,
      },
      archive: {
        chunksWritten: 0,
        bytesWritten: 0,
        metadataSize: 0,
        footerSize: 64,
        compressionRatio: 0,
        writeLatency: 0,
        flushCount: 0,
        concatenationCount: 0,
      },
      ai: {
        predictionsGenerated: 0,
        predictionsApplied: 0,
        predictionAccuracy: 0,
        adjustmentsMade: 0,
        stallsPrevented: 0,
        bottlenecksAvoided: 0,
        memoryPressureEvents: 0,
        avgDecisionLatency: 0,
        modeChanges: 0,
      },
      ui: {
        fps: 60,
        frameTime: 16,
        longTasks: 0,
        mainThreadBlocks: 0,
        renderTime: 0,
        updateLatency: 0,
        virtualizedItems: 0,
        lazyLoadedItems: 0,
      },
    };
  }

  /**
   * Initialize all subsystems
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.startTime = Date.now();

    console.log(`[SPK] Initializing Micro-Optimization Layer (${this.deviceProfile})`);

    // Initialize subsystems
    this.wasm = getWasmOptimizer(this.config.wasm);
    await this.wasm.initialize();

    this.memory = getMemoryOptimizer(this.config.memory);
    
    this.io = getIOOptimizer(this.config.io);
    
    this.archiveWriter = getArchiveWriterOptimizer(this.config.archive);
    
    this.coordinator = getCoordinatorOptimizer(this.config.coordinator);
    
    this.ai = getAIOptimizerEngine(this.config.ai);
    this.ai.start();
    
    // Setup AI callbacks
    this.ai.onPredictionGenerated((prediction) => {
      this.emit({ type: 'ai-adjustment', action: prediction.suggestedAction });
    });
    
    this.ui = getUIOptimizer(this.config.ui);

    this.initialized = true;
    
    console.log('[SPK] Micro-Optimization Layer initialized');
  }

  /**
   * Initialize worker pool with URL
   */
  async initializeWorkers(workerUrl: URL): Promise<void> {
    this.workerPool = getWorkerPoolOptimizer(workerUrl, this.config.workers);
    await this.workerPool.initialize('compression');
  }

  /**
   * Set optimization mode
   */
  setMode(mode: OptimizationMode): void {
    const oldMode = this.mode;
    this.mode = mode;
    this.config.mode = mode;

    // Adjust subsystems based on mode
    switch (mode) {
      case 'speed':
        this.ai.setMode('aggressive');
        this.config.memory.dynamicChunkSizing = false;
        break;

      case 'memory':
        this.ai.setMode('active');
        this.config.memory.memoryHighThreshold = 0.6;
        break;

      case 'stability':
        this.ai.enableStabilityMode();
        break;

      case 'burst':
        this.ai.enableBurstMode();
        break;

      default:
        this.ai.setMode('active');
    }

    this.emit({ type: 'mode-changed', oldMode, newMode: mode });
  }

  /**
   * Get optimal mode for file size
   */
  getOptimalMode(fileSize: number): OptimizationMode {
    if (this.ai.shouldUseBurstMode(fileSize)) {
      return 'burst';
    }
    if (this.ai.shouldUseStabilityMode(fileSize)) {
      return 'stability';
    }
    return 'balanced';
  }

  /**
   * Process file with full optimization
   */
  async processFile(
    file: File,
    onProgress?: (progress: number, stats: MicroOptimizationStats) => void
  ): Promise<Blob> {
    if (!this.initialized) {
      throw new Error('Engine not initialized');
    }

    // Auto-select mode
    const optimalMode = this.getOptimalMode(file.size);
    this.setMode(optimalMode);

    // Create reader
    const readerHandle = this.io.createReader(file, this.memory.getOptimalChunkSize());
    
    // Create writer
    const writerHandle = this.io.createWriter();
    
    // Start archive
    this.archiveWriter.start();
    
    // Start coordinator
    this.coordinator.start();

    // Process chunks
    await this.io.readFile(
      readerHandle.id,
      async (chunk, index) => {
        // Record telemetry
        this.ai.recordTelemetry({
          throughputBps: this.stats.metrics.throughputBps,
          memoryUsage: this.memory.getStats().currentUsage,
          memoryPressure: this.memory.getPressure(),
          workerLoad: [],
          chunkTimes: [],
          stallCount: 0,
          errorCount: 0,
          queueDepth: this.coordinator.getPendingCount(),
        });

        // Check for AI adjustments
        const actions = this.ai.getPendingActions();
        for (const action of actions) {
          this.applyAction(action);
        }

        // Process chunk through WASM
        const startTime = performance.now();
        const processed = this.wasm.processChunk(new Uint8Array(chunk));
        const processTime = performance.now() - startTime;

        // Write to archive
        this.archiveWriter.writeChunk(processed, chunk.byteLength, processTime);
        
        // Write to output
        this.io.writeChunk(writerHandle, processed);
        
        // Mark processed for backpressure
        this.io.markChunkProcessed(readerHandle.id);

        // Update stats
        this.updateStats();

        // Progress callback
        if (onProgress) {
          const progress = (index + 1) / this.io.getChunkBoundaries(readerHandle.id).length;
          onProgress(progress, this.getStats());
        }
      }
    );

    // Finalize archive
    const archiveBlob = this.archiveWriter.finalize();
    
    // Cleanup
    this.io.closeReader(readerHandle.id);
    this.io.closeWriter(writerHandle);
    
    return archiveBlob;
  }

  /**
   * Apply AI action
   */
  private applyAction(action: any): void {
    switch (action.type) {
      case 'adjust-chunk-size':
        // Memory optimizer handles this
        break;

      case 'adjust-workers':
        if (this.workerPool) {
          const currentCount = this.workerPool.getStats().totalWorkers;
          this.workerPool.scaleWorkers(currentCount + Number(action.newValue));
        }
        break;

      case 'gc':
        this.memory.gc();
        this.emit({ type: 'gc-triggered', freed: 0 });
        break;

      case 'throttle':
        // Handled by coordinator
        break;
    }

    this.ai.applyAction(action);
  }

  /**
   * Update aggregated stats
   */
  private updateStats(): void {
    this.stats.timestamp = Date.now();
    this.stats.uptime = Date.now() - this.startTime;
    this.stats.mode = this.mode;
    
    // Update from subsystems
    this.stats.wasm = this.wasm.getStats();
    this.stats.coordinator = this.coordinator.getStats();
    this.stats.memory = this.memory.getStats();
    this.stats.io = this.io.getStats();
    this.stats.archive = this.archiveWriter.getStats();
    this.stats.ai = this.ai.getStats();
    this.stats.ui = this.ui.getStats();

    if (this.workerPool) {
      this.stats.workers = this.workerPool.getStats();
    }

    // Calculate aggregate metrics
    this.stats.metrics = {
      timestamp: Date.now(),
      throughputBps: this.stats.workers.avgThroughputBps,
      throughputMBps: this.stats.workers.avgThroughputBps / MB,
      latencyMs: this.stats.wasm.avgChunkProcessTime,
      memoryUsage: this.stats.memory.currentUsage,
      memoryPressure: this.stats.memory.pressure,
      cpuUsage: 0,  // Would need performance observer
      workerUtilization: this.stats.workers.loadBalance,
      wasmEfficiency: this.stats.wasm.fastPathHits / 
        (this.stats.wasm.fastPathHits + this.stats.wasm.slowPathHits) || 1,
      ioEfficiency: this.stats.io.streamEfficiency,
      errorRate: 0,
      stallCount: this.stats.workers.stalledWorkers,
    };
  }

  /**
   * Get current statistics
   */
  getStats(): MicroOptimizationStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get configuration
   */
  getConfig(): MicroOptimizationConfig {
    return { ...this.config };
  }

  /**
   * Get optimization targets
   */
  getTargets(): GlobalOptimizationTargets {
    return { ...this.targets };
  }

  /**
   * Get test profiles
   */
  getTestProfiles(): TestProfile[] {
    return [...TEST_PROFILES];
  }

  /**
   * Run test against profile
   */
  async runTest(profile: TestProfile, testData: Uint8Array): Promise<TestResult> {
    const startTime = performance.now();
    const startMemory = this.stats.memory.currentUsage;
    let errorCount = 0;
    let stallCount = 0;

    try {
      // Process test data
      const processed = this.wasm.processChunk(testData);
      
      const elapsed = performance.now() - startTime;
      const throughput = testData.byteLength / elapsed * 1000;
      const peakMemory = this.stats.memory.peakUsage;

      const passed = 
        throughput >= profile.expectedThroughput * 0.8 &&
        errorCount <= profile.allowedErrors &&
        stallCount <= profile.allowedStalls &&
        peakMemory <= profile.maxMemory;

      return {
        profile,
        metrics: {
          throughput,
          errorCount,
          recoveryTime: 0,
          workerStalls: stallCount,
          aiPredictionAccuracy: this.stats.ai.predictionAccuracy,
          peakMemory,
          avgCpu: 0,
          wasmJitEfficiency: this.stats.wasm.fastPathHits / 
            (this.stats.wasm.fastPathHits + this.stats.wasm.slowPathHits) || 1,
        },
        passed,
        issues: passed ? [] : ['Performance below threshold'],
        recommendations: [],
      };
    } catch (error) {
      return {
        profile,
        metrics: {
          throughput: 0,
          errorCount: 1,
          recoveryTime: 0,
          workerStalls: 0,
          aiPredictionAccuracy: 0,
          peakMemory: 0,
          avgCpu: 0,
          wasmJitEfficiency: 0,
        },
        passed: false,
        issues: [(error as Error).message],
        recommendations: ['Check error handling'],
      };
    }
  }

  /**
   * Register event handler
   */
  on(handler: OptimizationEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Emit event
   */
  private emit(event: OptimizationEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  /**
   * Force garbage collection
   */
  gc(): void {
    this.memory.gc();
    this.wasm.gc();
    if (this.workerPool) {
      this.workerPool.gcAll();
    }
  }

  /**
   * Reset all subsystems
   */
  reset(): void {
    resetWasmOptimizer();
    resetWorkerPoolOptimizer();
    resetCoordinatorOptimizer();
    resetMemoryOptimizer();
    resetIOOptimizer();
    resetArchiveWriterOptimizer();
    resetAIOptimizerEngine();
    resetUIOptimizer();
    
    this.stats = this.createInitialStats();
    this.initialized = false;
  }

  /**
   * Destroy engine
   */
  destroy(): void {
    this.reset();
    this.eventHandlers = [];
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get device profile
   */
  getDeviceProfile(): DeviceProfile {
    return this.deviceProfile;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let engineInstance: UnifiedOptimizationEngine | null = null;

export function getUnifiedOptimizationEngine(
  config?: Partial<MicroOptimizationConfig>
): UnifiedOptimizationEngine {
  if (!engineInstance) {
    engineInstance = new UnifiedOptimizationEngine(config);
  }
  return engineInstance;
}

export function resetUnifiedOptimizationEngine(): void {
  if (engineInstance) {
    engineInstance.destroy();
  }
  engineInstance = null;
}
