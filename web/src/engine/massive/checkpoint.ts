/**
 * SPK Hard Constraint Engine - Checkpoint Manager
 * Creator: OJ Treasure Onazi
 * 
 * Persists state for long-running massive jobs:
 * - Survives page refresh, app closure, system reboot
 * - Stores partition index, chunk index, metadata, offsets
 * - Enables restart from last checkpoint
 */

import {
  HARD_LIMITS,
  MB,
  type Checkpoint,
  type ChunkMetadataEntry,
  type OffsetEntry,
  type OptimizerState,
  type MassiveJob,
  type Partition,
  type MassiveJobConfig,
  DEFAULT_MASSIVE_CONFIG,
} from './types';

// ============================================================================
// INDEXEDDB STORAGE
// ============================================================================

const DB_NAME = 'spk_massive_checkpoints';
const DB_VERSION = 1;
const STORE_CHECKPOINTS = 'checkpoints';
const STORE_METADATA = 'metadata';
const STORE_OFFSETS = 'offsets';
const STORE_BLOBS = 'blobs';

class CheckpointStorage {
  private db: IDBDatabase | null = null;
  private prefix: string;

  constructor(prefix: string = 'spk_massive_') {
    this.prefix = prefix;
  }

  /**
   * Open database connection
   */
  async open(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(new Error('Failed to open checkpoint database'));

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Checkpoints store
        if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
          const checkpointStore = db.createObjectStore(STORE_CHECKPOINTS, { keyPath: 'id' });
          checkpointStore.createIndex('jobId', 'jobId', { unique: false });
          checkpointStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Metadata store (for large metadata arrays)
        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          const metadataStore = db.createObjectStore(STORE_METADATA, { keyPath: 'id' });
          metadataStore.createIndex('checkpointId', 'checkpointId', { unique: false });
        }

        // Offsets store (for large offset arrays)
        if (!db.objectStoreNames.contains(STORE_OFFSETS)) {
          const offsetStore = db.createObjectStore(STORE_OFFSETS, { keyPath: 'id' });
          offsetStore.createIndex('checkpointId', 'checkpointId', { unique: false });
        }

        // Blobs store (for partial archive data)
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          const blobStore = db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
          blobStore.createIndex('checkpointId', 'checkpointId', { unique: false });
        }
      };
    });
  }

  /**
   * Save checkpoint
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    await this.open();
    if (!this.db) throw new Error('Database not open');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [STORE_CHECKPOINTS, STORE_METADATA, STORE_OFFSETS],
        'readwrite'
      );

      transaction.onerror = () => reject(new Error('Failed to save checkpoint'));
      transaction.oncomplete = () => resolve();

      // Save main checkpoint (without large arrays)
      const checkpointStore = transaction.objectStore(STORE_CHECKPOINTS);
      const checkpointData = {
        ...checkpoint,
        metadataTable: [], // Store separately
        offsetTable: [],   // Store separately
        bytesProcessed: checkpoint.bytesProcessed.toString(),
        bytesTotal: checkpoint.bytesTotal.toString(),
        archiveOffset: checkpoint.archiveOffset.toString(),
      };
      checkpointStore.put(checkpointData);

      // Save metadata in chunks
      const metadataStore = transaction.objectStore(STORE_METADATA);
      const chunkSize = 1000; // 1000 entries per chunk
      for (let i = 0; i < checkpoint.metadataTable.length; i += chunkSize) {
        const chunk = checkpoint.metadataTable.slice(i, i + chunkSize).map(entry => ({
          ...entry,
          offset: entry.offset.toString(),
        }));
        metadataStore.put({
          id: `${checkpoint.id}_metadata_${i}`,
          checkpointId: checkpoint.id,
          startIndex: i,
          entries: chunk,
        });
      }

      // Save offsets in chunks
      const offsetStore = transaction.objectStore(STORE_OFFSETS);
      for (let i = 0; i < checkpoint.offsetTable.length; i += chunkSize) {
        const chunk = checkpoint.offsetTable.slice(i, i + chunkSize).map(entry => ({
          ...entry,
          offset: entry.offset.toString(),
          length: entry.length.toString(),
          originalLength: entry.originalLength.toString(),
        }));
        offsetStore.put({
          id: `${checkpoint.id}_offsets_${i}`,
          checkpointId: checkpoint.id,
          startIndex: i,
          entries: chunk,
        });
      }
    });
  }

  /**
   * Load checkpoint
   */
  async load(checkpointId: string): Promise<Checkpoint | null> {
    await this.open();
    if (!this.db) throw new Error('Database not open');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [STORE_CHECKPOINTS, STORE_METADATA, STORE_OFFSETS],
        'readonly'
      );

      let checkpoint: Checkpoint | null = null;
      const metadataChunks: ChunkMetadataEntry[][] = [];
      const offsetChunks: OffsetEntry[][] = [];

      // Load main checkpoint
      const checkpointStore = transaction.objectStore(STORE_CHECKPOINTS);
      const checkpointRequest = checkpointStore.get(checkpointId);
      
      checkpointRequest.onsuccess = () => {
        const data = checkpointRequest.result;
        if (!data) {
          resolve(null);
          return;
        }

        checkpoint = {
          ...data,
          bytesProcessed: BigInt(data.bytesProcessed),
          bytesTotal: BigInt(data.bytesTotal),
          archiveOffset: BigInt(data.archiveOffset),
          metadataTable: [],
          offsetTable: [],
        };
      };

      // Load metadata chunks
      const metadataStore = transaction.objectStore(STORE_METADATA);
      const metadataIndex = metadataStore.index('checkpointId');
      const metadataRequest = metadataIndex.getAll(checkpointId);
      
      metadataRequest.onsuccess = () => {
        const chunks = metadataRequest.result || [];
        for (const chunk of chunks) {
          metadataChunks[chunk.startIndex / 1000] = chunk.entries.map((entry: Record<string, unknown>) => ({
            ...entry,
            offset: BigInt(entry.offset as string),
          }));
        }
      };

      // Load offset chunks
      const offsetStore = transaction.objectStore(STORE_OFFSETS);
      const offsetIndex = offsetStore.index('checkpointId');
      const offsetRequest = offsetIndex.getAll(checkpointId);
      
      offsetRequest.onsuccess = () => {
        const chunks = offsetRequest.result || [];
        for (const chunk of chunks) {
          offsetChunks[chunk.startIndex / 1000] = chunk.entries.map((entry: Record<string, unknown>) => ({
            ...entry,
            offset: BigInt(entry.offset as string),
            length: BigInt(entry.length as string),
            originalLength: BigInt(entry.originalLength as string),
          }));
        }
      };

      transaction.oncomplete = () => {
        if (checkpoint) {
          checkpoint.metadataTable = metadataChunks.flat();
          checkpoint.offsetTable = offsetChunks.flat();
        }
        resolve(checkpoint);
      };

      transaction.onerror = () => reject(new Error('Failed to load checkpoint'));
    });
  }

  /**
   * Get latest checkpoint for job
   */
  async getLatest(jobId: string): Promise<Checkpoint | null> {
    await this.open();
    if (!this.db) throw new Error('Database not open');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_CHECKPOINTS], 'readonly');
      const store = transaction.objectStore(STORE_CHECKPOINTS);
      const index = store.index('jobId');
      const request = index.getAll(jobId);

      request.onsuccess = async () => {
        const checkpoints = request.result || [];
        if (checkpoints.length === 0) {
          resolve(null);
          return;
        }

        // Find latest by timestamp
        const latest = checkpoints.reduce((a, b) => 
          a.timestamp > b.timestamp ? a : b
        );

        // Load full checkpoint with metadata and offsets
        const full = await this.load(latest.id);
        resolve(full);
      };

      request.onerror = () => reject(new Error('Failed to get latest checkpoint'));
    });
  }

  /**
   * Delete checkpoint
   */
  async delete(checkpointId: string): Promise<void> {
    await this.open();
    if (!this.db) throw new Error('Database not open');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [STORE_CHECKPOINTS, STORE_METADATA, STORE_OFFSETS, STORE_BLOBS],
        'readwrite'
      );

      transaction.onerror = () => reject(new Error('Failed to delete checkpoint'));
      transaction.oncomplete = () => resolve();

      // Delete main checkpoint
      transaction.objectStore(STORE_CHECKPOINTS).delete(checkpointId);

      // Delete metadata chunks
      const metadataStore = transaction.objectStore(STORE_METADATA);
      const metadataIndex = metadataStore.index('checkpointId');
      metadataIndex.getAllKeys(checkpointId).onsuccess = (event) => {
        const keys = (event.target as IDBRequest<IDBValidKey[]>).result;
        for (const key of keys) {
          metadataStore.delete(key);
        }
      };

      // Delete offset chunks
      const offsetStore = transaction.objectStore(STORE_OFFSETS);
      const offsetIndex = offsetStore.index('checkpointId');
      offsetIndex.getAllKeys(checkpointId).onsuccess = (event) => {
        const keys = (event.target as IDBRequest<IDBValidKey[]>).result;
        for (const key of keys) {
          offsetStore.delete(key);
        }
      };

      // Delete blobs
      const blobStore = transaction.objectStore(STORE_BLOBS);
      const blobIndex = blobStore.index('checkpointId');
      blobIndex.getAllKeys(checkpointId).onsuccess = (event) => {
        const keys = (event.target as IDBRequest<IDBValidKey[]>).result;
        for (const key of keys) {
          blobStore.delete(key);
        }
      };
    });
  }

  /**
   * Delete all checkpoints for job
   */
  async deleteJob(jobId: string): Promise<void> {
    await this.open();
    if (!this.db) throw new Error('Database not open');

    const transaction = this.db.transaction([STORE_CHECKPOINTS], 'readonly');
    const store = transaction.objectStore(STORE_CHECKPOINTS);
    const index = store.index('jobId');
    const request = index.getAllKeys(jobId);

    return new Promise((resolve, reject) => {
      request.onsuccess = async () => {
        const ids = request.result as string[];
        for (const id of ids) {
          await this.delete(id);
        }
        resolve();
      };
      request.onerror = () => reject(new Error('Failed to delete job checkpoints'));
    });
  }

  /**
   * Close database
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ============================================================================
// CHECKPOINT MANAGER
// ============================================================================

export class CheckpointManager {
  private config: MassiveJobConfig;
  private storage: CheckpointStorage;
  private currentCheckpoint: Checkpoint | null = null;
  private lastSaveTime = 0;
  private saveInterval: number;
  private checksumSeed = 0xDEADBEEF;

  constructor(config: Partial<MassiveJobConfig> = {}) {
    this.config = { ...DEFAULT_MASSIVE_CONFIG, ...config };
    this.storage = new CheckpointStorage(this.config.storagePrefix);
    this.saveInterval = this.config.checkpointInterval;
  }

  /**
   * Initialize storage
   */
  async initialize(): Promise<void> {
    await this.storage.open();
  }

  /**
   * Create checkpoint from job state
   */
  createCheckpoint(
    job: MassiveJob,
    partitions: Partition[],
    metadataTable: ChunkMetadataEntry[],
    offsetTable: OffsetEntry[],
    optimizerState?: OptimizerState
  ): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `checkpoint_${job.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      jobId: job.id,
      timestamp: Date.now(),
      version: 1,
      
      currentPartitionIndex: job.currentPartitionIndex,
      currentChunkIndex: job.chunksProcessed,
      totalPartitions: partitions.length,
      
      bytesProcessed: job.bytesProcessed,
      bytesTotal: BigInt(job.totalSize),
      filesProcessed: job.filesProcessed,
      filesTotal: job.totalFiles,
      
      archiveOffset: job.compressedSize,
      metadataTable,
      offsetTable,
      
      aiFingerprint: this.generateAIFingerprint(job, optimizerState),
      optimizerState,
      
      historyId: job.historyId,
      checksum: '',
    };

    // Calculate checksum
    checkpoint.checksum = this.calculateChecksum(checkpoint);

    return checkpoint;
  }

  /**
   * Save checkpoint if interval elapsed
   */
  async saveIfNeeded(
    job: MassiveJob,
    partitions: Partition[],
    metadataTable: ChunkMetadataEntry[],
    offsetTable: OffsetEntry[],
    optimizerState?: OptimizerState,
    force = false
  ): Promise<Checkpoint | null> {
    if (!this.config.checkpointEnabled) return null;

    const bytesProcessed = Number(job.bytesProcessed);
    const bytesSinceLast = bytesProcessed - this.lastSaveTime;

    if (!force && bytesSinceLast < this.saveInterval) {
      return null;
    }

    const checkpoint = this.createCheckpoint(
      job,
      partitions,
      metadataTable,
      offsetTable,
      optimizerState
    );

    await this.storage.save(checkpoint);
    this.currentCheckpoint = checkpoint;
    this.lastSaveTime = bytesProcessed;

    return checkpoint;
  }

  /**
   * Force save checkpoint
   */
  async save(
    job: MassiveJob,
    partitions: Partition[],
    metadataTable: ChunkMetadataEntry[],
    offsetTable: OffsetEntry[],
    optimizerState?: OptimizerState
  ): Promise<Checkpoint> {
    const checkpoint = await this.saveIfNeeded(
      job,
      partitions,
      metadataTable,
      offsetTable,
      optimizerState,
      true
    );
    return checkpoint!;
  }

  /**
   * Load latest checkpoint for job
   */
  async loadLatest(jobId: string): Promise<Checkpoint | null> {
    const checkpoint = await this.storage.getLatest(jobId);
    
    if (checkpoint) {
      // Verify checksum
      const expectedChecksum = this.calculateChecksum({
        ...checkpoint,
        checksum: '',
      });
      
      if (expectedChecksum !== checkpoint.checksum) {
        console.warn('Checkpoint checksum mismatch, may be corrupted');
      }
      
      this.currentCheckpoint = checkpoint;
    }
    
    return checkpoint;
  }

  /**
   * Load specific checkpoint
   */
  async load(checkpointId: string): Promise<Checkpoint | null> {
    return this.storage.load(checkpointId);
  }

  /**
   * Delete checkpoint
   */
  async delete(checkpointId: string): Promise<void> {
    await this.storage.delete(checkpointId);
    if (this.currentCheckpoint?.id === checkpointId) {
      this.currentCheckpoint = null;
    }
  }

  /**
   * Delete all checkpoints for job
   */
  async deleteJob(jobId: string): Promise<void> {
    await this.storage.deleteJob(jobId);
    if (this.currentCheckpoint?.jobId === jobId) {
      this.currentCheckpoint = null;
    }
  }

  /**
   * Get current checkpoint
   */
  getCurrent(): Checkpoint | null {
    return this.currentCheckpoint;
  }

  /**
   * Calculate checksum for checkpoint
   */
  private calculateChecksum(checkpoint: Omit<Checkpoint, 'checksum'> & { checksum: string }): string {
    // Simple hash of checkpoint data
    const data = JSON.stringify({
      jobId: checkpoint.jobId,
      timestamp: checkpoint.timestamp,
      currentPartitionIndex: checkpoint.currentPartitionIndex,
      currentChunkIndex: checkpoint.currentChunkIndex,
      bytesProcessed: checkpoint.bytesProcessed.toString(),
      filesProcessed: checkpoint.filesProcessed,
      archiveOffset: checkpoint.archiveOffset.toString(),
      metadataCount: checkpoint.metadataTable.length,
      offsetCount: checkpoint.offsetTable.length,
    });

    let hash = this.checksumSeed;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
    }
    
    return hash.toString(16).padStart(8, '0');
  }

  /**
   * Generate AI fingerprint for state
   */
  private generateAIFingerprint(job: MassiveJob, optimizerState?: OptimizerState): string {
    if (!optimizerState) return '';
    
    const data = {
      mode: optimizerState.mode,
      chunkSize: optimizerState.chunkSize,
      concurrency: optimizerState.concurrency,
      pressure: optimizerState.memoryPressure,
      throughput: job.avgThroughput,
    };
    
    return btoa(JSON.stringify(data)).slice(0, 32);
  }

  /**
   * Reset manager
   */
  reset(): void {
    this.currentCheckpoint = null;
    this.lastSaveTime = 0;
  }

  /**
   * Close storage
   */
  close(): void {
    this.storage.close();
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let checkpointManagerInstance: CheckpointManager | null = null;

export function getCheckpointManager(config?: Partial<MassiveJobConfig>): CheckpointManager {
  if (!checkpointManagerInstance) {
    checkpointManagerInstance = new CheckpointManager(config);
  }
  return checkpointManagerInstance;
}

export async function initializeCheckpointManager(config?: Partial<MassiveJobConfig>): Promise<CheckpointManager> {
  const manager = getCheckpointManager(config);
  await manager.initialize();
  return manager;
}

export function resetCheckpointManager(): void {
  checkpointManagerInstance?.reset();
  checkpointManagerInstance?.close();
  checkpointManagerInstance = null;
}
