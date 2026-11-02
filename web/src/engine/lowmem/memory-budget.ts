/**
 * SPK Hyper-Low-Memory Mode - Memory Budget Controller
 * Creator: OJ Treasure Onazi
 * 
 * Section 1: Memory Budget Controller
 * - Monitors current RAM usage
 * - Allocate/release memory tracking
 * - Triggers fallback at 80% threshold
 */

import {
  KB, MB, GB,
  MEMORY_CONSTANTS,
  type MemoryState,
  type MemoryPressureLevel,
  type AllocationRequest,
  type AllocationResult,
  type LowMemEvent,
  type LowMemEventHandler,
  type LowMemConfig,
  DEFAULT_LOWMEM_CONFIG,
} from './types';

// ============================================================================
// MEMORY BUDGET CONTROLLER
// ============================================================================

export class MemoryBudgetController {
  private config: LowMemConfig;
  private maxRAM: number;
  private allocated = 0;
  private peak = 0;
  private allocations = new Map<string, number>();
  private eventHandlers: LowMemEventHandler[] = [];
  private lastPressureLevel: MemoryPressureLevel = 'low';
  private pressureHistory: { level: MemoryPressureLevel; timestamp: number }[] = [];
  
  // Stability tracking
  private stableStartTime = 0;
  private lastStateChange = Date.now();

  constructor(maxRAM?: number, config?: Partial<LowMemConfig>) {
    this.config = { ...DEFAULT_LOWMEM_CONFIG, ...config };
    
    // Calculate SPK_MAX_RAM = TARGET_RAM - SAFE_MARGIN
    const targetRAM = maxRAM ?? this.config.targetRAM;
    this.maxRAM = Math.max(
      MEMORY_CONSTANTS.MIN_BUDGET,
      targetRAM - this.config.safeMargin
    );
  }

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Estimate current RAM usage from various sources
   */
  estimateRAM(): MemoryState {
    let jsHeapUsed = 0;
    let wasmPages = 0;
    
    // Try to get JS heap info (Chrome/Edge)
    if (typeof performance !== 'undefined' && (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory) {
      jsHeapUsed = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    }
    
    // Estimate WASM pages from our tracking
    // Each WASM page is 64KB
    wasmPages = Math.ceil(this.getAllocationByPurpose('wasm') / (64 * KB));
    
    const usagePercent = this.allocated / this.maxRAM;
    const pressureLevel = this.calculatePressureLevel(usagePercent);
    
    return {
      allocated: this.allocated,
      peak: this.peak,
      available: this.maxRAM - this.allocated,
      budget: this.maxRAM,
      pressureLevel,
      usagePercent,
      jsHeapUsed,
      wasmPages,
      timestamp: Date.now(),
    };
  }

  /**
   * Allocate memory from budget
   */
  allocate(request: AllocationRequest): AllocationResult {
    const { id, bytes, purpose, priority } = request;
    
    // Check if already allocated
    if (this.allocations.has(id)) {
      const existing = this.allocations.get(id)!;
      if (existing === bytes) {
        return {
          success: true,
          allocated: bytes,
          remainingBudget: this.maxRAM - this.allocated,
          pressureLevel: this.lastPressureLevel,
        };
      }
      // Release old allocation first
      this.release(id);
    }
    
    // Check safety limits
    if (this.config.strictMode) {
      const limitCheck = this.checkSafetyLimits(bytes, purpose);
      if (!limitCheck.allowed) {
        return {
          success: false,
          allocated: 0,
          remainingBudget: this.maxRAM - this.allocated,
          pressureLevel: this.lastPressureLevel,
          recommendation: limitCheck.recommendation,
        };
      }
    }
    
    // Calculate new total
    const newTotal = this.allocated + bytes;
    const newUsagePercent = newTotal / this.maxRAM;
    const newPressureLevel = this.calculatePressureLevel(newUsagePercent);
    
    // Check if allocation would exceed budget
    if (newTotal > this.maxRAM) {
      // Try to allow critical priority even over budget
      if (priority === 'critical' && newUsagePercent <= 1.1) {
        // Allow 10% overflow for critical
      } else {
        return {
          success: false,
          allocated: 0,
          remainingBudget: this.maxRAM - this.allocated,
          pressureLevel: newPressureLevel,
          recommendation: this.getRecommendation(newPressureLevel),
        };
      }
    }
    
    // Perform allocation
    this.allocations.set(id, bytes);
    this.allocated = newTotal;
    this.peak = Math.max(this.peak, this.allocated);
    
    // Emit event
    this.emit({ type: 'memory-allocated', bytes, purpose });
    
    // Check for pressure level change
    if (newPressureLevel !== this.lastPressureLevel) {
      this.emit({ 
        type: 'pressure-change', 
        from: this.lastPressureLevel, 
        to: newPressureLevel 
      });
      this.lastPressureLevel = newPressureLevel;
      this.lastStateChange = Date.now();
      this.pressureHistory.push({ level: newPressureLevel, timestamp: Date.now() });
      
      // Trim history
      if (this.pressureHistory.length > 100) {
        this.pressureHistory.shift();
      }
    }
    
    return {
      success: true,
      allocated: bytes,
      remainingBudget: this.maxRAM - this.allocated,
      pressureLevel: newPressureLevel,
      recommendation: newPressureLevel !== 'low' ? this.getRecommendation(newPressureLevel) : undefined,
    };
  }

  /**
   * Allocate with simple bytes parameter
   */
  allocateBytes(bytes: number, purpose: string = 'buffer'): AllocationResult {
    return this.allocate({
      id: `alloc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      bytes,
      purpose: purpose as AllocationRequest['purpose'],
      priority: 'normal',
    });
  }

  /**
   * Release memory by allocation ID
   */
  release(id: string): number {
    const bytes = this.allocations.get(id);
    if (bytes === undefined) {
      return 0;
    }
    
    this.allocations.delete(id);
    this.allocated -= bytes;
    this.allocated = Math.max(0, this.allocated);
    
    this.emit({ type: 'memory-released', bytes });
    
    // Check for pressure level change
    const newPressureLevel = this.calculatePressureLevel(this.allocated / this.maxRAM);
    if (newPressureLevel !== this.lastPressureLevel) {
      this.emit({ 
        type: 'pressure-change', 
        from: this.lastPressureLevel, 
        to: newPressureLevel 
      });
      this.lastPressureLevel = newPressureLevel;
      this.lastStateChange = Date.now();
    }
    
    return bytes;
  }

  /**
   * Release memory by bytes amount
   */
  releaseBytes(bytes: number): void {
    this.allocated -= bytes;
    this.allocated = Math.max(0, this.allocated);
    this.emit({ type: 'memory-released', bytes });
    
    const newPressureLevel = this.calculatePressureLevel(this.allocated / this.maxRAM);
    if (newPressureLevel !== this.lastPressureLevel) {
      this.emit({ 
        type: 'pressure-change', 
        from: this.lastPressureLevel, 
        to: newPressureLevel 
      });
      this.lastPressureLevel = newPressureLevel;
    }
  }

  /**
   * Check if system is under memory pressure
   */
  underPressure(): boolean {
    return this.lastPressureLevel !== 'low';
  }

  /**
   * Check if system is at critical pressure
   */
  isCritical(): boolean {
    return this.lastPressureLevel === 'critical' || this.lastPressureLevel === 'emergency';
  }

  /**
   * Check if system is in emergency state
   */
  isEmergency(): boolean {
    return this.lastPressureLevel === 'emergency';
  }

  // ---------------------------------------------------------------------------
  // STABILITY TRACKING
  // ---------------------------------------------------------------------------

  /**
   * Check if memory has been stable for given duration
   */
  isStable(durationMs: number = 5000): boolean {
    return Date.now() - this.lastStateChange >= durationMs;
  }

  /**
   * Get duration of current stability
   */
  getStabilityDuration(): number {
    return Date.now() - this.lastStateChange;
  }

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Get current pressure level
   */
  getPressureLevel(): MemoryPressureLevel {
    return this.lastPressureLevel;
  }

  /**
   * Get allocation by purpose
   */
  getAllocationByPurpose(purpose: string): number {
    let total = 0;
    for (const [id, bytes] of this.allocations) {
      if (id.includes(purpose)) {
        total += bytes;
      }
    }
    return total;
  }

  /**
   * Get total allocated
   */
  getAllocated(): number {
    return this.allocated;
  }

  /**
   * Get available budget
   */
  getAvailable(): number {
    return this.maxRAM - this.allocated;
  }

  /**
   * Get max RAM budget
   */
  getMaxRAM(): number {
    return this.maxRAM;
  }

  /**
   * Get peak usage
   */
  getPeak(): number {
    return this.peak;
  }

  /**
   * Get usage percentage (0-1)
   */
  getUsagePercent(): number {
    return this.allocated / this.maxRAM;
  }

  // ---------------------------------------------------------------------------
  // SAFETY CHECKS
  // ---------------------------------------------------------------------------

  /**
   * Check safety limits for allocation
   */
  private checkSafetyLimits(
    bytes: number, 
    purpose: string
  ): { allowed: boolean; recommendation?: AllocationResult['recommendation'] } {
    const limits = this.config.safetyLimits;
    
    // Check WASM buffer limit
    if (purpose === 'wasm') {
      const currentWasm = this.getAllocationByPurpose('wasm');
      if (currentWasm + bytes > limits.maxWasmBuffer) {
        this.emit({ type: 'safety-limit-hit', limit: 'maxWasmBuffer', value: limits.maxWasmBuffer });
        return { allowed: false, recommendation: 'reduce_chunk_size' };
      }
    }
    
    // Check metadata limit
    if (purpose === 'metadata') {
      const currentMeta = this.getAllocationByPurpose('metadata');
      if (currentMeta + bytes > limits.maxMetadataOverhead) {
        this.emit({ type: 'safety-limit-hit', limit: 'maxMetadataOverhead', value: limits.maxMetadataOverhead });
        return { allowed: false, recommendation: 'flush_buffers' };
      }
    }
    
    // Check chunk count limit
    if (purpose === 'chunk') {
      let chunkCount = 0;
      for (const id of this.allocations.keys()) {
        if (id.includes('chunk')) chunkCount++;
      }
      if (chunkCount >= limits.maxConcurrentChunks) {
        this.emit({ type: 'safety-limit-hit', limit: 'maxConcurrentChunks', value: limits.maxConcurrentChunks });
        return { allowed: false, recommendation: 'flush_buffers' };
      }
    }
    
    return { allowed: true };
  }

  /**
   * Calculate pressure level from usage
   */
  private calculatePressureLevel(usagePercent: number): MemoryPressureLevel {
    if (usagePercent >= MEMORY_CONSTANTS.EMERGENCY_THRESHOLD) return 'emergency';
    if (usagePercent >= MEMORY_CONSTANTS.CRITICAL_THRESHOLD) return 'critical';
    if (usagePercent >= MEMORY_CONSTANTS.PRESSURE_THRESHOLD) return 'high';
    if (usagePercent >= 0.6) return 'medium';
    return 'low';
  }

  /**
   * Get recommendation based on pressure level
   */
  private getRecommendation(level: MemoryPressureLevel): AllocationResult['recommendation'] {
    switch (level) {
      case 'emergency':
        return 'emergency_gc';
      case 'critical':
        return 'reduce_workers';
      case 'high':
        return 'reduce_chunk_size';
      case 'medium':
        return 'flush_buffers';
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // EMERGENCY ACTIONS
  // ---------------------------------------------------------------------------

  /**
   * Force release all allocations of a purpose
   */
  forceReleaseByPurpose(purpose: string): number {
    let released = 0;
    const toDelete: string[] = [];
    
    for (const [id, bytes] of this.allocations) {
      if (id.includes(purpose)) {
        toDelete.push(id);
        released += bytes;
      }
    }
    
    for (const id of toDelete) {
      this.allocations.delete(id);
    }
    
    this.allocated -= released;
    this.allocated = Math.max(0, this.allocated);
    
    if (released > 0) {
      this.emit({ type: 'emergency-gc', savedBytes: released });
    }
    
    return released;
  }

  /**
   * Emergency GC - release all non-critical allocations
   */
  emergencyGC(): number {
    let released = 0;
    const toDelete: string[] = [];
    
    for (const [id, bytes] of this.allocations) {
      // Keep only critical allocations
      if (!id.includes('critical')) {
        toDelete.push(id);
        released += bytes;
      }
    }
    
    for (const id of toDelete) {
      this.allocations.delete(id);
    }
    
    this.allocated -= released;
    this.allocated = Math.max(0, this.allocated);
    
    this.emit({ type: 'emergency-gc', savedBytes: released });
    
    return released;
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  /**
   * Register event handler
   */
  on(handler: LowMemEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Emit event
   */
  private emit(event: LowMemEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[MemoryBudgetController] Event handler error:', error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // RESET
  // ---------------------------------------------------------------------------

  /**
   * Reset controller state
   */
  reset(): void {
    this.allocated = 0;
    this.peak = 0;
    this.allocations.clear();
    this.lastPressureLevel = 'low';
    this.pressureHistory = [];
    this.lastStateChange = Date.now();
  }

  /**
   * Update max RAM budget
   */
  setMaxRAM(maxRAM: number): void {
    this.maxRAM = Math.max(MEMORY_CONSTANTS.MIN_BUDGET, maxRAM - this.config.safeMargin);
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let controllerInstance: MemoryBudgetController | null = null;

export function getMemoryBudgetController(
  maxRAM?: number,
  config?: Partial<LowMemConfig>
): MemoryBudgetController {
  if (!controllerInstance) {
    controllerInstance = new MemoryBudgetController(maxRAM, config);
  }
  return controllerInstance;
}

export function resetMemoryBudgetController(): void {
  controllerInstance?.reset();
  controllerInstance = null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Detect available system memory
 */
export function detectSystemMemory(): number {
  // Try navigator.deviceMemory (GB)
  if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
    return (navigator as Navigator & { deviceMemory: number }).deviceMemory * GB;
  }
  
  // Default to 2GB assumption
  return 2 * GB;
}

/**
 * Recommend target RAM based on system
 */
export function recommendTargetRAM(): number {
  const systemMemory = detectSystemMemory();
  
  // Use 50% of system memory, capped at 4GB
  const target = Math.min(systemMemory * 0.5, 4 * GB);
  
  // Ensure minimum of 512MB
  return Math.max(512 * MB, target);
}

/**
 * Format bytes for display
 */
export function formatMemory(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(2)} KB`;
  return `${bytes} B`;
}
