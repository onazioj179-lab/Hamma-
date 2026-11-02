/**
 * SPK Unified Memory Controller
 * Coordinates memory allocation across all engine subsystems
 */

class EventEmitter {
  private listeners: Map<string, Function[]> = new Map();
  
  on(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }
  
  emit(event: string, data?: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(h => h(data));
    }
  }
}

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

export type MemorySubsystem = 
  | 'massive'
  | 'lowmem'
  | 'parallel'
  | 'redundancy'
  | 'refinement'
  | 'integrity'
  | 'wasm'
  | 'worker'
  | 'optimization'
  | 'other';

export type PressureLevel = 
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'emergency';

export interface MemoryAllocation {
  subsystem: MemorySubsystem;
  bytes: number;
  timestamp: number;
  description: string;
}

export interface MemoryBudget {
  subsystem: MemorySubsystem;
  allocated: number;
  limit: number;
  reserved: number;
}

export interface MemoryStats {
  totalBudget: number;
  totalAllocated: number;
  totalReserved: number;
  available: number;
  pressureLevel: PressureLevel;
  budgets: Map<MemorySubsystem, MemoryBudget>;
}

export interface UnifiedMemoryConfig {
  globalBudget: number;
  systemReserve: number;
  enablePressureEvents: boolean;
  pressureThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
    emergency: number;
  };
}

const DEFAULT_CONFIG: UnifiedMemoryConfig = {
  globalBudget: 2 * GB,
  systemReserve: 200 * MB,
  enablePressureEvents: true,
  pressureThresholds: {
    low: 0.5,
    medium: 0.65,
    high: 0.8,
    critical: 0.9,
    emergency: 0.95,
  },
};

export class UnifiedMemoryController extends EventEmitter {
  private config: UnifiedMemoryConfig;
  private budgets: Map<MemorySubsystem, MemoryBudget>;
  private allocations: Map<string, MemoryAllocation>;
  private allocationCounter = 0;
  private currentPressure: PressureLevel = 'none';
  private peakUsage = 0;

  constructor(config?: Partial<UnifiedMemoryConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.budgets = new Map();
    this.allocations = new Map();
    this.initializeSubsystems();
  }

  private initializeSubsystems(): void {
    const subsystems: MemorySubsystem[] = [
      'massive',
      'lowmem',
      'parallel',
      'redundancy',
      'refinement',
      'integrity',
      'wasm',
      'worker',
      'optimization',
      'other',
    ];

    for (const subsystem of subsystems) {
      this.budgets.set(subsystem, {
        subsystem,
        allocated: 0,
        limit: this.calculateInitialLimit(subsystem),
        reserved: 0,
      });
    }
  }

  private calculateInitialLimit(subsystem: MemorySubsystem): number {
    const available = this.config.globalBudget - this.config.systemReserve;
    
    // Distribute limits based on typical usage patterns
    const limits: Record<MemorySubsystem, number> = {
      massive: available * 0.3,
      lowmem: available * 0.25,
      parallel: available * 0.25,
      redundancy: available * 0.05,
      refinement: available * 0.05,
      integrity: available * 0.03,
      wasm: available * 0.15,
      worker: available * 0.2,
      optimization: available * 0.02,
      other: available * 0.05,
    };

    return Math.floor(limits[subsystem]);
  }

  allocate(
    subsystem: MemorySubsystem,
    bytes: number,
    description = ''
  ): string | null {
    const budget = this.budgets.get(subsystem);
    if (!budget) {
      throw new Error(`Unknown subsystem: ${subsystem}`);
    }

    // Check if allocation exceeds subsystem limit
    if (budget.allocated + bytes > budget.limit) {
      this.emit('allocation-denied', {
        subsystem,
        requested: bytes,
        available: budget.limit - budget.allocated,
        reason: 'subsystem-limit',
      });
      return null;
    }

    // Check if allocation exceeds global budget
    const totalAllocated = this.getTotalAllocated();
    const globalAvailable = this.config.globalBudget - this.config.systemReserve - totalAllocated;
    
    if (bytes > globalAvailable) {
      this.emit('allocation-denied', {
        subsystem,
        requested: bytes,
        available: globalAvailable,
        reason: 'global-limit',
      });
      return null;
    }

    // Create allocation
    const id = `alloc-${subsystem}-${++this.allocationCounter}`;
    const allocation: MemoryAllocation = {
      subsystem,
      bytes,
      timestamp: Date.now(),
      description,
    };

    this.allocations.set(id, allocation);
    budget.allocated += bytes;

    // Update pressure level
    this.updatePressureLevel();

    this.emit('allocated', { id, allocation });

    return id;
  }

  deallocate(allocationId: string): boolean {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      return false;
    }

    const budget = this.budgets.get(allocation.subsystem);
    if (budget) {
      budget.allocated -= allocation.bytes;
    }

    this.allocations.delete(allocationId);
    this.updatePressureLevel();

    this.emit('deallocated', { id: allocationId, allocation });

    return true;
  }

  reserve(subsystem: MemorySubsystem, bytes: number): boolean {
    const budget = this.budgets.get(subsystem);
    if (!budget) {
      return false;
    }

    // Check if reservation is possible
    const totalReserved = this.getTotalReserved();
    const globalAvailable = this.config.globalBudget - this.config.systemReserve - totalReserved;

    if (bytes > globalAvailable) {
      return false;
    }

    budget.reserved += bytes;
    this.emit('reserved', { subsystem, bytes });

    return true;
  }

  unreserve(subsystem: MemorySubsystem, bytes: number): boolean {
    const budget = this.budgets.get(subsystem);
    if (!budget) {
      return false;
    }

    budget.reserved = Math.max(0, budget.reserved - bytes);
    this.emit('unreserved', { subsystem, bytes });

    return true;
  }

  updateBudget(subsystem: MemorySubsystem, newLimit: number): boolean {
    const budget = this.budgets.get(subsystem);
    if (!budget) {
      return false;
    }

    // Check if new limit is feasible
    if (newLimit < budget.allocated) {
      this.emit('budget-update-denied', {
        subsystem,
        newLimit,
        currentAllocated: budget.allocated,
      });
      return false;
    }

    budget.limit = newLimit;
    this.emit('budget-updated', { subsystem, newLimit });

    return true;
  }

  getStats(): MemoryStats {
    const totalAllocated = this.getTotalAllocated();
    const totalReserved = this.getTotalReserved();
    const available = this.config.globalBudget - this.config.systemReserve - totalAllocated - totalReserved;

    return {
      totalBudget: this.config.globalBudget,
      totalAllocated,
      totalReserved,
      available: Math.max(0, available),
      pressureLevel: this.currentPressure,
      budgets: new Map(this.budgets),
    };
  }

  getBudget(subsystem: MemorySubsystem): MemoryBudget | undefined {
    return this.budgets.get(subsystem);
  }

  getAvailable(subsystem: MemorySubsystem): number {
    const budget = this.budgets.get(subsystem);
    if (!budget) {
      return 0;
    }
    return Math.max(0, budget.limit - budget.allocated - budget.reserved);
  }

  getTotalAllocated(): number {
    let total = 0;
    for (const allocation of this.allocations.values()) {
      total += allocation.bytes;
    }
    return total;
  }

  getTotalReserved(): number {
    let total = 0;
    for (const budget of this.budgets.values()) {
      total += budget.reserved;
    }
    return total;
  }

  getPressureLevel(): PressureLevel {
    return this.currentPressure;
  }

  getPeakUsage(): number {
    return this.peakUsage;
  }

  private updatePressureLevel(): void {
    const totalAllocated = this.getTotalAllocated();
    const totalReserved = this.getTotalReserved();
    const usageRatio = (totalAllocated + totalReserved) / (this.config.globalBudget - this.config.systemReserve);

    // Track peak usage
    if (totalAllocated > this.peakUsage) {
      this.peakUsage = totalAllocated;
    }

    let newPressure: PressureLevel;

    if (usageRatio >= this.config.pressureThresholds.emergency) {
      newPressure = 'emergency';
    } else if (usageRatio >= this.config.pressureThresholds.critical) {
      newPressure = 'critical';
    } else if (usageRatio >= this.config.pressureThresholds.high) {
      newPressure = 'high';
    } else if (usageRatio >= this.config.pressureThresholds.medium) {
      newPressure = 'medium';
    } else if (usageRatio >= this.config.pressureThresholds.low) {
      newPressure = 'low';
    } else {
      newPressure = 'none';
    }

    if (newPressure !== this.currentPressure) {
      const oldPressure = this.currentPressure;
      this.currentPressure = newPressure;

      if (this.config.enablePressureEvents) {
        this.emit('pressure-changed', {
          oldLevel: oldPressure,
          newLevel: newPressure,
          usageRatio,
          stats: this.getStats(),
        });
      }
    }
  }

  requestRebalance(): void {
    // Trigger rebalancing across subsystems
    // This would involve coordinating with engine coordinators
    // to reduce memory usage when under pressure
    
    const stats = this.getStats();
    this.emit('rebalance-requested', stats);

    if (this.currentPressure === 'high' || 
        this.currentPressure === 'critical' || 
        this.currentPressure === 'emergency') {
      
      // Reduce limits for non-critical subsystems
      this.reduceNonCriticalLimits();
    }
  }

  private reduceNonCriticalLimits(): void {
    const nonCritical: MemorySubsystem[] = [
      'redundancy',
      'refinement',
      'optimization',
      'other',
    ];

    for (const subsystem of nonCritical) {
      const budget = this.budgets.get(subsystem);
      if (budget && budget.allocated < budget.limit) {
        // Reduce limit to current allocation + small buffer
        const newLimit = Math.max(
          budget.allocated,
          Math.floor(budget.allocated * 1.1)
        );
        this.updateBudget(subsystem, newLimit);
      }
    }
  }

  forceEviction(subsystem?: MemorySubsystem): number {
    let freedBytes = 0;

    if (subsystem) {
      // Evict from specific subsystem
      for (const [id, allocation] of this.allocations) {
        if (allocation.subsystem === subsystem) {
          this.deallocate(id);
          freedBytes += allocation.bytes;
        }
      }
    } else {
      // Evict oldest allocations first
      const sortedAllocations = Array.from(this.allocations.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      for (const [id, allocation] of sortedAllocations) {
        this.deallocate(id);
        freedBytes += allocation.bytes;

        // Stop if pressure is back to acceptable level
        if (this.currentPressure === 'medium' || this.currentPressure === 'low') {
          break;
        }
      }
    }

    this.emit('eviction-completed', { freedBytes, subsystem });

    return freedBytes;
  }

  reset(): void {
    this.allocations.clear();
    this.allocationCounter = 0;
    
    for (const budget of this.budgets.values()) {
      budget.allocated = 0;
      budget.reserved = 0;
    }

    this.currentPressure = 'none';
    this.emit('reset');
  }
}

// Singleton instance
let globalController: UnifiedMemoryController | null = null;

export function getUnifiedMemoryController(
  config?: Partial<UnifiedMemoryConfig>
): UnifiedMemoryController {
  if (!globalController) {
    globalController = new UnifiedMemoryController(config);
  }
  return globalController;
}

export function resetUnifiedMemoryController(): void {
  if (globalController) {
    globalController.reset();
    globalController = null;
  }
}
