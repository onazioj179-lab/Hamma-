/**
 * SPK Hyper-Low-Memory Mode - Safety Limits Enforcer
 * Creator: OJ Treasure Onazi
 * 
 * Section 8: Safety Limits for 1GB RAM Devices
 * - Hard caps on concurrent operations
 * - Emergency stop mechanisms
 * - Graceful degradation
 * - Testing profile for low-end devices
 */

import {
  KB, MB, GB,
  type SafetyLimits,
  DEFAULT_SAFETY_LIMITS,
  type LowMemConfig,
  DEFAULT_LOWMEM_CONFIG,
  type LowMemEvent,
  type LowMemEventHandler,
  MEMORY_CONSTANTS,
} from './types';
import { getMemoryBudgetController } from './memory-budget';

// ============================================================================
// SAFETY TYPES
// ============================================================================

export interface SafetyViolation {
  type: string;
  limit: keyof SafetyLimits;
  current: number;
  allowed: number;
  timestamp: number;
  action: 'blocked' | 'warning' | 'emergency-stop';
}

export interface SafetyState {
  violations: SafetyViolation[];
  emergencyStopActive: boolean;
  lastViolationTime: number;
  consecutiveViolations: number;
  safeMode: boolean;
}

export interface DeviceProfile {
  name: string;
  targetRAM: number;
  safeMargin: number;
  limits: SafetyLimits;
  description: string;
}

// ============================================================================
// DEVICE PROFILES
// ============================================================================

export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  ultra_low: {
    name: 'Ultra Low (512MB)',
    targetRAM: 512 * MB,
    safeMargin: 100 * MB,
    limits: {
      maxConcurrentChunks: 2,
      maxWorkers: 1,
      maxWasmBuffer: 16 * MB,
      maxMetadataOverhead: 15 * MB,
      instantFallbackEnabled: true,
      fallbackChunkMode: 'nano',
    },
    description: 'For devices with 512MB RAM or less',
  },
  
  low: {
    name: 'Low (1GB)',
    targetRAM: 1 * GB,
    safeMargin: 150 * MB,
    limits: {
      maxConcurrentChunks: 4,
      maxWorkers: 2,
      maxWasmBuffer: 32 * MB,
      maxMetadataOverhead: 30 * MB,
      instantFallbackEnabled: true,
      fallbackChunkMode: 'micro',
    },
    description: 'For devices with 1GB RAM',
  },
  
  medium: {
    name: 'Medium (2GB)',
    targetRAM: 2 * GB,
    safeMargin: 200 * MB,
    limits: {
      maxConcurrentChunks: 8,
      maxWorkers: 4,
      maxWasmBuffer: 64 * MB,
      maxMetadataOverhead: 50 * MB,
      instantFallbackEnabled: true,
      fallbackChunkMode: 'small',
    },
    description: 'For devices with 2GB RAM',
  },
  
  standard: {
    name: 'Standard (4GB+)',
    targetRAM: 4 * GB,
    safeMargin: 300 * MB,
    limits: {
      maxConcurrentChunks: 16,
      maxWorkers: 8,
      maxWasmBuffer: 128 * MB,
      maxMetadataOverhead: 100 * MB,
      instantFallbackEnabled: false,
      fallbackChunkMode: 'normal',
    },
    description: 'For devices with 4GB+ RAM',
  },
  
  // Testing profile
  test_extreme: {
    name: 'Test Extreme (256MB)',
    targetRAM: 256 * MB,
    safeMargin: 50 * MB,
    limits: {
      maxConcurrentChunks: 1,
      maxWorkers: 1,
      maxWasmBuffer: 8 * MB,
      maxMetadataOverhead: 8 * MB,
      instantFallbackEnabled: true,
      fallbackChunkMode: 'nano',
    },
    description: 'Extreme testing profile for stress testing',
  },
};

// ============================================================================
// SAFETY ENFORCER
// ============================================================================

export class SafetyEnforcer {
  private limits: SafetyLimits;
  private config: LowMemConfig;
  private memoryController = getMemoryBudgetController();
  private eventHandlers: LowMemEventHandler[] = [];
  
  // State
  private state: SafetyState;
  private currentConcurrentChunks = 0;
  private currentWorkers = 0;
  private currentWasmUsage = 0;
  private currentMetadataUsage = 0;
  
  // Emergency stop callback
  private emergencyStopCallback?: () => void;

  constructor(
    limits?: Partial<SafetyLimits>,
    config?: Partial<LowMemConfig>
  ) {
    this.limits = { ...DEFAULT_SAFETY_LIMITS, ...limits };
    this.config = { ...DEFAULT_LOWMEM_CONFIG, ...config };
    this.state = this.createEmptyState();
    
    // Listen to memory pressure
    this.memoryController.on((event) => {
      if (event.type === 'pressure-change' && event.to === 'emergency') {
        this.triggerEmergencyStop('memory-pressure-emergency');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Check if operation is allowed
   */
  checkOperation(
    operation: 'chunk' | 'worker' | 'wasm' | 'metadata',
    amount: number = 1
  ): { allowed: boolean; reason?: string } {
    if (this.state.emergencyStopActive) {
      return { allowed: false, reason: 'Emergency stop active' };
    }
    
    switch (operation) {
      case 'chunk':
        if (this.currentConcurrentChunks + amount > this.limits.maxConcurrentChunks) {
          this.recordViolation('chunk', 'maxConcurrentChunks', this.currentConcurrentChunks + amount);
          return { 
            allowed: false, 
            reason: `Max concurrent chunks (${this.limits.maxConcurrentChunks}) exceeded` 
          };
        }
        break;
        
      case 'worker':
        if (this.currentWorkers + amount > this.limits.maxWorkers) {
          this.recordViolation('worker', 'maxWorkers', this.currentWorkers + amount);
          return { 
            allowed: false, 
            reason: `Max workers (${this.limits.maxWorkers}) exceeded` 
          };
        }
        break;
        
      case 'wasm':
        if (this.currentWasmUsage + amount > this.limits.maxWasmBuffer) {
          this.recordViolation('wasm', 'maxWasmBuffer', this.currentWasmUsage + amount);
          return { 
            allowed: false, 
            reason: `Max WASM buffer (${this.limits.maxWasmBuffer / MB}MB) exceeded` 
          };
        }
        break;
        
      case 'metadata':
        if (this.currentMetadataUsage + amount > this.limits.maxMetadataOverhead) {
          this.recordViolation('metadata', 'maxMetadataOverhead', this.currentMetadataUsage + amount);
          return { 
            allowed: false, 
            reason: `Max metadata (${this.limits.maxMetadataOverhead / MB}MB) exceeded` 
          };
        }
        break;
    }
    
    return { allowed: true };
  }

  /**
   * Acquire resource
   */
  acquire(
    resource: 'chunk' | 'worker' | 'wasm' | 'metadata',
    amount: number = 1
  ): boolean {
    const check = this.checkOperation(resource, amount);
    if (!check.allowed) {
      this.emit({ type: 'safety-blocked', resource, reason: check.reason });
      return false;
    }
    
    switch (resource) {
      case 'chunk':
        this.currentConcurrentChunks += amount;
        break;
      case 'worker':
        this.currentWorkers += amount;
        break;
      case 'wasm':
        this.currentWasmUsage += amount;
        break;
      case 'metadata':
        this.currentMetadataUsage += amount;
        break;
    }
    
    return true;
  }

  /**
   * Release resource
   */
  release(
    resource: 'chunk' | 'worker' | 'wasm' | 'metadata',
    amount: number = 1
  ): void {
    switch (resource) {
      case 'chunk':
        this.currentConcurrentChunks = Math.max(0, this.currentConcurrentChunks - amount);
        break;
      case 'worker':
        this.currentWorkers = Math.max(0, this.currentWorkers - amount);
        break;
      case 'wasm':
        this.currentWasmUsage = Math.max(0, this.currentWasmUsage - amount);
        break;
      case 'metadata':
        this.currentMetadataUsage = Math.max(0, this.currentMetadataUsage - amount);
        break;
    }
    
    // Check if we can exit safe mode
    if (this.state.safeMode && this.isAllClear()) {
      this.exitSafeMode();
    }
  }

  // ---------------------------------------------------------------------------
  // EMERGENCY HANDLING
  // ---------------------------------------------------------------------------

  /**
   * Trigger emergency stop
   */
  triggerEmergencyStop(reason: string): void {
    if (this.state.emergencyStopActive) return;
    
    this.state.emergencyStopActive = true;
    this.emit({ type: 'emergency-stop', reason });
    
    // Call callback if registered
    if (this.emergencyStopCallback) {
      try {
        this.emergencyStopCallback();
      } catch (error) {
        console.error('[SafetyEnforcer] Emergency callback error:', error);
      }
    }
  }

  /**
   * Reset emergency stop
   */
  resetEmergencyStop(): void {
    if (!this.state.emergencyStopActive) return;
    
    // Only reset if memory pressure is acceptable
    if (this.memoryController.isCritical()) {
      this.emit({ type: 'emergency-reset-blocked', reason: 'memory-still-critical' });
      return;
    }
    
    this.state.emergencyStopActive = false;
    this.emit({ type: 'emergency-reset' });
  }

  /**
   * Set emergency stop callback
   */
  setEmergencyCallback(callback: () => void): void {
    this.emergencyStopCallback = callback;
  }

  /**
   * Enter safe mode (reduced limits)
   */
  enterSafeMode(): void {
    if (this.state.safeMode) return;
    
    this.state.safeMode = true;
    
    // Reduce limits by half
    this.limits = {
      maxConcurrentChunks: Math.max(1, Math.floor(this.limits.maxConcurrentChunks / 2)),
      maxWorkers: Math.max(1, Math.floor(this.limits.maxWorkers / 2)),
      maxWasmBuffer: Math.floor(this.limits.maxWasmBuffer / 2),
      maxMetadataOverhead: Math.floor(this.limits.maxMetadataOverhead / 2),
      instantFallbackEnabled: true,
      fallbackChunkMode: 'nano',
    };
    
    this.emit({ type: 'safe-mode-entered', newLimits: this.limits });
  }

  /**
   * Exit safe mode
   */
  private exitSafeMode(): void {
    if (!this.state.safeMode) return;
    
    this.state.safeMode = false;
    
    // Restore original limits
    this.limits = { ...DEFAULT_SAFETY_LIMITS };
    
    this.emit({ type: 'safe-mode-exited' });
  }

  // ---------------------------------------------------------------------------
  // VIOLATION TRACKING
  // ---------------------------------------------------------------------------

  /**
   * Record a violation
   */
  private recordViolation(
    type: string,
    limit: keyof SafetyLimits,
    current: number
  ): void {
    const limitValue = this.limits[limit];
    const numericValue = typeof limitValue === 'number' ? limitValue : 0;
    
    const violation: SafetyViolation = {
      type,
      limit,
      current,
      allowed: numericValue,
      timestamp: Date.now(),
      action: 'blocked',
    };
    
    this.state.violations.push(violation);
    this.state.lastViolationTime = Date.now();
    this.state.consecutiveViolations++;
    
    // Trim violations
    if (this.state.violations.length > 100) {
      this.state.violations.shift();
    }
    
    this.emit({ type: 'safety-violation', violation });
    
    // Check for pattern of violations
    if (this.state.consecutiveViolations >= 5) {
      this.enterSafeMode();
    }
    
    if (this.state.consecutiveViolations >= 10) {
      this.triggerEmergencyStop('too-many-violations');
    }
  }

  /**
   * Check if all resources are at safe levels
   */
  private isAllClear(): boolean {
    const memoryOk = !this.memoryController.underPressure();
    const chunksOk = this.currentConcurrentChunks < this.limits.maxConcurrentChunks * 0.5;
    const workersOk = this.currentWorkers < this.limits.maxWorkers * 0.5;
    const wasmOk = this.currentWasmUsage < this.limits.maxWasmBuffer * 0.5;
    
    return memoryOk && chunksOk && workersOk && wasmOk;
  }

  // ---------------------------------------------------------------------------
  // DEVICE PROFILE
  // ---------------------------------------------------------------------------

  /**
   * Apply device profile
   */
  applyProfile(profileName: keyof typeof DEVICE_PROFILES): void {
    const profile = DEVICE_PROFILES[profileName];
    if (!profile) {
      console.error(`[SafetyEnforcer] Unknown profile: ${profileName}`);
      return;
    }
    
    this.limits = { ...profile.limits };
    this.config.targetRAM = profile.targetRAM;
    this.config.safeMargin = profile.safeMargin;
    
    // Update memory controller
    this.memoryController.setMaxRAM(profile.targetRAM);
    
    this.emit({ type: 'profile-applied', profile: profileName });
  }

  /**
   * Detect and apply appropriate profile
   */
  autoDetectProfile(): keyof typeof DEVICE_PROFILES {
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    
    if (!deviceMemory || deviceMemory <= 0.5) {
      this.applyProfile('ultra_low');
      return 'ultra_low';
    }
    
    if (deviceMemory <= 1) {
      this.applyProfile('low');
      return 'low';
    }
    
    if (deviceMemory <= 2) {
      this.applyProfile('medium');
      return 'medium';
    }
    
    this.applyProfile('standard');
    return 'standard';
  }

  // ---------------------------------------------------------------------------
  // STATE & QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Get current limits
   */
  getLimits(): SafetyLimits {
    return { ...this.limits };
  }

  /**
   * Set limits
   */
  setLimits(limits: Partial<SafetyLimits>): void {
    this.limits = { ...this.limits, ...limits };
    this.emit({ type: 'limits-updated', limits: this.limits });
  }

  /**
   * Get current state
   */
  getState(): SafetyState {
    return { ...this.state };
  }

  /**
   * Get current resource usage
   */
  getCurrentUsage(): {
    chunks: number;
    workers: number;
    wasm: number;
    metadata: number;
  } {
    return {
      chunks: this.currentConcurrentChunks,
      workers: this.currentWorkers,
      wasm: this.currentWasmUsage,
      metadata: this.currentMetadataUsage,
    };
  }

  /**
   * Get usage as percentage of limits
   */
  getUsagePercent(): {
    chunks: number;
    workers: number;
    wasm: number;
    metadata: number;
  } {
    return {
      chunks: this.currentConcurrentChunks / this.limits.maxConcurrentChunks,
      workers: this.currentWorkers / this.limits.maxWorkers,
      wasm: this.currentWasmUsage / this.limits.maxWasmBuffer,
      metadata: this.currentMetadataUsage / this.limits.maxMetadataOverhead,
    };
  }

  /**
   * Check if in emergency stop
   */
  isEmergencyStopped(): boolean {
    return this.state.emergencyStopActive;
  }

  /**
   * Check if in safe mode
   */
  isInSafeMode(): boolean {
    return this.state.safeMode;
  }

  // ---------------------------------------------------------------------------
  // RESET
  // ---------------------------------------------------------------------------

  /**
   * Reset all state
   */
  reset(): void {
    this.state = this.createEmptyState();
    this.currentConcurrentChunks = 0;
    this.currentWorkers = 0;
    this.currentWasmUsage = 0;
    this.currentMetadataUsage = 0;
  }

  /**
   * Create empty state
   */
  private createEmptyState(): SafetyState {
    return {
      violations: [],
      emergencyStopActive: false,
      lastViolationTime: 0,
      consecutiveViolations: 0,
      safeMode: false,
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
        console.error('[SafetyEnforcer] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// TESTING UTILITIES
// ============================================================================

/**
 * Create test environment with constrained resources
 */
export function createTestEnvironment(
  profileName: keyof typeof DEVICE_PROFILES = 'test_extreme'
): {
  enforcer: SafetyEnforcer;
  cleanup: () => void;
} {
  const profile = DEVICE_PROFILES[profileName];
  const enforcer = new SafetyEnforcer(profile.limits, {
    targetRAM: profile.targetRAM,
    safeMargin: profile.safeMargin,
  } as LowMemConfig);
  
  return {
    enforcer,
    cleanup: () => enforcer.reset(),
  };
}

/**
 * Run stress test with profile
 */
export async function runSafetyStressTest(
  enforcer: SafetyEnforcer,
  iterations: number = 100
): Promise<{
  passed: number;
  blocked: number;
  violations: SafetyViolation[];
}> {
  let passed = 0;
  let blocked = 0;
  const violations: SafetyViolation[] = [];
  
  // Track violations
  enforcer.on((event) => {
    if (event.type === 'safety-violation') {
      violations.push((event as { type: 'safety-violation'; violation: SafetyViolation }).violation);
    }
  });
  
  for (let i = 0; i < iterations; i++) {
    // Random operation
    const ops: Array<'chunk' | 'worker' | 'wasm' | 'metadata'> = ['chunk', 'worker', 'wasm', 'metadata'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    
    if (enforcer.acquire(op)) {
      passed++;
      // Release after random delay
      setTimeout(() => enforcer.release(op), Math.random() * 100);
    } else {
      blocked++;
    }
    
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  return { passed, blocked, violations };
}

// ============================================================================
// SINGLETON
// ============================================================================

let enforcerInstance: SafetyEnforcer | null = null;

export function getSafetyEnforcer(
  limits?: Partial<SafetyLimits>,
  config?: Partial<LowMemConfig>
): SafetyEnforcer {
  if (!enforcerInstance) {
    enforcerInstance = new SafetyEnforcer(limits, config);
  }
  return enforcerInstance;
}

export function resetSafetyEnforcer(): void {
  enforcerInstance?.reset();
  enforcerInstance = null;
}
