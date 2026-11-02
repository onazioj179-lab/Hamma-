/**
 * SPK Auto-Resume Multi-Day Execution Engine
 * 
 * Enables long-running compression jobs (hours to days) to survive
 * interruptions and resume from the exact last completed chunk.
 * 
 * Features:
 * - Checkpoint system with IndexedDB persistence
 * - Auto-resume on app reopen
 * - Incremental metadata building
 * - Partition-level resume for 10TB+ workloads
 * - Worker and WASM recovery
 * - AI state restoration
 * - Failure-proof writer state
 * 
 * Creator: Onazi Treasure (OJ)
 * License: See LICENSE file
 */

// ============================================================================
// Types
// ============================================================================

export interface CheckpointState {
  // Job identification
  jobId: string;
  jobName: string;
  createdAt: number;
  updatedAt: number;
  
  // File progress
  currentFileIndex: number;
  totalFiles: number;
  
  // Chunk progress
  currentChunkIndex: number;
  totalChunks: number;
  completedChunks: Set<number>;
  pendingChunks: number[];
  
  // Partition state (for 10TB+ workloads)
  partitionIndex: number;
  totalPartitions: number;
  partitionByteOffsets: number[];
  
  // Chunk table entries
  chunkTable: ChunkTableEntry[];
  
  // Refinement state
  refinedChunks: number[];
  refinementPasses: number;
  
  // Entropy signatures
  entropySignatures: Map<number, number>;
  
  // AI state snapshot
  aiState: AIStateSnapshot;
  
  // Scheduler state
  schedulerLaneAssignments: LaneAssignment[];
  
  // Writer state
  writerOffsets: WriterOffsetTable;
  
  // Metadata state
  metadataDeltas: MetadataDelta[];
  
  // Integrity
  checksum: string;
  version: number;
}

export interface ChunkTableEntry {
  index: number;
  originalSize: number;
  compressedSize: number;
  offset: number;
  hash: string;
  isRefined: boolean;
  redundancyGroup: number;
}

export interface AIStateSnapshot {
  lastChunkEntropies: number[];
  throughputCurve: number[];
  redundancyMap: Map<string, number[]>;
  optimizerMode: 'speed' | 'balanced' | 'ratio';
  memoryPressureHistory: number[];
  refinementSuccessPatterns: boolean[];
  predictiveModel: PredictiveModelState;
}

export interface PredictiveModelState {
  weights: number[];
  learningRate: number;
  epochsTrained: number;
  lastAccuracy: number;
}

export interface LaneAssignment {
  laneId: number;
  workerId: number;
  chunkRange: [number, number];
  priority: number;
}

export interface WriterOffsetTable {
  headerOffset: number;
  chunkDataOffset: number;
  metadataOffset: number;
  footerOffset: number;
  lastFlushedChunk: number;
  totalBytesWritten: number;
  partialChunkBuffer: Uint8Array | null;
}

export interface MetadataDelta {
  timestamp: number;
  chunkIndex: number;
  entry: ChunkTableEntry;
  operation: 'add' | 'update' | 'remove';
}

export interface ResumeOptions {
  validateIntegrity: boolean;
  rebuildCorruptedChunks: boolean;
  resetAIState: boolean;
  maxRetries: number;
}

// ============================================================================
// CheckpointManager
// ============================================================================

const DB_NAME = 'spk-checkpoints';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoints';
const MAX_CHECKPOINT_SIZE = 5 * 1024 * 1024; // 5MB limit

export class CheckpointManager {
  private db: IDBDatabase | null = null;
  private pendingWrites: Map<string, CheckpointState> = new Map();
  private writeQueue: Promise<void> = Promise.resolve();
  private isInitialized = false;
  
  /**
   * Initialize IndexedDB connection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(new Error('Failed to open checkpoint database'));
      
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'jobId' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('jobName', 'jobName', { unique: false });
        }
      };
    });
  }
  
  /**
   * Save checkpoint state (non-blocking)
   */
  async save(state: CheckpointState): Promise<void> {
    if (!this.db) await this.initialize();
    
    // Update timestamp and checksum
    state.updatedAt = Date.now();
    state.checksum = this.computeChecksum(state);
    
    // Estimate size for compaction check
    const estimatedSize = JSON.stringify(this.serialize(state)).length;
    if (estimatedSize > MAX_CHECKPOINT_SIZE) {
      // Compact if too large
      state = this.compactCheckpoint(state);
    }
    
    // Queue write to avoid blocking
    this.pendingWrites.set(state.jobId, state);
    this.writeQueue = this.writeQueue.then(() => this.flushWrite(state.jobId));
  }
  
  /**
   * Load checkpoint for a job
   */
  async load(jobId: string): Promise<CheckpointState | null> {
    if (!this.db) await this.initialize();
    
    // Check pending writes first
    if (this.pendingWrites.has(jobId)) {
      return this.pendingWrites.get(jobId)!;
    }
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(jobId);
      
      request.onerror = () => reject(new Error('Failed to load checkpoint'));
      request.onsuccess = () => {
        const data = request.result;
        if (!data) {
          resolve(null);
          return;
        }
        
        const state = this.deserialize(data);
        
        // Validate checksum
        const expectedChecksum = this.computeChecksum(state);
        if (state.checksum !== expectedChecksum) {
          console.warn('Checkpoint checksum mismatch, may be corrupted');
        }
        
        resolve(state);
      };
    });
  }
  
  /**
   * Clear checkpoint for a job
   */
  async clear(jobId: string): Promise<void> {
    if (!this.db) await this.initialize();
    
    this.pendingWrites.delete(jobId);
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(jobId);
      
      request.onerror = () => reject(new Error('Failed to clear checkpoint'));
      request.onsuccess = () => resolve();
    });
  }
  
  /**
   * List all incomplete jobs
   */
  async listIncompleteJobs(): Promise<CheckpointState[]> {
    if (!this.db) await this.initialize();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      
      request.onerror = () => reject(new Error('Failed to list checkpoints'));
      request.onsuccess = () => {
        const jobs = request.result
          .map((data: unknown) => this.deserialize(data))
          .filter((state: CheckpointState) => {
            // Job is incomplete if not all chunks are done
            return state.completedChunks.size < state.totalChunks;
          })
          .sort((a: CheckpointState, b: CheckpointState) => b.updatedAt - a.updatedAt);
        
        resolve(jobs);
      };
    });
  }
  
  /**
   * Flush pending write to IndexedDB
   */
  private async flushWrite(jobId: string): Promise<void> {
    const state = this.pendingWrites.get(jobId);
    if (!state) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const serialized = this.serialize(state);
      const request = store.put(serialized);
      
      request.onerror = () => {
        console.error('Failed to write checkpoint');
        reject(new Error('Checkpoint write failed'));
      };
      
      request.onsuccess = () => {
        this.pendingWrites.delete(jobId);
        resolve();
      };
    });
  }
  
  /**
   * Serialize checkpoint state for storage
   */
  private serialize(state: CheckpointState): unknown {
    return {
      ...state,
      completedChunks: Array.from(state.completedChunks),
      entropySignatures: Array.from(state.entropySignatures.entries()),
      aiState: {
        ...state.aiState,
        redundancyMap: Array.from(state.aiState.redundancyMap.entries()),
      },
      writerOffsets: {
        ...state.writerOffsets,
        partialChunkBuffer: state.writerOffsets.partialChunkBuffer 
          ? Array.from(state.writerOffsets.partialChunkBuffer)
          : null,
      },
    };
  }
  
  /**
   * Deserialize checkpoint state from storage
   */
  private deserialize(data: unknown): CheckpointState {
    const d = data as Record<string, unknown>;
    return {
      ...d,
      completedChunks: new Set(d.completedChunks as number[]),
      entropySignatures: new Map(d.entropySignatures as [number, number][]),
      aiState: {
        ...(d.aiState as Record<string, unknown>),
        redundancyMap: new Map((d.aiState as Record<string, unknown>).redundancyMap as [string, number[]][]),
      },
      writerOffsets: {
        ...(d.writerOffsets as Record<string, unknown>),
        partialChunkBuffer: (d.writerOffsets as Record<string, unknown>).partialChunkBuffer
          ? new Uint8Array((d.writerOffsets as Record<string, unknown>).partialChunkBuffer as number[])
          : null,
      },
    } as CheckpointState;
  }
  
  /**
   * Compute checksum for integrity verification
   */
  private computeChecksum(state: CheckpointState): string {
    const key = `${state.jobId}-${state.currentChunkIndex}-${state.completedChunks.size}-${state.updatedAt}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
  
  /**
   * Compact checkpoint to reduce size
   */
  private compactCheckpoint(state: CheckpointState): CheckpointState {
    // Keep only recent metadata deltas
    const recentDeltas = state.metadataDeltas.slice(-1000);
    
    // Compact entropy signatures to recent window
    const recentEntropies = new Map<number, number>();
    const entries = Array.from(state.entropySignatures.entries());
    entries.slice(-10000).forEach(([k, v]) => recentEntropies.set(k, v));
    
    // Compact AI history
    const compactedAI: AIStateSnapshot = {
      ...state.aiState,
      lastChunkEntropies: state.aiState.lastChunkEntropies.slice(-100),
      throughputCurve: state.aiState.throughputCurve.slice(-100),
      memoryPressureHistory: state.aiState.memoryPressureHistory.slice(-50),
      refinementSuccessPatterns: state.aiState.refinementSuccessPatterns.slice(-100),
    };
    
    return {
      ...state,
      metadataDeltas: recentDeltas,
      entropySignatures: recentEntropies,
      aiState: compactedAI,
    };
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let checkpointManagerInstance: CheckpointManager | null = null;

export function getCheckpointManager(): CheckpointManager {
  if (!checkpointManagerInstance) {
    checkpointManagerInstance = new CheckpointManager();
  }
  return checkpointManagerInstance;
}

export function resetCheckpointManager(): void {
  checkpointManagerInstance = null;
}
