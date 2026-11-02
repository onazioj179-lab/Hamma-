/**
 * SPK Capability Detector
 * 
 * Detects device capabilities to determine the best compression strategy.
 * Used to route to Workers, WASM, or mobile fallback compressor.
 * 
 * Capabilities detected:
 * - WebWorker support (module workers, shared workers)
 * - WebAssembly support (basic, SIMD, threads)
 * - SharedArrayBuffer availability
 * - Device memory and performance tier
 * - Network conditions
 * - Browser and platform identification
 * 
 * @module capability-detector
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export type CompressionStrategy = 
  | 'worker-wasm'      // Full power: Workers + WASM + SharedArrayBuffer
  | 'worker-js'        // Workers without WASM
  | 'main-wasm'        // Main thread WASM (no workers)
  | 'main-js'          // Pure JS fallback (mobile)
  | 'streaming'        // Low-memory streaming mode
  | 'minimal';         // Ultra-low resource mode

export type DeviceClass = 'high' | 'medium' | 'low' | 'ultra-low';
export type NetworkClass = 'fast' | 'medium' | 'slow' | 'offline';
export type PlatformType = 'desktop' | 'tablet' | 'mobile' | 'unknown';

export interface Capabilities {
  // Core features
  webWorkers: boolean;
  moduleWorkers: boolean;
  sharedWorkers: boolean;
  webAssembly: boolean;
  wasmSimd: boolean;
  wasmThreads: boolean;
  sharedArrayBuffer: boolean;
  atomics: boolean;
  
  // Performance indicators
  hardwareConcurrency: number;
  deviceMemory: number | null;
  deviceClass: DeviceClass;
  
  // Platform
  platform: PlatformType;
  isIOS: boolean;
  isAndroid: boolean;
  isSafari: boolean;
  isChrome: boolean;
  isFirefox: boolean;
  
  // Network
  networkClass: NetworkClass;
  effectiveType: string | null;
  downlink: number | null;
  saveData: boolean;
  
  // Computed
  recommendedStrategy: CompressionStrategy;
  maxChunkSize: number;
  optimalWorkerCount: number;
  supportsStreaming: boolean;
}

export interface CapabilityDetectorConfig {
  /** Force a specific strategy (for testing) */
  forceStrategy?: CompressionStrategy;
  /** Custom memory threshold for low-mem mode (MB) */
  lowMemoryThreshold?: number;
  /** Enable aggressive fallback (safer but slower) */
  aggressiveFallback?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: CapabilityDetectorConfig = {
  lowMemoryThreshold: 2048, // 2GB
  aggressiveFallback: false,
};

// Chunk sizes by device class
const CHUNK_SIZES: Record<DeviceClass, number> = {
  'high': 4 * 1024 * 1024,    // 4MB
  'medium': 1 * 1024 * 1024,  // 1MB
  'low': 256 * 1024,          // 256KB
  'ultra-low': 64 * 1024,     // 64KB
};

// Worker counts by device class
const WORKER_COUNTS: Record<DeviceClass, number> = {
  'high': 8,
  'medium': 4,
  'low': 2,
  'ultra-low': 0,
};

// ============================================================================
// Capability Detector
// ============================================================================

class CapabilityDetectorImpl {
  private config: CapabilityDetectorConfig;
  private cachedCapabilities: Capabilities | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_DURATION = 60000; // 1 minute

  constructor(config: Partial<CapabilityDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect all capabilities (cached)
   */
  async detect(): Promise<Capabilities> {
    const now = Date.now();
    if (this.cachedCapabilities && now - this.cacheTime < this.CACHE_DURATION) {
      return this.cachedCapabilities;
    }

    const capabilities = await this.detectAll();
    this.cachedCapabilities = capabilities;
    this.cacheTime = now;
    return capabilities;
  }

  /**
   * Force re-detection (useful after conditions change)
   */
  async refresh(): Promise<Capabilities> {
    this.cachedCapabilities = null;
    return this.detect();
  }

  /**
   * Quick strategy check (uses cache)
   */
  async getStrategy(): Promise<CompressionStrategy> {
    if (this.config.forceStrategy) {
      return this.config.forceStrategy;
    }
    const caps = await this.detect();
    return caps.recommendedStrategy;
  }

  /**
   * Check if device is mobile
   */
  async isMobile(): Promise<boolean> {
    const caps = await this.detect();
    return caps.platform === 'mobile' || caps.isIOS || caps.isAndroid;
  }

  /**
   * Check if full worker support is available
   */
  async hasFullWorkerSupport(): Promise<boolean> {
    const caps = await this.detect();
    return caps.webWorkers && caps.sharedArrayBuffer && caps.webAssembly;
  }

  // ==========================================================================
  // Detection Methods
  // ==========================================================================

  private async detectAll(): Promise<Capabilities> {
    // Parallel detection
    const [
      workerCaps,
      wasmCaps,
      memoryCaps,
      platformInfo,
      networkInfo,
    ] = await Promise.all([
      this.detectWorkers(),
      this.detectWasm(),
      this.detectMemory(),
      this.detectPlatform(),
      this.detectNetwork(),
    ]);

    // Compute device class
    const deviceClass = this.computeDeviceClass(
      memoryCaps.deviceMemory,
      memoryCaps.hardwareConcurrency,
      wasmCaps,
      platformInfo
    );

    // Compute strategy
    const recommendedStrategy = this.computeStrategy(
      workerCaps,
      wasmCaps,
      memoryCaps,
      platformInfo,
      networkInfo,
      deviceClass
    );

    return {
      // Workers
      webWorkers: workerCaps.webWorkers,
      moduleWorkers: workerCaps.moduleWorkers,
      sharedWorkers: workerCaps.sharedWorkers,
      
      // WASM
      webAssembly: wasmCaps.webAssembly,
      wasmSimd: wasmCaps.wasmSimd,
      wasmThreads: wasmCaps.wasmThreads,
      sharedArrayBuffer: wasmCaps.sharedArrayBuffer,
      atomics: wasmCaps.atomics,
      
      // Memory
      hardwareConcurrency: memoryCaps.hardwareConcurrency,
      deviceMemory: memoryCaps.deviceMemory,
      deviceClass,
      
      // Platform
      ...platformInfo,
      
      // Network
      ...networkInfo,
      
      // Computed
      recommendedStrategy,
      maxChunkSize: CHUNK_SIZES[deviceClass],
      optimalWorkerCount: Math.min(
        WORKER_COUNTS[deviceClass],
        memoryCaps.hardwareConcurrency - 1
      ),
      supportsStreaming: workerCaps.webWorkers || typeof ReadableStream !== 'undefined',
    };
  }

  // ==========================================================================
  // Worker Detection
  // ==========================================================================

  private async detectWorkers(): Promise<{
    webWorkers: boolean;
    moduleWorkers: boolean;
    sharedWorkers: boolean;
  }> {
    const webWorkers = typeof Worker !== 'undefined';
    
    // Module workers (ES modules in workers)
    let moduleWorkers = false;
    if (webWorkers) {
      try {
        // Try to create a module worker with blob
        const blob = new Blob(
          ['export default true;'],
          { type: 'text/javascript' }
        );
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url, { type: 'module' });
        worker.terminate();
        URL.revokeObjectURL(url);
        moduleWorkers = true;
      } catch {
        moduleWorkers = false;
      }
    }
    
    // Shared workers
    const sharedWorkers = typeof SharedWorker !== 'undefined';

    return { webWorkers, moduleWorkers, sharedWorkers };
  }

  // ==========================================================================
  // WASM Detection
  // ==========================================================================

  private async detectWasm(): Promise<{
    webAssembly: boolean;
    wasmSimd: boolean;
    wasmThreads: boolean;
    sharedArrayBuffer: boolean;
    atomics: boolean;
  }> {
    // Basic WASM
    const webAssembly = typeof WebAssembly !== 'undefined';
    
    // SharedArrayBuffer (affected by COOP/COEP headers)
    let sharedArrayBuffer = false;
    try {
      sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
      if (sharedArrayBuffer) {
        // Actually try to use it
        new SharedArrayBuffer(1);
      }
    } catch {
      sharedArrayBuffer = false;
    }
    
    // Atomics
    const atomics = typeof Atomics !== 'undefined' && sharedArrayBuffer;
    
    // SIMD support
    let wasmSimd = false;
    if (webAssembly) {
      try {
        // SIMD validation magic bytes
        wasmSimd = WebAssembly.validate(new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, // Magic
          0x01, 0x00, 0x00, 0x00, // Version
          0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // Type section
          0x03, 0x02, 0x01, 0x00, // Function section
          0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0b // Code with v128
        ]));
      } catch {
        wasmSimd = false;
      }
    }
    
    // Threads (requires SharedArrayBuffer)
    let wasmThreads = false;
    if (webAssembly && sharedArrayBuffer) {
      try {
        // Threads validation magic bytes
        wasmThreads = WebAssembly.validate(new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, // Magic
          0x01, 0x00, 0x00, 0x00, // Version
          0x05, 0x04, 0x01, 0x03, 0x01, 0x01, // Memory section with shared flag
        ]));
      } catch {
        wasmThreads = false;
      }
    }

    return { webAssembly, wasmSimd, wasmThreads, sharedArrayBuffer, atomics };
  }

  // ==========================================================================
  // Memory Detection
  // ==========================================================================

  private detectMemory(): {
    hardwareConcurrency: number;
    deviceMemory: number | null;
  } {
    const hardwareConcurrency = navigator.hardwareConcurrency || 4;
    
    // Device memory API (Chrome only)
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || null;

    return { hardwareConcurrency, deviceMemory };
  }

  // ==========================================================================
  // Platform Detection
  // ==========================================================================

  private detectPlatform(): {
    platform: PlatformType;
    isIOS: boolean;
    isAndroid: boolean;
    isSafari: boolean;
    isChrome: boolean;
    isFirefox: boolean;
  } {
    const ua = navigator.userAgent.toLowerCase();
    
    // iOS detection
    const isIOS = /iphone|ipad|ipod/.test(ua) || 
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    // Android detection  
    const isAndroid = /android/.test(ua);
    
    // Browser detection
    const isSafari = /safari/.test(ua) && !/chrome/.test(ua);
    const isChrome = /chrome/.test(ua) && !/edge/.test(ua);
    const isFirefox = /firefox/.test(ua);
    
    // Platform type
    let platform: PlatformType = 'unknown';
    if (isIOS || isAndroid) {
      // Check if tablet
      const isTablet = /ipad/.test(ua) || 
        (isAndroid && !/mobile/.test(ua)) ||
        (window.innerWidth > 768 && navigator.maxTouchPoints > 0);
      platform = isTablet ? 'tablet' : 'mobile';
    } else if (/windows|macintosh|linux/.test(ua)) {
      platform = 'desktop';
    }

    return { platform, isIOS, isAndroid, isSafari, isChrome, isFirefox };
  }

  // ==========================================================================
  // Network Detection
  // ==========================================================================

  private detectNetwork(): {
    networkClass: NetworkClass;
    effectiveType: string | null;
    downlink: number | null;
    saveData: boolean;
  } {
    const connection = (navigator as Navigator & { 
      connection?: {
        effectiveType?: string;
        downlink?: number;
        saveData?: boolean;
      }
    }).connection;
    
    if (!connection) {
      return {
        networkClass: 'medium',
        effectiveType: null,
        downlink: null,
        saveData: false,
      };
    }
    
    const effectiveType = connection.effectiveType || null;
    const downlink = connection.downlink || null;
    const saveData = connection.saveData || false;
    
    // Compute network class
    let networkClass: NetworkClass = 'medium';
    if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
      networkClass = 'slow';
    } else if (effectiveType === '4g' || (downlink && downlink > 5)) {
      networkClass = 'fast';
    } else if (effectiveType === '3g') {
      networkClass = 'medium';
    }
    
    // Check if offline
    if (!navigator.onLine) {
      networkClass = 'offline';
    }

    return { networkClass, effectiveType, downlink, saveData };
  }

  // ==========================================================================
  // Computation Methods
  // ==========================================================================

  private computeDeviceClass(
    deviceMemory: number | null,
    cores: number,
    wasmCaps: { webAssembly: boolean; wasmSimd: boolean; wasmThreads: boolean },
    platformInfo: { platform: PlatformType; isIOS: boolean }
  ): DeviceClass {
    // iOS gets medium at best due to memory restrictions
    if (platformInfo.isIOS) {
      return deviceMemory && deviceMemory >= 4 ? 'medium' : 'low';
    }
    
    // Score-based classification
    let score = 0;
    
    // Memory contribution (0-3 points)
    if (deviceMemory) {
      if (deviceMemory >= 8) score += 3;
      else if (deviceMemory >= 4) score += 2;
      else if (deviceMemory >= 2) score += 1;
    } else {
      score += 1; // Unknown, assume medium
    }
    
    // Core contribution (0-3 points)
    if (cores >= 8) score += 3;
    else if (cores >= 4) score += 2;
    else if (cores >= 2) score += 1;
    
    // WASM contribution (0-2 points)
    if (wasmCaps.wasmSimd) score += 1;
    if (wasmCaps.wasmThreads) score += 1;
    
    // Platform contribution
    if (platformInfo.platform === 'desktop') score += 1;
    else if (platformInfo.platform === 'mobile') score -= 1;
    
    // Map score to class
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    if (score >= 2) return 'low';
    return 'ultra-low';
  }

  private computeStrategy(
    workerCaps: { webWorkers: boolean; moduleWorkers: boolean },
    wasmCaps: { webAssembly: boolean; sharedArrayBuffer: boolean; wasmThreads: boolean },
    memoryCaps: { deviceMemory: number | null },
    platformInfo: { isIOS: boolean; isSafari: boolean; platform: PlatformType },
    networkInfo: { networkClass: NetworkClass; saveData: boolean },
    deviceClass: DeviceClass
  ): CompressionStrategy {
    // Check for forced low-memory mode
    if (
      memoryCaps.deviceMemory && 
      memoryCaps.deviceMemory * 1024 < (this.config.lowMemoryThreshold || 2048)
    ) {
      return deviceClass === 'ultra-low' ? 'minimal' : 'streaming';
    }
    
    // iOS Safari special case - no SharedArrayBuffer
    if (platformInfo.isIOS || (platformInfo.isSafari && !wasmCaps.sharedArrayBuffer)) {
      return 'main-js';
    }
    
    // Check aggressive fallback
    if (this.config.aggressiveFallback) {
      return 'main-js';
    }
    
    // Network-based adjustments
    if (networkInfo.saveData || networkInfo.networkClass === 'slow') {
      return deviceClass === 'ultra-low' ? 'minimal' : 'streaming';
    }
    
    // Full capability path
    if (
      workerCaps.webWorkers && 
      wasmCaps.webAssembly && 
      wasmCaps.sharedArrayBuffer &&
      deviceClass !== 'ultra-low'
    ) {
      return 'worker-wasm';
    }
    
    // Workers without WASM
    if (workerCaps.webWorkers && !wasmCaps.webAssembly) {
      return 'worker-js';
    }
    
    // WASM without workers
    if (wasmCaps.webAssembly && !workerCaps.webWorkers) {
      return 'main-wasm';
    }
    
    // Fallback
    return deviceClass === 'ultra-low' ? 'minimal' : 'main-js';
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global capability detector instance
 */
export const CapabilityDetector = new CapabilityDetectorImpl();

/**
 * Create a new detector with custom config
 */
export function createCapabilityDetector(
  config?: Partial<CapabilityDetectorConfig>
): CapabilityDetectorImpl {
  return new CapabilityDetectorImpl(config);
}

/**
 * Quick capability check
 */
export async function detectCapabilities(): Promise<Capabilities> {
  return CapabilityDetector.detect();
}

/**
 * Quick strategy check
 */
export async function getRecommendedStrategy(): Promise<CompressionStrategy> {
  return CapabilityDetector.getStrategy();
}

/**
 * Check if running on mobile
 */
export async function isMobileDevice(): Promise<boolean> {
  return CapabilityDetector.isMobile();
}

export default CapabilityDetector;
