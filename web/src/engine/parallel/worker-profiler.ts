/**
 * SPK Ultra-Parallel Throughput Engine - Worker Profiler
 * Creator: OJ Treasure Onazi
 * 
 * Tracks worker performance statistics, WASM warm state,
 * memory footprint, and generates efficiency profiles.
 */

import {
  WorkerProfile,
  WASMState,
  ProfilerConfig,
  DEFAULT_PROFILER_CONFIG,
  ParallelEvent,
  ParallelEventHandler,
  MB,
} from './types';

// ============================================================================
// TIMING SAMPLE
// ============================================================================

interface TimingSample {
  timestamp: number;
  duration: number;
  bytes: number;
  success: boolean;
}

// ============================================================================
// WORKER PROFILER
// ============================================================================

export class WorkerProfiler {
  private config: ProfilerConfig;
  private profiles: Map<string, WorkerProfile> = new Map();
  private samples: Map<string, TimingSample[]> = new Map();
  private eventHandlers: Set<ParallelEventHandler> = new Set();
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private memoryBaseline: number = 0;

  constructor(config: Partial<ProfilerConfig> = {}) {
    this.config = { ...DEFAULT_PROFILER_CONFIG, ...config };
    
    // Capture memory baseline
    if (typeof performance !== 'undefined' && (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory) {
      this.memoryBaseline = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    }
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: ParallelEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: ParallelEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: ParallelEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  registerWorker(workerId: string, laneId: string): void {
    const profile: WorkerProfile = {
      workerId,
      laneId,
      averageChunkTime: 0,
      stdDeviation: 0,
      wasmWarmState: 'cold',
      memoryFootprint: 0,
      sustainedThroughput: 0,
      peakThroughput: 0,
      chunksProcessed: 0,
      bytesProcessed: BigInt(0),
      errorRate: 0,
      stallRate: 0,
      efficiencyScore: 1,
    };

    this.profiles.set(workerId, profile);
    this.samples.set(workerId, []);
  }

  unregisterWorker(workerId: string): void {
    this.profiles.delete(workerId);
    this.samples.delete(workerId);
  }

  // ==========================================================================
  // SAMPLE RECORDING
  // ==========================================================================

  recordSample(
    workerId: string,
    duration: number,
    bytes: number,
    success: boolean
  ): void {
    const samples = this.samples.get(workerId);
    if (!samples) return;

    const sample: TimingSample = {
      timestamp: Date.now(),
      duration,
      bytes,
      success,
    };

    samples.push(sample);

    // Trim to window size
    if (samples.length > this.config.sampleWindow) {
      samples.shift();
    }

    // Update profile
    this.updateProfile(workerId);
  }

  recordError(workerId: string): void {
    const profile = this.profiles.get(workerId);
    if (!profile) return;

    // Record as failed sample
    const samples = this.samples.get(workerId);
    if (samples) {
      samples.push({
        timestamp: Date.now(),
        duration: 0,
        bytes: 0,
        success: false,
      });

      if (samples.length > this.config.sampleWindow) {
        samples.shift();
      }
    }

    this.updateProfile(workerId);
  }

  recordStall(workerId: string): void {
    const profile = this.profiles.get(workerId);
    if (!profile) return;

    // Mark current state
    profile.stallRate = this.calculateStallRate(workerId);
    profile.efficiencyScore = this.calculateEfficiency(profile);
  }

  // ==========================================================================
  // PROFILE UPDATES
  // ==========================================================================

  private updateProfile(workerId: string): void {
    const profile = this.profiles.get(workerId);
    const samples = this.samples.get(workerId);
    if (!profile || !samples || samples.length === 0) return;

    const successSamples = samples.filter(s => s.success);
    if (successSamples.length === 0) return;

    // Calculate timing statistics
    const times = successSamples.map(s => s.duration);
    profile.averageChunkTime = times.reduce((a, b) => a + b, 0) / times.length;
    
    const variance = times.reduce((sum, t) => sum + Math.pow(t - profile.averageChunkTime, 2), 0) / times.length;
    profile.stdDeviation = Math.sqrt(variance);

    // Update counts
    profile.chunksProcessed = successSamples.length;
    profile.bytesProcessed = BigInt(successSamples.reduce((sum, s) => sum + s.bytes, 0));

    // Calculate throughput
    const recentSamples = successSamples.slice(-10);
    if (recentSamples.length > 0) {
      const totalBytes = recentSamples.reduce((sum, s) => sum + s.bytes, 0);
      const totalTime = recentSamples.reduce((sum, s) => sum + s.duration, 0);
      profile.sustainedThroughput = totalTime > 0 ? (totalBytes / totalTime) * 1000 : 0;
      
      // Peak throughput
      for (const sample of recentSamples) {
        const throughput = sample.duration > 0 ? (sample.bytes / sample.duration) * 1000 : 0;
        if (throughput > profile.peakThroughput) {
          profile.peakThroughput = throughput;
        }
      }
    }

    // Error rate
    const totalSamples = samples.length;
    const failedSamples = samples.filter(s => !s.success).length;
    profile.errorRate = totalSamples > 0 ? failedSamples / totalSamples : 0;

    // WASM warm state
    profile.wasmWarmState = this.detectWasmState(profile);

    // Memory footprint
    if (this.config.trackMemory) {
      profile.memoryFootprint = this.estimateMemoryFootprint(workerId);
    }

    // Efficiency score
    profile.efficiencyScore = this.calculateEfficiency(profile);
  }

  private detectWasmState(profile: WorkerProfile): WASMState {
    if (!this.config.trackWasmState) return 'warm';

    // Cold: high variance, slow times
    // Warm: moderate variance, decent times
    // Hot: low variance, fast times

    if (profile.chunksProcessed < 3) return 'cold';

    const cv = profile.averageChunkTime > 0 
      ? profile.stdDeviation / profile.averageChunkTime 
      : 1;

    if (cv < 0.1 && profile.averageChunkTime < 50) {
      return 'hot';
    } else if (cv < 0.3 || profile.chunksProcessed > 10) {
      return 'warm';
    }
    return 'cold';
  }

  private estimateMemoryFootprint(_workerId: string): number {
    // In browser, we can't get per-worker memory
    // Estimate based on total heap growth
    if (typeof performance !== 'undefined' && (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory) {
      const current = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
      const workerCount = this.profiles.size || 1;
      return (current - this.memoryBaseline) / workerCount;
    }
    return 0;
  }

  private calculateEfficiency(profile: WorkerProfile): number {
    // Efficiency based on:
    // - Low error rate (40%)
    // - High throughput relative to baseline (30%)
    // - Low variance (20%)
    // - Good warm state (10%)

    const errorScore = 1 - profile.errorRate;
    const stallScore = 1 - profile.stallRate;
    
    // Throughput score (relative to 100MB/s baseline)
    const baselineThroughput = 100 * MB;
    const throughputScore = Math.min(1, profile.sustainedThroughput / baselineThroughput);
    
    // Variance score (lower is better)
    const cv = profile.averageChunkTime > 0 
      ? profile.stdDeviation / profile.averageChunkTime 
      : 1;
    const varianceScore = Math.max(0, 1 - cv);
    
    // Warm state score
    const warmScore = profile.wasmWarmState === 'hot' ? 1 
                    : profile.wasmWarmState === 'warm' ? 0.7 
                    : 0.3;

    return (
      errorScore * 0.3 +
      stallScore * 0.1 +
      throughputScore * 0.3 +
      varianceScore * 0.2 +
      warmScore * 0.1
    );
  }

  private calculateStallRate(workerId: string): number {
    const samples = this.samples.get(workerId);
    if (!samples || samples.length === 0) return 0;

    // Check for gaps in timestamps (stalls)
    let stallCount = 0;
    for (let i = 1; i < samples.length; i++) {
      const gap = samples[i].timestamp - samples[i - 1].timestamp;
      // If gap > 2x average duration, count as stall
      const avgDuration = samples.slice(0, i)
        .filter(s => s.success)
        .reduce((sum, s) => sum + s.duration, 0) / i;
      
      if (gap > avgDuration * 2 + 1000) {
        stallCount++;
      }
    }

    return samples.length > 1 ? stallCount / (samples.length - 1) : 0;
  }

  // ==========================================================================
  // PROFILE ACCESS
  // ==========================================================================

  getProfile(workerId: string): WorkerProfile | null {
    return this.profiles.get(workerId) || null;
  }

  getAllProfiles(): WorkerProfile[] {
    return Array.from(this.profiles.values());
  }

  getProfilesByEfficiency(): WorkerProfile[] {
    return Array.from(this.profiles.values())
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore);
  }

  getProfilesByThroughput(): WorkerProfile[] {
    return Array.from(this.profiles.values())
      .sort((a, b) => b.sustainedThroughput - a.sustainedThroughput);
  }

  // ==========================================================================
  // OUTLIER DETECTION
  // ==========================================================================

  detectOutliers(): string[] {
    const outliers: string[] = [];
    const profiles = Array.from(this.profiles.values());
    
    if (profiles.length < 3) return outliers;

    // Calculate mean efficiency
    const mean = profiles.reduce((sum, p) => sum + p.efficiencyScore, 0) / profiles.length;
    const variance = profiles.reduce((sum, p) => sum + Math.pow(p.efficiencyScore - mean, 2), 0) / profiles.length;
    const stdDev = Math.sqrt(variance);

    // Mark outliers (efficiency too low)
    for (const profile of profiles) {
      if (profile.efficiencyScore < mean - this.config.outlierThreshold * stdDev) {
        outliers.push(profile.workerId);
      }
    }

    return outliers;
  }

  // ==========================================================================
  // RECOMMENDATIONS
  // ==========================================================================

  getRecommendations(): {
    workerId: string;
    recommendation: 'scale-up' | 'scale-down' | 'restart' | 'none';
    reason: string;
  }[] {
    const recommendations: {
      workerId: string;
      recommendation: 'scale-up' | 'scale-down' | 'restart' | 'none';
      reason: string;
    }[] = [];

    for (const profile of this.profiles.values()) {
      if (profile.errorRate > 0.3) {
        recommendations.push({
          workerId: profile.workerId,
          recommendation: 'restart',
          reason: `High error rate: ${(profile.errorRate * 100).toFixed(1)}%`,
        });
      } else if (profile.efficiencyScore < 0.3) {
        recommendations.push({
          workerId: profile.workerId,
          recommendation: 'scale-down',
          reason: `Low efficiency: ${(profile.efficiencyScore * 100).toFixed(1)}%`,
        });
      } else if (profile.efficiencyScore > 0.9 && profile.wasmWarmState === 'hot') {
        recommendations.push({
          workerId: profile.workerId,
          recommendation: 'scale-up',
          reason: 'High efficiency with hot WASM state',
        });
      } else {
        recommendations.push({
          workerId: profile.workerId,
          recommendation: 'none',
          reason: 'Operating within normal parameters',
        });
      }
    }

    return recommendations;
  }

  // ==========================================================================
  // AGGREGATED STATISTICS
  // ==========================================================================

  getAggregatedStats(): {
    totalWorkers: number;
    activeWorkers: number;
    avgThroughput: number;
    totalThroughput: number;
    avgEfficiency: number;
    avgErrorRate: number;
    coldWorkers: number;
    warmWorkers: number;
    hotWorkers: number;
    totalBytesProcessed: bigint;
    totalChunksProcessed: number;
  } {
    const profiles = Array.from(this.profiles.values());
    
    if (profiles.length === 0) {
      return {
        totalWorkers: 0,
        activeWorkers: 0,
        avgThroughput: 0,
        totalThroughput: 0,
        avgEfficiency: 0,
        avgErrorRate: 0,
        coldWorkers: 0,
        warmWorkers: 0,
        hotWorkers: 0,
        totalBytesProcessed: BigInt(0),
        totalChunksProcessed: 0,
      };
    }

    const activeWorkers = profiles.filter(p => p.chunksProcessed > 0).length;
    const totalThroughput = profiles.reduce((sum, p) => sum + p.sustainedThroughput, 0);
    const avgThroughput = totalThroughput / profiles.length;
    const avgEfficiency = profiles.reduce((sum, p) => sum + p.efficiencyScore, 0) / profiles.length;
    const avgErrorRate = profiles.reduce((sum, p) => sum + p.errorRate, 0) / profiles.length;

    let coldWorkers = 0;
    let warmWorkers = 0;
    let hotWorkers = 0;
    let totalBytesProcessed = BigInt(0);
    let totalChunksProcessed = 0;

    for (const profile of profiles) {
      switch (profile.wasmWarmState) {
        case 'cold': coldWorkers++; break;
        case 'warm': warmWorkers++; break;
        case 'hot': hotWorkers++; break;
      }
      totalBytesProcessed += profile.bytesProcessed;
      totalChunksProcessed += profile.chunksProcessed;
    }

    return {
      totalWorkers: profiles.length,
      activeWorkers,
      avgThroughput,
      totalThroughput,
      avgEfficiency,
      avgErrorRate,
      coldWorkers,
      warmWorkers,
      hotWorkers,
      totalBytesProcessed,
      totalChunksProcessed,
    };
  }

  // ==========================================================================
  // PERIODIC UPDATES
  // ==========================================================================

  startPeriodicUpdates(): void {
    if (this.updateTimer) return;

    this.updateTimer = setInterval(() => {
      for (const workerId of this.profiles.keys()) {
        this.updateProfile(workerId);
      }
    }, this.config.updateInterval);
  }

  stopPeriodicUpdates(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  reset(): void {
    this.profiles.clear();
    this.samples.clear();
    this.stopPeriodicUpdates();
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createWorkerProfiler(
  config?: Partial<ProfilerConfig>
): WorkerProfiler {
  return new WorkerProfiler(config);
}
