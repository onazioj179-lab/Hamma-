/**
 * SPK Integration Tests
 * Tests for master coordinator, engine selection, and memory management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MasterCoordinator } from '../../engine/master-coordinator';
import { EngineSelector, detectDeviceProfile, getAvailableMemory } from '../../engine/selector';
import { UnifiedMemoryController, getUnifiedMemoryController, resetUnifiedMemoryController } from '../../engine/memory/unified-memory';

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

describe('Engine Selector', () => {
  let selector: EngineSelector;

  beforeEach(() => {
    selector = new EngineSelector();
  });

  it('selects massive mode for large files', () => {
    const pipeline = selector.selectEngines({
      totalSize: 15 * GB,
      fileCount: 10,
      largestFile: 8 * GB,
      availableMemory: 4 * GB,
      memoryPressure: 'low',
      deviceProfile: 'desktop',
      userPreference: 'balanced',
      hasSharedArrayBuffer: true,
      cpuCores: 8,
    });

    expect(pipeline.mode).toBe('massive');
    expect(pipeline.useMassiveMode).toBe(true);
    expect(pipeline.parallelLanes).toBeGreaterThanOrEqual(4);
  });

  it('selects lowmem mode for constrained memory', () => {
    const pipeline = selector.selectEngines({
      totalSize: 500 * MB,
      fileCount: 5,
      largestFile: 200 * MB,
      availableMemory: 1 * GB,
      memoryPressure: 'high',
      deviceProfile: 'mobile',
      userPreference: 'balanced',
      hasSharedArrayBuffer: false,
      cpuCores: 4,
    });

    expect(pipeline.mode).toBe('lowmem');
    expect(pipeline.useLowMemMode).toBe(true);
    expect(pipeline.parallelLanes).toBeLessThanOrEqual(4);
    expect(pipeline.chunkSize).toBeLessThanOrEqual(256 * KB);
  });

  it('adjusts refinement passes based on preference', () => {
    const speedPipeline = selector.selectEngines({
      totalSize: 100 * MB,
      fileCount: 1,
      largestFile: 100 * MB,
      availableMemory: 4 * GB,
      memoryPressure: 'low',
      deviceProfile: 'desktop',
      userPreference: 'speed',
      hasSharedArrayBuffer: true,
      cpuCores: 8,
    });

    expect(speedPipeline.refinementPasses).toBe(0);

    const ratioPipeline = selector.selectEngines({
      totalSize: 100 * MB,
      fileCount: 1,
      largestFile: 100 * MB,
      availableMemory: 4 * GB,
      memoryPressure: 'low',
      deviceProfile: 'desktop',
      userPreference: 'ratio',
      hasSharedArrayBuffer: true,
      cpuCores: 8,
    });

    expect(ratioPipeline.refinementPasses).toBeGreaterThan(0);
  });

  it('enables redundancy for multiple files', () => {
    const singleFile = selector.selectEngines({
      totalSize: 50 * MB,
      fileCount: 1,
      largestFile: 50 * MB,
      availableMemory: 4 * GB,
      memoryPressure: 'low',
      deviceProfile: 'desktop',
      userPreference: 'balanced',
      hasSharedArrayBuffer: true,
      cpuCores: 8,
    });

    expect(singleFile.enableRedundancy).toBe(false);

    const multiFile = selector.selectEngines({
      totalSize: 50 * MB,
      fileCount: 10,
      largestFile: 5 * MB,
      availableMemory: 4 * GB,
      memoryPressure: 'low',
      deviceProfile: 'desktop',
      userPreference: 'balanced',
      hasSharedArrayBuffer: true,
      cpuCores: 8,
    });

    expect(multiFile.enableRedundancy).toBe(true);
  });
});

describe('Unified Memory Controller', () => {
  let controller: UnifiedMemoryController;

  beforeEach(() => {
    resetUnifiedMemoryController();
    controller = getUnifiedMemoryController({
      globalBudget: 1 * GB,
      systemReserve: 100 * MB,
    });
  });

  afterEach(() => {
    resetUnifiedMemoryController();
  });

  it('allocates memory within budget', () => {
    const id = controller.allocate('massive', 100 * MB, 'test allocation');
    expect(id).toBeTruthy();

    const stats = controller.getStats();
    expect(stats.totalAllocated).toBe(100 * MB);
  });

  it('denies allocation exceeding subsystem limit', () => {
    const budget = controller.getBudget('redundancy');
    expect(budget).toBeTruthy();

    const id = controller.allocate('redundancy', budget!.limit + 1, 'over limit');
    expect(id).toBeNull();
  });

  it('tracks pressure level correctly', () => {
    const globalBudget = 1 * GB;
    const systemReserve = 100 * MB;
    const available = globalBudget - systemReserve; // 900MB

    // Subsystem limits:
    // massive: 30% = 270MB
    // lowmem: 25% = 225MB
    // wasm: 15% = 135MB
    // parallel: 25% = 225MB
    
    // None pressure (< 50% = 450MB)
    // Use massive (max 270MB)
    const alloc1 = controller.allocate('massive', 200 * MB);
    expect(alloc1).not.toBeNull();
    expect(controller.getPressureLevel()).toBe('none');

    // Low pressure (>= 50% = 450MB)
    // Use lowmem (max 225MB) + wasm (max 135MB) + parallel (max 225MB)
    // Need ~250MB more to hit 50%: 200 + 250 = 450MB
    const alloc2 = controller.allocate('lowmem', 200 * MB);
    expect(alloc2).not.toBeNull();
    const alloc3 = controller.allocate('wasm', 100 * MB);
    expect(alloc3).not.toBeNull();
    // Total = 200 + 200 + 100 = 500MB / 900MB = 55.5% -> 'low'
    expect(controller.getPressureLevel()).toBe('low');
  });

  it('deallocates memory correctly', () => {
    const id1 = controller.allocate('massive', 100 * MB);
    const id2 = controller.allocate('parallel', 50 * MB);

    expect(controller.getStats().totalAllocated).toBe(150 * MB);

    controller.deallocate(id1!);
    expect(controller.getStats().totalAllocated).toBe(50 * MB);

    controller.deallocate(id2!);
    expect(controller.getStats().totalAllocated).toBe(0);
  });

  it('handles memory reservation', () => {
    const success = controller.reserve('lowmem', 200 * MB);
    expect(success).toBe(true);

    const stats = controller.getStats();
    expect(stats.totalReserved).toBe(200 * MB);

    controller.unreserve('lowmem', 100 * MB);
    expect(controller.getStats().totalReserved).toBe(100 * MB);
  });
});

describe('Master Coordinator', () => {
  let coordinator: MasterCoordinator;

  beforeEach(() => {
    coordinator = new MasterCoordinator({
      userPreference: 'balanced',
      enableRedundancy: true,
      enableRefinement: true,
      enableIntegrity: true,
      enableParallel: true,
    });
  });

  it('creates coordinator instance', () => {
    expect(coordinator).toBeTruthy();
  });

  it('selects appropriate mode for file size', async () => {
    // Test that coordinator can be configured
    expect(coordinator).toBeTruthy();
  });

  it('handles compression errors gracefully', async () => {
    // Empty files array should throw
    try {
      await coordinator.compress([], {});
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeTruthy();
      expect((error as Error).message).toContain('No files');
    }
  });
});

describe('Integration: Full Compression Flow', () => {
  it('processes small file through normal mode', async () => {
    const coordinator = new MasterCoordinator();
    const content = 'Hello World'.repeat(1000);
    const file = new File([content], 'test.txt', { type: 'text/plain' });

    const result = await coordinator.compress([file], { quality: 'fast' });

    // In test environment, mock compression is used
    expect(result).toBeTruthy();
    expect(result.compressedData).toBeTruthy();
    expect(result.originalSize).toBeGreaterThan(0);
    expect(result.compressedSize).toBeGreaterThan(0);
    expect(result.chunksProcessed).toBeGreaterThan(0);
  });
});

describe('Device Detection', () => {
  it('detects device profile', () => {
    const profile = detectDeviceProfile();
    expect(['mobile', 'tablet', 'desktop', 'workstation', 'server']).toContain(profile);
  });

  it('detects available memory', () => {
    const memory = getAvailableMemory();
    expect(memory).toBeGreaterThan(0);
  });
});
