/**
 * SPK V46 - AI Telemetry Collector
 * Collects pipeline metrics for AI optimization
 * Contains ONLY metadata - never user content
 */

import type {
  AITelemetrySignals,
  HardwareProfile,
  HistoricalPerformance,
  FileTypeStats,
} from './types';

/**
 * Telemetry collector for AI optimizer
 */
export class TelemetryCollector {
  private currentSignals: Partial<AITelemetrySignals> = {};
  private hardwareProfile: HardwareProfile | null = null;
  private chunkTimes: number[] = [];
  private stallEvents: number = 0;
  private initialized = false;

  /**
   * Initialize collector and detect hardware
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.hardwareProfile = await this.detectHardware();
    this.initialized = true;
  }

  /**
   * Detect hardware capabilities
   */
  private async detectHardware(): Promise<HardwareProfile> {
    const cpuCores = navigator.hardwareConcurrency || 4;
    
    // Estimate available memory
    let availableMemory = 512 * 1024 * 1024; // Default 512MB
    if ('deviceMemory' in navigator) {
      availableMemory = ((navigator as unknown as { deviceMemory: number }).deviceMemory || 4) * 1024 * 1024 * 1024;
    }

    // Detect device type
    const deviceType = this.detectDeviceType();

    // Check WASM capabilities
    const simdSupported = await this.checkSimdSupport();
    const threadsSupported = await this.checkThreadsSupport();

    // Estimate speed tiers based on cores and device type
    const cpuSpeedTier = this.estimateCpuSpeedTier(cpuCores, deviceType);
    const ioSpeedTier = this.estimateIoSpeedTier(deviceType);

    return {
      cpuCores,
      availableMemory,
      deviceType,
      gpuAvailable: 'gpu' in navigator,
      simdSupported,
      threadsSupported,
      cpuSpeedTier,
      ioSpeedTier,
    };
  }

  /**
   * Detect device type
   */
  private detectDeviceType(): HardwareProfile['deviceType'] {
    const ua = navigator.userAgent.toLowerCase();
    
    if (/mobile|android|iphone|ipad|ipod/.test(ua)) {
      if (/ipad|tablet/.test(ua)) return 'tablet';
      return 'mobile';
    }
    
    if (/macbook|laptop/.test(ua) || (navigator.maxTouchPoints > 0 && navigator.hardwareConcurrency <= 8)) {
      return 'laptop';
    }
    
    return 'desktop';
  }

  /**
   * Check SIMD support
   */
  private async checkSimdSupport(): Promise<boolean> {
    try {
      const simdTest = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
        0x03, 0x02, 0x01, 0x00,
        0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0b,
      ]);
      await WebAssembly.compile(simdTest);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check threads support
   */
  private async checkThreadsSupport(): Promise<boolean> {
    try {
      if (typeof SharedArrayBuffer === 'undefined') return false;
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
      return memory.buffer instanceof SharedArrayBuffer;
    } catch {
      return false;
    }
  }

  /**
   * Estimate CPU speed tier (1-10)
   */
  private estimateCpuSpeedTier(cores: number, deviceType: HardwareProfile['deviceType']): number {
    let baseTier = Math.min(cores / 2, 5);
    
    switch (deviceType) {
      case 'desktop': baseTier += 3; break;
      case 'laptop': baseTier += 2; break;
      case 'tablet': baseTier += 1; break;
      case 'mobile': baseTier += 0; break;
    }
    
    return Math.min(Math.max(Math.round(baseTier), 1), 10);
  }

  /**
   * Estimate I/O speed tier (1-10)
   */
  private estimateIoSpeedTier(deviceType: HardwareProfile['deviceType']): number {
    switch (deviceType) {
      case 'desktop': return 8;
      case 'laptop': return 7;
      case 'tablet': return 5;
      case 'mobile': return 4;
      default: return 5;
    }
  }

  /**
   * Update file info
   */
  updateFileInfo(fileType: string, fileSize: number): void {
    this.currentSignals.fileType = fileType;
    this.currentSignals.fileSize = fileSize;
  }

  /**
   * Record chunk processing time
   */
  recordChunkTime(timeMs: number): void {
    this.chunkTimes.push(timeMs);
    
    // Keep last 100 samples
    if (this.chunkTimes.length > 100) {
      this.chunkTimes.shift();
    }
    
    // Calculate average
    const avg = this.chunkTimes.reduce((a, b) => a + b, 0) / this.chunkTimes.length;
    this.currentSignals.avgChunkTimeMs = avg;
  }

  /**
   * Update worker load
   */
  updateWorkerLoad(loadPercent: number): void {
    this.currentSignals.workerLoadPercent = loadPercent;
  }

  /**
   * Record WASM stall event
   */
  recordWasmStall(): void {
    this.stallEvents++;
    this.currentSignals.wasmStallCount = this.stallEvents;
  }

  /**
   * Update memory usage
   */
  updateMemoryUsage(usage: number, limit: number): void {
    this.currentSignals.memoryUsage = usage;
    this.currentSignals.memoryLimit = limit;
  }

  /**
   * Update throughput
   */
  updateThroughput(bytesPerSecond: number): void {
    this.currentSignals.throughputBps = bytesPerSecond;
  }

  /**
   * Update archive info
   */
  updateArchiveInfo(fileCount: number, chunkCount: number): void {
    this.currentSignals.fileCount = fileCount;
    this.currentSignals.chunkCount = chunkCount;
  }

  /**
   * Get current telemetry signals
   */
  getSignals(history?: HistoricalPerformance): AITelemetrySignals {
    if (!this.hardwareProfile) {
      throw new Error('Telemetry collector not initialized');
    }

    return {
      fileType: this.currentSignals.fileType || 'application/octet-stream',
      fileSize: this.currentSignals.fileSize || 0,
      avgChunkTimeMs: this.currentSignals.avgChunkTimeMs || 0,
      workerLoadPercent: this.currentSignals.workerLoadPercent || 0,
      wasmStallCount: this.stallEvents,
      memoryUsage: this.currentSignals.memoryUsage || 0,
      memoryLimit: this.currentSignals.memoryLimit || 512 * 1024 * 1024,
      throughputBps: this.currentSignals.throughputBps || 0,
      fileCount: this.currentSignals.fileCount || 0,
      chunkCount: this.currentSignals.chunkCount || 0,
      hardware: this.hardwareProfile,
      history,
    };
  }

  /**
   * Reset for new job
   */
  reset(): void {
    this.currentSignals = {};
    this.chunkTimes = [];
    this.stallEvents = 0;
  }

  /**
   * Get hardware profile
   */
  getHardwareProfile(): HardwareProfile | null {
    return this.hardwareProfile;
  }
}

/**
 * Create file type stats from samples
 */
export function createFileTypeStats(
  fileType: string,
  samples: Array<{ ratio: number; chunkSize: number; mode: 'fast' | 'strong' | 'auto'; speedMBps: number }>
): FileTypeStats {
  if (samples.length === 0) {
    return {
      fileType,
      sampleCount: 0,
      avgRatio: 1,
      bestChunkSize: 4 * 1024 * 1024,
      bestMode: 'auto',
      avgSpeedMBps: 0,
    };
  }

  const avgRatio = samples.reduce((a, s) => a + s.ratio, 0) / samples.length;
  const avgSpeedMBps = samples.reduce((a, s) => a + s.speedMBps, 0) / samples.length;
  
  // Find best chunk size (mode of best performers)
  const chunkSizeCounts = new Map<number, number>();
  samples.forEach(s => {
    chunkSizeCounts.set(s.chunkSize, (chunkSizeCounts.get(s.chunkSize) || 0) + 1);
  });
  let bestChunkSize = 4 * 1024 * 1024;
  let maxCount = 0;
  chunkSizeCounts.forEach((count, size) => {
    if (count > maxCount) {
      maxCount = count;
      bestChunkSize = size;
    }
  });

  // Find best mode
  const modeCounts = new Map<string, number>();
  samples.forEach(s => {
    modeCounts.set(s.mode, (modeCounts.get(s.mode) || 0) + 1);
  });
  let bestMode: 'fast' | 'strong' | 'auto' = 'auto';
  maxCount = 0;
  modeCounts.forEach((count, mode) => {
    if (count > maxCount) {
      maxCount = count;
      bestMode = mode as 'fast' | 'strong' | 'auto';
    }
  });

  return {
    fileType,
    sampleCount: samples.length,
    avgRatio,
    bestChunkSize,
    bestMode,
    avgSpeedMBps,
  };
}

// Singleton instance
let collectorInstance: TelemetryCollector | null = null;

/**
 * Get telemetry collector instance
 */
export function getTelemetryCollector(): TelemetryCollector {
  if (!collectorInstance) {
    collectorInstance = new TelemetryCollector();
  }
  return collectorInstance;
}
