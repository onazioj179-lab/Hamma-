/**
 * SPK Ultra-Parallel Throughput Engine - Parallel Scheduler
 * Creator: OJ Treasure Onazi
 * 
 * Manages chunk-to-lane assignment, rebalancing, and work distribution
 * across multiple execution lanes.
 */

import {
  Lane,
  LaneProfile,
  LaneStatus,
  WASMState,
  SchedulerConfig,
  DEFAULT_SCHEDULER_CONFIG,
  ChunkAssignment,
  WorkloadDistribution,
  RebalanceStrategy,
  ParallelEvent,
  ParallelEventHandler,
  ChunkJob,
  getRecommendedLaneCount,
} from './types';

// ============================================================================
// SCHEDULER STATE
// ============================================================================

interface SchedulerState {
  lanes: Map<string, Lane>;
  profiles: Map<string, LaneProfile>;
  assignments: Map<number, ChunkAssignment>;
  pendingChunks: number[];
  completedChunks: Set<number>;
  failedChunks: Map<number, number>; // chunkIndex -> retries
}

// ============================================================================
// PARALLEL SCHEDULER
// ============================================================================

export class ParallelScheduler {
  private config: SchedulerConfig;
  private state: SchedulerState;
  private eventHandlers: Set<ParallelEventHandler> = new Set();
  private rebalanceTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private totalChunks = 0;
  private chunkJobs: Map<number, ChunkJob> = new Map();

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.state = {
      lanes: new Map(),
      profiles: new Map(),
      assignments: new Map(),
      pendingChunks: [],
      completedChunks: new Set(),
      failedChunks: new Map(),
    };
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

  initialize(totalChunks: number): void {
    this.totalChunks = totalChunks;
    this.startTime = performance.now();
    
    // Calculate lane count
    let laneCount = this.config.baseLaneCount;
    if (laneCount === 0) {
      laneCount = getRecommendedLaneCount(
        this.config.physicalCores,
        this.config.turboMode
      );
    }
    
    // Apply multiplier
    laneCount = Math.floor(laneCount * this.config.laneMultiplier);
    
    // Clamp to limits
    laneCount = Math.max(this.config.minLaneCount, Math.min(this.config.maxLaneCount, laneCount));

    // Create lanes
    for (let i = 0; i < laneCount; i++) {
      const laneId = `lane-${i}`;
      const workerId = `worker-${i}`;
      
      const lane: Lane = {
        id: laneId,
        workerId,
        status: 'idle',
        currentChunk: null,
        chunksProcessed: 0,
        bytesProcessed: BigInt(0),
        averageTime: 0,
        stdDeviation: 0,
        stallCount: 0,
        retryCount: 0,
        wasmState: 'cold',
        memoryFootprint: 0,
        lastActivity: Date.now(),
        timeHistory: [],
        errorCount: 0,
      };
      
      this.state.lanes.set(laneId, lane);
      this.emit({ type: 'lane-created', laneId, workerId });
    }

    // Initialize pending chunks
    this.state.pendingChunks = Array.from({ length: totalChunks }, (_, i) => i);
    
    // Start rebalancing timer
    this.startRebalancing();
  }

  // ==========================================================================
  // CHUNK ASSIGNMENT
  // ==========================================================================

  assignChunks(count: number = 1): ChunkAssignment[] {
    const assignments: ChunkAssignment[] = [];
    
    // Find idle lanes
    const idleLanes = Array.from(this.state.lanes.values())
      .filter(lane => lane.status === 'idle' && lane.currentChunk === null);

    // Sort by speed profile (fastest first for adaptive strategy)
    if (this.config.rebalanceStrategy === 'fastest-first' || 
        this.config.rebalanceStrategy === 'adaptive') {
      idleLanes.sort((a, b) => {
        const profileA = this.state.profiles.get(a.id);
        const profileB = this.state.profiles.get(b.id);
        return (profileB?.speedScore || 0) - (profileA?.speedScore || 0);
      });
    }

    // Assign chunks to idle lanes
    const assignCount = Math.min(count, idleLanes.length, this.state.pendingChunks.length);
    
    for (let i = 0; i < assignCount; i++) {
      const lane = idleLanes[i];
      const chunkIndex = this.selectNextChunk(lane);
      
      if (chunkIndex === null) break;

      const assignment: ChunkAssignment = {
        chunkIndex,
        laneId: lane.id,
        priority: this.calculatePriority(chunkIndex),
        assignedAt: Date.now(),
      };

      // Update state
      lane.status = 'active';
      lane.currentChunk = chunkIndex;
      lane.lastActivity = Date.now();
      
      this.state.assignments.set(chunkIndex, assignment);
      this.state.pendingChunks = this.state.pendingChunks.filter(c => c !== chunkIndex);
      
      assignments.push(assignment);
      this.emit({ type: 'lane-assigned', laneId: lane.id, chunkIndex });
    }

    return assignments;
  }

  private selectNextChunk(lane: Lane): number | null {
    if (this.state.pendingChunks.length === 0) return null;

    // For round-robin, just take the first
    if (this.config.rebalanceStrategy === 'round-robin') {
      return this.state.pendingChunks[0];
    }

    // For adaptive, consider lane profile
    const profile = this.state.profiles.get(lane.id);
    
    // If lane is slow, give smaller chunks (if size info available)
    // For now, just return first pending
    return this.state.pendingChunks[0];
  }

  private calculatePriority(chunkIndex: number): number {
    // Earlier chunks get higher priority
    return this.totalChunks - chunkIndex;
  }

  // ==========================================================================
  // COMPLETION HANDLING
  // ==========================================================================

  completeChunk(laneId: string, chunkIndex: number, processingTime: number, bytes: number): void {
    const lane = this.state.lanes.get(laneId);
    if (!lane) return;

    // Update lane stats
    lane.status = 'idle';
    lane.currentChunk = null;
    lane.chunksProcessed++;
    lane.bytesProcessed += BigInt(bytes);
    lane.lastActivity = Date.now();
    
    // Update timing history
    lane.timeHistory.push(processingTime);
    if (lane.timeHistory.length > 50) {
      lane.timeHistory.shift();
    }
    
    // Recalculate average and std dev
    const times = lane.timeHistory;
    lane.averageTime = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = times.reduce((sum, t) => sum + Math.pow(t - lane.averageTime, 2), 0) / times.length;
    lane.stdDeviation = Math.sqrt(variance);
    
    // Update WASM state
    if (lane.chunksProcessed >= this.config.warmupChunks) {
      lane.wasmState = lane.averageTime < 50 ? 'hot' : 'warm';
      if (lane.wasmState === 'hot' || lane.wasmState === 'warm') {
        this.emit({ type: 'warmup-complete', laneId });
      }
    }

    // Update completed set
    this.state.completedChunks.add(chunkIndex);
    this.state.assignments.delete(chunkIndex);

    // Update profile
    this.updateLaneProfile(lane);

    this.emit({ 
      type: 'lane-completed', 
      laneId, 
      chunkIndex, 
      time: processingTime, 
      bytes 
    });
  }

  failChunk(laneId: string, chunkIndex: number, error: string): void {
    const lane = this.state.lanes.get(laneId);
    if (!lane) return;

    lane.status = 'error';
    lane.currentChunk = null;
    lane.errorCount++;
    lane.retryCount++;
    lane.lastActivity = Date.now();

    // Track retries
    const retries = (this.state.failedChunks.get(chunkIndex) || 0) + 1;
    this.state.failedChunks.set(chunkIndex, retries);

    this.emit({ type: 'lane-error', laneId, error });

    // Re-queue if under retry limit
    if (retries < this.config.maxRetries) {
      this.state.pendingChunks.unshift(chunkIndex); // Add to front
      this.state.assignments.delete(chunkIndex);
    }

    // Mark lane as idle after short delay
    setTimeout(() => {
      if (this.state.lanes.get(laneId)?.status === 'error') {
        const lane = this.state.lanes.get(laneId);
        if (lane) {
          lane.status = 'idle';
          this.emit({ type: 'lane-recovered', laneId });
        }
      }
    }, 100);
  }

  // ==========================================================================
  // REBALANCING
  // ==========================================================================

  private startRebalancing(): void {
    if (this.rebalanceTimer) return;

    this.rebalanceTimer = setInterval(() => {
      this.rebalance();
    }, this.config.rebalanceInterval);
  }

  private stopRebalancing(): void {
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
      this.rebalanceTimer = null;
    }
  }

  rebalance(): void {
    this.detectStalledLanes();
    
    if (this.config.rebalanceStrategy === 'adaptive') {
      this.adaptiveRebalance();
    }
  }

  private detectStalledLanes(): void {
    const now = Date.now();
    
    for (const [laneId, lane] of this.state.lanes) {
      if (lane.status === 'active' && lane.currentChunk !== null) {
        const elapsed = now - lane.lastActivity;
        
        if (elapsed > this.config.stallThreshold) {
          lane.status = 'stalled';
          lane.stallCount++;
          this.emit({ type: 'lane-stalled', laneId, reason: 'timeout' });
          
          // Reassign the chunk
          const chunkIndex = lane.currentChunk;
          lane.currentChunk = null;
          lane.status = 'idle';
          
          // Re-queue chunk
          this.state.pendingChunks.unshift(chunkIndex);
          this.state.assignments.delete(chunkIndex);
        }
      }
    }
  }

  private adaptiveRebalance(): void {
    // Get lane profiles
    const profiles = Array.from(this.state.profiles.values());
    if (profiles.length < 2) return;

    // Find overloaded and underloaded lanes
    const avgWorkload = profiles.reduce((sum, p) => sum + this.getWorkload(p.laneId), 0) / profiles.length;
    
    const overloaded = profiles.filter(p => this.getWorkload(p.laneId) > avgWorkload * 1.5);
    const underloaded = profiles.filter(p => 
      this.getWorkload(p.laneId) < avgWorkload * 0.5 && 
      p.speedScore > 0.5
    );

    // Move chunks from overloaded to underloaded
    for (const from of overloaded) {
      const fromLane = this.state.lanes.get(from.laneId);
      if (!fromLane || fromLane.currentChunk === null) continue;

      for (const to of underloaded) {
        const toLane = this.state.lanes.get(to.laneId);
        if (!toLane || toLane.status !== 'idle') continue;

        // Reassign current chunk
        const chunk = fromLane.currentChunk;
        if (chunk !== null) {
          fromLane.currentChunk = null;
          fromLane.status = 'idle';
          
          toLane.currentChunk = chunk;
          toLane.status = 'active';
          toLane.lastActivity = Date.now();
          
          const assignment = this.state.assignments.get(chunk);
          if (assignment) {
            assignment.laneId = to.laneId;
          }

          this.emit({ 
            type: 'rebalance', 
            from: from.laneId, 
            to: to.laneId, 
            chunks: [chunk] 
          });
          break;
        }
      }
    }
  }

  private getWorkload(laneId: string): number {
    const lane = this.state.lanes.get(laneId);
    if (!lane) return 0;
    
    // Pending + current
    let count = lane.currentChunk !== null ? 1 : 0;
    for (const [, assignment] of this.state.assignments) {
      if (assignment.laneId === laneId) count++;
    }
    return count;
  }

  // ==========================================================================
  // PROFILE MANAGEMENT
  // ==========================================================================

  private updateLaneProfile(lane: Lane): void {
    const allLanes = Array.from(this.state.lanes.values());
    const fastestTime = Math.min(...allLanes.map(l => l.averageTime || Infinity));
    
    const profile: LaneProfile = {
      laneId: lane.id,
      speedScore: fastestTime > 0 && lane.averageTime > 0 
        ? fastestTime / lane.averageTime 
        : 1,
      reliabilityScore: lane.chunksProcessed > 0 
        ? 1 - (lane.errorCount / lane.chunksProcessed)
        : 1,
      memoryEfficiency: 1, // Would need memory tracking
      recommendedWorkload: this.calculateWorkloadLevel(lane),
      estimatedThroughput: lane.averageTime > 0 
        ? 1000 / lane.averageTime * 4 * 1024 * 1024 // chunks/sec * chunkSize
        : 0,
      warmupComplete: lane.wasmState !== 'cold',
    };

    this.state.profiles.set(lane.id, profile);
  }

  private calculateWorkloadLevel(lane: Lane): 'high' | 'normal' | 'low' | 'minimal' {
    const profile = this.state.profiles.get(lane.id);
    if (!profile) return 'normal';

    if (profile.speedScore > 0.9 && profile.reliabilityScore > 0.95) {
      return 'high';
    } else if (profile.speedScore > 0.6 && profile.reliabilityScore > 0.8) {
      return 'normal';
    } else if (profile.speedScore > 0.3 || profile.reliabilityScore > 0.5) {
      return 'low';
    }
    return 'minimal';
  }

  // ==========================================================================
  // STATUS AND DISTRIBUTION
  // ==========================================================================

  getWorkloadDistribution(): WorkloadDistribution[] {
    const distribution: WorkloadDistribution[] = [];
    const totalAssigned = this.state.assignments.size + this.state.completedChunks.size;

    for (const [laneId, lane] of this.state.lanes) {
      const assigned: number[] = [];
      let pending = 0;
      
      for (const [chunkIndex, assignment] of this.state.assignments) {
        if (assignment.laneId === laneId) {
          assigned.push(chunkIndex);
          pending++;
        }
      }

      const completed = lane.chunksProcessed;
      const workloadScore = totalAssigned > 0 
        ? (pending + completed) / totalAssigned 
        : 0;

      distribution.push({
        laneId,
        assignedChunks: assigned,
        pendingChunks: pending,
        completedChunks: completed,
        workloadScore,
      });
    }

    return distribution;
  }

  getLaneStatus(): Map<string, LaneStatus> {
    const status = new Map<string, LaneStatus>();
    for (const [id, lane] of this.state.lanes) {
      status.set(id, lane.status);
    }
    return status;
  }

  getLaneProfiles(): LaneProfile[] {
    return Array.from(this.state.profiles.values());
  }

  getProgress(): {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    failed: number;
    percentage: number;
  } {
    const inProgress = Array.from(this.state.assignments.values()).length;
    
    return {
      total: this.totalChunks,
      completed: this.state.completedChunks.size,
      pending: this.state.pendingChunks.length,
      inProgress,
      failed: this.state.failedChunks.size,
      percentage: this.totalChunks > 0 
        ? (this.state.completedChunks.size / this.totalChunks) * 100 
        : 0,
    };
  }

  // ==========================================================================
  // LANE MANAGEMENT
  // ==========================================================================

  addLane(): string {
    const laneCount = this.state.lanes.size;
    const laneId = `lane-${laneCount}`;
    const workerId = `worker-${laneCount}`;
    
    const lane: Lane = {
      id: laneId,
      workerId,
      status: 'idle',
      currentChunk: null,
      chunksProcessed: 0,
      bytesProcessed: BigInt(0),
      averageTime: 0,
      stdDeviation: 0,
      stallCount: 0,
      retryCount: 0,
      wasmState: 'cold',
      memoryFootprint: 0,
      lastActivity: Date.now(),
      timeHistory: [],
      errorCount: 0,
    };
    
    this.state.lanes.set(laneId, lane);
    this.emit({ type: 'lane-created', laneId, workerId });
    
    return laneId;
  }

  removeLane(laneId: string): boolean {
    const lane = this.state.lanes.get(laneId);
    if (!lane || lane.status === 'active') return false;

    // Re-queue any assigned chunks
    for (const [chunkIndex, assignment] of this.state.assignments) {
      if (assignment.laneId === laneId) {
        this.state.pendingChunks.push(chunkIndex);
        this.state.assignments.delete(chunkIndex);
      }
    }

    this.state.lanes.delete(laneId);
    this.state.profiles.delete(laneId);
    
    return true;
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  reset(): void {
    this.stopRebalancing();
    this.state.lanes.clear();
    this.state.profiles.clear();
    this.state.assignments.clear();
    this.state.pendingChunks = [];
    this.state.completedChunks.clear();
    this.state.failedChunks.clear();
    this.totalChunks = 0;
    this.startTime = 0;
  }

  shutdown(): void {
    this.stopRebalancing();
    this.eventHandlers.clear();
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  getStats(): {
    laneCount: number;
    activeLanes: number;
    idleLanes: number;
    stalledLanes: number;
    totalProcessed: number;
    totalBytes: bigint;
    avgProcessingTime: number;
    totalErrors: number;
    elapsedTime: number;
  } {
    let activeLanes = 0;
    let idleLanes = 0;
    let stalledLanes = 0;
    let totalBytes = BigInt(0);
    let totalTime = 0;
    let totalErrors = 0;

    for (const lane of this.state.lanes.values()) {
      switch (lane.status) {
        case 'active': activeLanes++; break;
        case 'idle': idleLanes++; break;
        case 'stalled': stalledLanes++; break;
      }
      totalBytes += lane.bytesProcessed;
      totalTime += lane.averageTime * lane.chunksProcessed;
      totalErrors += lane.errorCount;
    }

    const totalProcessed = this.state.completedChunks.size;
    const avgProcessingTime = totalProcessed > 0 ? totalTime / totalProcessed : 0;

    return {
      laneCount: this.state.lanes.size,
      activeLanes,
      idleLanes,
      stalledLanes,
      totalProcessed,
      totalBytes,
      avgProcessingTime,
      totalErrors,
      elapsedTime: performance.now() - this.startTime,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createParallelScheduler(
  config?: Partial<SchedulerConfig>
): ParallelScheduler {
  return new ParallelScheduler(config);
}
