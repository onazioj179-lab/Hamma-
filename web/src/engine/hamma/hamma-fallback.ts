/**
 * HAMMA Integration - Fallback Mode
 * 
 * JavaScript-only fallback when Python HAMMA server is not available.
 * Provides basic predictions without external service.
 * 
 * Creator: Onazi Treasure (OJ)
 */

import type {
  ChunkMetadata,
  WorkerStats,
  DeviceProfile,
  HistoricalPerformance,
  PredictionResponse,
  MemoryTarget,
} from './hamma-client';

// ============================================================================
// Fallback Entropy Predictor
// ============================================================================

function predictEntropy(
  entropy: number,
  chunkSize: number,
  histogram?: number[],
): number {
  // Simple entropy to ratio mapping
  const entropyWeights = [8.0, 6.5, 5.0, 3.5, 2.5, 1.8, 1.3, 1.1, 1.0];
  
  const idx = Math.min(Math.max(Math.floor(entropy), 0), 8);
  let baseRatio = entropyWeights[idx];
  
  // Interpolate
  if (idx < 8) {
    const frac = entropy - idx;
    baseRatio = baseRatio * (1 - frac) + entropyWeights[idx + 1] * frac;
  }
  
  // Size factor
  let sizeFactor = 1.0;
  if (chunkSize < 4096) sizeFactor = 0.9;
  else if (chunkSize > 1048576) sizeFactor = 1.05;
  
  // Histogram factor
  let histogramFactor = 1.0;
  if (histogram && histogram.length === 256) {
    const nonZero = histogram.filter(h => h > 0).length;
    if (nonZero < 32) histogramFactor = 1.3;
    else if (nonZero < 64) histogramFactor = 1.15;
    else if (nonZero > 250) histogramFactor = 0.95;
  }
  
  return Math.max(1.0, Math.min(baseRatio * sizeFactor * histogramFactor, 100));
}

// ============================================================================
// Fallback Mode Selector
// ============================================================================

function selectMode(
  entropy: number,
  expectedRatio: number,
  isRedundant: boolean,
  deviceProfile?: DeviceProfile,
): { mode: 'fast' | 'strong' | 'auto' | 'skip-refine'; refinementLevel: 0 | 1 | 2 } {
  // Redundant: skip refinement
  if (isRedundant) {
    return { mode: 'skip-refine', refinementLevel: 0 };
  }
  
  // Low memory: fast mode
  if (deviceProfile && (deviceProfile.ram_pressure > 0.7 || deviceProfile.is_throttled)) {
    return { mode: 'fast', refinementLevel: 0 };
  }
  
  // Random data: skip refinement
  if (entropy > 7.5 || expectedRatio < 1.2) {
    return { mode: 'skip-refine', refinementLevel: 0 };
  }
  
  // Excellent ratio: strong mode
  if (expectedRatio >= 4.0) {
    const isMobile = deviceProfile?.is_mobile ?? false;
    return { mode: 'strong', refinementLevel: isMobile ? 1 : 2 };
  }
  
  // Good ratio: auto mode
  if (expectedRatio >= 2.0) {
    return { mode: 'auto', refinementLevel: 1 };
  }
  
  // Marginal: fast mode
  return { mode: 'fast', refinementLevel: 0 };
}

// ============================================================================
// Fallback Stability Assessment
// ============================================================================

function assessStability(
  deviceProfile?: DeviceProfile,
  workerStats?: WorkerStats,
): {
  flag: 'safe' | 'warning' | 'critical';
  memoryTarget: MemoryTarget;
  laneBoost: boolean;
} {
  const ramPressure = deviceProfile?.ram_pressure ?? 0.5;
  const isThrottled = deviceProfile?.is_throttled ?? false;
  const isMobile = deviceProfile?.is_mobile ?? false;
  const cores = deviceProfile?.cpu_cores ?? 4;
  const ramAvailable = deviceProfile?.ram_available_mb ?? 2048;
  
  // Check worker stability
  let workerUnstable = false;
  if (workerStats) {
    const { last_chunk_time_ms, avg_chunk_time_ms, error_count, chunks_processed } = workerStats;
    if (avg_chunk_time_ms > 0 && last_chunk_time_ms > avg_chunk_time_ms * 2) {
      workerUnstable = true;
    }
    if (chunks_processed > 0 && error_count / chunks_processed > 0.05) {
      workerUnstable = true;
    }
  }
  
  // Determine flag
  let flag: 'safe' | 'warning' | 'critical' = 'safe';
  if (ramPressure >= 0.85 || isThrottled && ramPressure > 0.7) {
    flag = 'critical';
  } else if (ramPressure >= 0.7 || workerUnstable || isThrottled) {
    flag = 'warning';
  }
  
  // Memory target
  let chunkSize = 1024 * 1024; // 1MB default
  let concurrency = Math.min(cores, 4);
  
  if (flag === 'critical') {
    chunkSize = 64 * 1024;
    concurrency = 1;
  } else if (flag === 'warning') {
    chunkSize = 256 * 1024;
    concurrency = 2;
  } else if (ramAvailable > 4096) {
    chunkSize = 4 * 1024 * 1024;
    concurrency = Math.min(cores, 8);
  }
  
  // Mobile adjustments
  if (isMobile) {
    chunkSize = Math.min(chunkSize, 512 * 1024);
    concurrency = Math.min(concurrency, 2);
  }
  
  // Low memory adjustments
  if (ramAvailable < 1024) {
    chunkSize = Math.min(chunkSize, 64 * 1024);
    concurrency = 1;
  }
  
  // Lane boost
  const laneBoost = flag === 'safe' && !workerUnstable && ramPressure < 0.3 && cores >= 4;
  
  return {
    flag,
    memoryTarget: { chunk_size: chunkSize, concurrency },
    laneBoost,
  };
}

// ============================================================================
// Fallback Redundancy Detection
// ============================================================================

const signatureCache = new Map<string, number>();
let nextClusterId = 0;

function checkRedundancy(signature: string): number | null {
  // Check exact match
  if (signatureCache.has(signature)) {
    return signatureCache.get(signature)!;
  }
  
  // Check prefix match
  const prefix = signature.slice(0, 8);
  for (const [key, clusterId] of signatureCache) {
    if (key.startsWith(prefix)) {
      signatureCache.set(signature, clusterId);
      return clusterId;
    }
  }
  
  // New signature
  const clusterId = nextClusterId++;
  signatureCache.set(signature, clusterId);
  
  return null; // First occurrence not redundant
}

function resetRedundancyCache(): void {
  signatureCache.clear();
  nextClusterId = 0;
}

// ============================================================================
// Fallback Anomaly Detection
// ============================================================================

function detectAnomaly(
  chunk: ChunkMetadata,
  workerStats?: WorkerStats,
): boolean {
  // Entropy anomaly
  if (chunk.entropy_score < 0.5 || chunk.entropy_score > 7.9) {
    return true;
  }
  
  // Size anomaly
  if (chunk.chunk_size < 1024) {
    return true;
  }
  
  // Compression expansion
  if (chunk.compressed_size && chunk.compressed_size > chunk.chunk_size * 1.1) {
    return true;
  }
  
  // Worker timing anomaly
  if (workerStats) {
    if (workerStats.last_chunk_time_ms > workerStats.avg_chunk_time_ms * 3) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Main Fallback Predict Function
// ============================================================================

export function predictFallback(
  chunk: ChunkMetadata,
  workerStats?: WorkerStats,
  deviceProfile?: DeviceProfile,
  history?: HistoricalPerformance,
): PredictionResponse {
  // Entropy prediction
  const expectedRatio = predictEntropy(
    chunk.entropy_score,
    chunk.chunk_size,
    chunk.histogram,
  );
  
  // Redundancy check
  const redundancyCluster = checkRedundancy(chunk.redundancy_signature);
  const isRedundant = redundancyCluster !== null;
  
  // Mode selection
  const { mode, refinementLevel } = selectMode(
    chunk.entropy_score,
    expectedRatio,
    isRedundant,
    deviceProfile,
  );
  
  // Adjust for history
  let finalRefinement = refinementLevel;
  if (history && refinementLevel > 0) {
    if (history.refinement_success_rate < 0.3) {
      finalRefinement = Math.max(0, refinementLevel - 1) as 0 | 1 | 2;
    } else if (history.refinement_success_rate > 0.7 && refinementLevel < 2) {
      finalRefinement = Math.min(2, refinementLevel + 1) as 0 | 1 | 2;
    }
  }
  
  // Stability assessment
  const { flag, memoryTarget, laneBoost } = assessStability(deviceProfile, workerStats);
  
  // Anomaly detection
  const anomalyDetected = detectAnomaly(chunk, workerStats);
  
  return {
    chunk_mode: mode,
    refinement_level: finalRefinement,
    lane_boost: laneBoost,
    expected_ratio: Math.round(expectedRatio * 100) / 100,
    stability_flag: flag,
    memory_target: memoryTarget,
    anomaly_detected: anomalyDetected,
    confidence: 0.7, // Lower confidence for fallback
    redundancy_cluster: redundancyCluster,
  };
}

export { resetRedundancyCache };
