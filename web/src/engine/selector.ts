/**
 * SPK Engine Selector
 * Determines which engine combination to use based on input characteristics
 */

import type { CompressionMode } from './wasm/types';

// Use bitwise for faster multiplication (compile-time constants)
const KB = 1024;
const MB = 1048576;  // 1024 * 1024
const GB = 1073741824;  // 1024 * 1024 * 1024

// Pre-computed thresholds for faster comparisons
const MASSIVE_SIZE_THRESHOLD = 10737418240;  // 10 * GB
const MASSIVE_FILE_COUNT = 1000;
const MASSIVE_FILE_THRESHOLD = 5368709120;  // 5 * GB
const LOWMEM_THRESHOLD = 2147483648;  // 2 * GB

export type DeviceProfile = 
  | 'mobile'
  | 'tablet'
  | 'desktop'
  | 'workstation'
  | 'server';

export type UserPreference = 
  | 'speed'
  | 'ratio'
  | 'balanced';

export type MemoryPressureLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export interface EngineSelectionCriteria {
  totalSize: number;
  fileCount: number;
  largestFile: number;
  availableMemory: number;
  memoryPressure: MemoryPressureLevel;
  deviceProfile: DeviceProfile;
  userPreference: UserPreference;
  hasSharedArrayBuffer: boolean;
  cpuCores: number;
}

export interface EnginePipeline {
  mode: 'massive' | 'lowmem' | 'normal';
  useMassiveMode: boolean;
  useLowMemMode: boolean;
  parallelLanes: number;
  enableRedundancy: boolean;
  refinementPasses: number;
  chunkSize: number;
  compressionMode: CompressionMode;
  enableIntegrityCheck: boolean;
  maxMemoryBudget: number;
  useSharedMemory: boolean;
}

export class EngineSelector {
  selectEngines(criteria: EngineSelectionCriteria): EnginePipeline {
    const {
      totalSize,
      fileCount,
      largestFile,
      availableMemory,
      memoryPressure,
      deviceProfile,
      userPreference,
      hasSharedArrayBuffer,
      cpuCores,
    } = criteria;

    // Determine base mode
    const useMassiveMode = this.shouldUseMassiveMode(
      totalSize,
      fileCount,
      largestFile
    );
    
    const useLowMemMode = this.shouldUseLowMemMode(
      availableMemory,
      memoryPressure,
      deviceProfile
    );

    // Calculate parallel lanes
    const parallelLanes = this.calculateLanes(
      cpuCores,
      availableMemory,
      useMassiveMode,
      useLowMemMode,
      deviceProfile
    );

    // Determine chunk size
    const chunkSize = this.selectChunkSize(
      totalSize,
      useMassiveMode,
      useLowMemMode,
      availableMemory
    );

    // Select compression mode
    const compressionMode = this.selectCompressionMode(
      userPreference,
      useMassiveMode
    );

    // Determine feature enables
    const enableRedundancy = this.shouldEnableRedundancy(
      totalSize,
      fileCount,
      useMassiveMode
    );

    const refinementPasses = this.selectRefinementPasses(
      userPreference,
      useMassiveMode,
      useLowMemMode
    );

    const enableIntegrityCheck = this.shouldEnableIntegrity(
      totalSize,
      useMassiveMode
    );

    // Calculate memory budget
    const maxMemoryBudget = this.calculateMemoryBudget(
      availableMemory,
      useLowMemMode,
      deviceProfile
    );

    // Determine primary mode
    let mode: 'massive' | 'lowmem' | 'normal';
    if (useMassiveMode && useLowMemMode) {
      mode = 'massive'; // Massive takes precedence, uses low-mem strategies
    } else if (useMassiveMode) {
      mode = 'massive';
    } else if (useLowMemMode) {
      mode = 'lowmem';
    } else {
      mode = 'normal';
    }

    return {
      mode,
      useMassiveMode,
      useLowMemMode,
      parallelLanes,
      enableRedundancy,
      refinementPasses,
      chunkSize,
      compressionMode,
      enableIntegrityCheck,
      maxMemoryBudget,
      useSharedMemory: hasSharedArrayBuffer && parallelLanes > 1,
    };
  }

  private shouldUseMassiveMode(
    totalSize: number,
    fileCount: number,
    largestFile: number
  ): boolean {
    // Use pre-computed constants for faster comparison
    return (
      totalSize > MASSIVE_SIZE_THRESHOLD ||
      fileCount > MASSIVE_FILE_COUNT ||
      largestFile > MASSIVE_FILE_THRESHOLD
    );
  }

  private shouldUseLowMemMode(
    availableMemory: number,
    memoryPressure: MemoryPressureLevel,
    deviceProfile: DeviceProfile
  ): boolean {
    // Fast path: check memory first (most common case)
    if (availableMemory < LOWMEM_THRESHOLD) return true;
    // Check pressure levels using charCode comparison (faster than string compare)
    const pressureChar = memoryPressure.charCodeAt(0);
    if (pressureChar === 104 || pressureChar === 99) return true;  // 'h' or 'c'
    // Device check
    return deviceProfile === 'mobile' || deviceProfile === 'tablet';
  }

  private calculateLanes(
    cpuCores: number,
    availableMemory: number,
    useMassiveMode: boolean,
    useLowMemMode: boolean,
    deviceProfile: DeviceProfile
  ): number {
    // Use bitwise operations for faster clamping
    let lanes = cpuCores < 2 ? 2 : cpuCores > 16 ? 16 : cpuCores;

    // Reduce for low memory
    if (useLowMemMode) {
      lanes = Math.min(lanes, 4);
    }

    // Adjust for device profile
    if (deviceProfile === 'mobile') {
      lanes = Math.min(lanes, 2);
    } else if (deviceProfile === 'tablet') {
      lanes = Math.min(lanes, 4);
    } else if (deviceProfile === 'workstation' || deviceProfile === 'server') {
      lanes = Math.min(lanes, 16);
    }

    // Adjust for massive mode
    if (useMassiveMode) {
      lanes = Math.max(lanes, 4); // Minimum 4 lanes for massive
    }

    // Memory-based ceiling: ~200MB per lane (use pre-computed divisor)
    const memoryBasedCeiling = (availableMemory / 209715200) | 0;  // 200 * MB, |0 for fast floor
    lanes = lanes < memoryBasedCeiling ? lanes : memoryBasedCeiling;

    // Clamp to [2, 16] using ternary (faster than nested Math calls)
    return lanes < 2 ? 2 : lanes > 16 ? 16 : lanes;
  }

  private selectChunkSize(
    totalSize: number,
    useMassiveMode: boolean,
    useLowMemMode: boolean,
    availableMemory: number
  ): number {
    // Low memory: use smaller chunks
    if (useLowMemMode) {
      return availableMemory < GB ? 65536 : 131072;  // 64KB : 128KB
    }

    // Massive mode: larger chunks for throughput
    if (useMassiveMode) {
      if (totalSize > 107374182400) return 4194304;  // 100GB -> 4MB
      if (totalSize > MASSIVE_SIZE_THRESHOLD) return 2097152;  // 10GB -> 2MB
      return 1048576;  // 1MB
    }

    // Normal mode: scale with size
    if (totalSize > GB) return 1048576;  // 1MB
    if (totalSize > 104857600) return 524288;  // 100MB -> 512KB
    return 262144;  // 256KB
  }

  private selectCompressionMode(
    userPreference: UserPreference,
    _useMassiveMode: boolean
  ): CompressionMode {
    // Use charCode for faster comparison
    const prefChar = userPreference.charCodeAt(0);
    if (prefChar === 115) return 'fast';    // 's' for speed
    if (prefChar === 114) return 'strong';  // 'r' for ratio
    return 'auto';
  }

  private shouldEnableRedundancy(
    totalSize: number,
    fileCount: number,
    useMassiveMode: boolean
  ): boolean {
    // Enable redundancy detection for:
    // - Multiple files (cross-file dedup)
    // - Large total size
    // - Massive mode (helps compression ratio)
    return (
      fileCount > 1 ||
      totalSize > 100 * MB ||
      useMassiveMode
    );
  }

  private selectRefinementPasses(
    userPreference: UserPreference,
    useMassiveMode: boolean,
    useLowMemMode: boolean
  ): number {
    // No refinement in low-mem mode
    if (useLowMemMode) {
      return 0;
    }

    // Refinement passes based on preference
    if (userPreference === 'ratio') {
      return useMassiveMode ? 2 : 3; // Reduce passes for massive (time)
    } else if (userPreference === 'speed') {
      return 0; // Skip refinement
    } else {
      return 1; // Balanced: one pass
    }
  }

  private shouldEnableIntegrity(
    totalSize: number,
    useMassiveMode: boolean
  ): boolean {
    // Always enable integrity for:
    // - Massive mode
    // - Large files
    return useMassiveMode || totalSize > 1 * GB;
  }

  private calculateMemoryBudget(
    availableMemory: number,
    useLowMemMode: boolean,
    deviceProfile: DeviceProfile
  ): number {
    if (useLowMemMode) {
      // Reserve 150MB for system, cap at 850MB
      const budget = availableMemory - 157286400;  // 150MB
      return budget < 104857600 ? 104857600 : budget > 891289600 ? 891289600 : budget;
    }

    // Normal mode: use 60% of available memory
    let budget = (availableMemory * 0.6) | 0;  // |0 for fast floor

    // Device-specific caps
    const caps: Record<DeviceProfile, number> = {
      mobile: 524288000,      // 500MB
      tablet: GB,             // 1GB
      desktop: 8589934592,    // 8GB
      workstation: 8589934592,
      server: 8589934592,
    };
    const cap = caps[deviceProfile];
    if (budget > cap) budget = cap;

    return budget < 209715200 ? 209715200 : budget;  // Min 200MB
  }
}

export function detectDeviceProfile(): DeviceProfile {
  const memory = (performance as any).memory?.jsHeapSizeLimit || 4 * GB;
  const cores = navigator.hardwareConcurrency || 4;
  const isMobile = /Mobile|Android|iPhone/i.test(navigator.userAgent);
  const isTablet = /Tablet|iPad/i.test(navigator.userAgent);

  if (isMobile) return 'mobile';
  if (isTablet) return 'tablet';
  if (memory > 16 * GB && cores >= 16) return 'server';
  if (memory > 8 * GB && cores >= 8) return 'workstation';
  return 'desktop';
}

export function detectMemoryPressure(availableMemory: number): MemoryPressureLevel {
  const totalMemory = (performance as any).memory?.jsHeapSizeLimit || 4 * GB;
  const usageRatio = 1 - (availableMemory / totalMemory);

  if (usageRatio > 0.9) return 'critical';
  if (usageRatio > 0.75) return 'high';
  if (usageRatio > 0.5) return 'medium';
  return 'low';
}

export function getAvailableMemory(): number {
  if ((performance as any).memory) {
    const mem = (performance as any).memory;
    return mem.jsHeapSizeLimit - mem.usedJSHeapSize;
  }
  // Fallback estimate
  return 2 * GB;
}
