/**
 * SPK Incremental Metadata Builder
 * 
 * Maintains a rolling window of metadata for 10TB+ jobs.
 * Compacts older metadata to keep memory bounded.
 * 
 * Features:
 * - Rolling metadata window (configurable size)
 * - Automatic compaction of older entries
 * - Delta-based updates for efficiency
 * - Checkpoint-safe state export/import
 * 
 * Creator: Onazi Treasure (OJ)
 */

import type { 
  ChunkTableEntry, 
  MetadataDelta,
} from './checkpoint-manager';

// ============================================================================
// Types
// ============================================================================

export interface MetadataWindow {
  entries: Map<number, ChunkTableEntry>;
  startIndex: number;
  endIndex: number;
  totalEntries: number;
}

export interface CompactedMetadata {
  ranges: MetadataRange[];
  totalSize: number;
  totalChunks: number;
}

export interface MetadataRange {
  startIndex: number;
  endIndex: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  redundancyGroups: number[];
  checksum: string;
}

export interface MetadataBuilderConfig {
  windowSize: number;         // Max entries in active window
  compactionThreshold: number; // When to trigger compaction
  deltaBufferSize: number;    // Max deltas before flush
}

// ============================================================================
// IncrementalMetadataBuilder
// ============================================================================

const DEFAULT_CONFIG: MetadataBuilderConfig = {
  windowSize: 10000,
  compactionThreshold: 8000,
  deltaBufferSize: 500,
};

export class IncrementalMetadataBuilder {
  private config: MetadataBuilderConfig;
  private activeWindow: MetadataWindow;
  private compactedRanges: MetadataRange[] = [];
  private deltaBuffer: MetadataDelta[] = [];
  private totalChunksProcessed = 0;
  private totalOriginalSize = 0;
  private totalCompressedSize = 0;
  
  constructor(config: Partial<MetadataBuilderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeWindow = {
      entries: new Map(),
      startIndex: 0,
      endIndex: 0,
      totalEntries: 0,
    };
  }
  
  /**
   * Add a new chunk entry
   */
  addEntry(entry: ChunkTableEntry): void {
    // Record delta
    this.recordDelta({
      timestamp: Date.now(),
      chunkIndex: entry.index,
      entry,
      operation: 'add',
    });
    
    // Add to active window
    this.activeWindow.entries.set(entry.index, entry);
    this.activeWindow.endIndex = Math.max(this.activeWindow.endIndex, entry.index);
    this.activeWindow.totalEntries = this.activeWindow.entries.size;
    
    // Update totals
    this.totalChunksProcessed++;
    this.totalOriginalSize += entry.originalSize;
    this.totalCompressedSize += entry.compressedSize;
    
    // Check for compaction
    if (this.activeWindow.entries.size >= this.config.compactionThreshold) {
      this.compact();
    }
  }
  
  /**
   * Update an existing entry (e.g., after refinement)
   */
  updateEntry(entry: ChunkTableEntry): void {
    const existing = this.activeWindow.entries.get(entry.index);
    
    if (existing) {
      // Update totals
      this.totalOriginalSize -= existing.originalSize;
      this.totalCompressedSize -= existing.compressedSize;
      this.totalOriginalSize += entry.originalSize;
      this.totalCompressedSize += entry.compressedSize;
      
      // Record delta
      this.recordDelta({
        timestamp: Date.now(),
        chunkIndex: entry.index,
        entry,
        operation: 'update',
      });
      
      // Update entry
      this.activeWindow.entries.set(entry.index, entry);
    } else {
      // Entry not in window, add as new
      this.addEntry(entry);
    }
  }
  
  /**
   * Get entry by index (may return null if compacted)
   */
  getEntry(index: number): ChunkTableEntry | null {
    return this.activeWindow.entries.get(index) || null;
  }
  
  /**
   * Get all entries in active window
   */
  getActiveEntries(): ChunkTableEntry[] {
    return Array.from(this.activeWindow.entries.values())
      .sort((a, b) => a.index - b.index);
  }
  
  /**
   * Get compacted ranges for archived metadata
   */
  getCompactedRanges(): MetadataRange[] {
    return [...this.compactedRanges];
  }
  
  /**
   * Get current deltas for checkpointing
   */
  getDeltas(): MetadataDelta[] {
    return [...this.deltaBuffer];
  }
  
  /**
   * Clear delta buffer after checkpoint
   */
  clearDeltas(): void {
    this.deltaBuffer = [];
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    totalChunks: number;
    activeWindowSize: number;
    compactedRanges: number;
    totalOriginalSize: number;
    totalCompressedSize: number;
    compressionRatio: number;
  } {
    return {
      totalChunks: this.totalChunksProcessed,
      activeWindowSize: this.activeWindow.entries.size,
      compactedRanges: this.compactedRanges.length,
      totalOriginalSize: this.totalOriginalSize,
      totalCompressedSize: this.totalCompressedSize,
      compressionRatio: this.totalOriginalSize > 0 
        ? this.totalOriginalSize / this.totalCompressedSize 
        : 1,
    };
  }
  
  /**
   * Export state for checkpointing
   */
  exportState(): {
    activeEntries: ChunkTableEntry[];
    compactedRanges: MetadataRange[];
    deltas: MetadataDelta[];
    totals: { chunks: number; original: number; compressed: number };
  } {
    return {
      activeEntries: this.getActiveEntries(),
      compactedRanges: this.compactedRanges,
      deltas: this.deltaBuffer,
      totals: {
        chunks: this.totalChunksProcessed,
        original: this.totalOriginalSize,
        compressed: this.totalCompressedSize,
      },
    };
  }
  
  /**
   * Import state from checkpoint
   */
  importState(state: {
    activeEntries: ChunkTableEntry[];
    compactedRanges: MetadataRange[];
    deltas: MetadataDelta[];
    totals: { chunks: number; original: number; compressed: number };
  }): void {
    // Restore active window
    this.activeWindow.entries.clear();
    for (const entry of state.activeEntries) {
      this.activeWindow.entries.set(entry.index, entry);
    }
    
    if (state.activeEntries.length > 0) {
      this.activeWindow.startIndex = state.activeEntries[0].index;
      this.activeWindow.endIndex = state.activeEntries[state.activeEntries.length - 1].index;
    }
    this.activeWindow.totalEntries = state.activeEntries.length;
    
    // Restore compacted ranges
    this.compactedRanges = state.compactedRanges;
    
    // Restore deltas
    this.deltaBuffer = state.deltas;
    
    // Restore totals
    this.totalChunksProcessed = state.totals.chunks;
    this.totalOriginalSize = state.totals.original;
    this.totalCompressedSize = state.totals.compressed;
  }
  
  /**
   * Compact older entries
   */
  private compact(): void {
    const entries = Array.from(this.activeWindow.entries.entries())
      .sort(([a], [b]) => a - b);
    
    // Keep only recent entries
    const keepCount = Math.floor(this.config.windowSize / 2);
    const toCompact = entries.slice(0, entries.length - keepCount);
    const toKeep = entries.slice(entries.length - keepCount);
    
    if (toCompact.length === 0) return;
    
    // Create compacted range
    const compactedEntries = toCompact.map(([, entry]) => entry);
    const range = this.createCompactedRange(compactedEntries);
    this.compactedRanges.push(range);
    
    // Update active window
    this.activeWindow.entries.clear();
    for (const [index, entry] of toKeep) {
      this.activeWindow.entries.set(index, entry);
    }
    
    if (toKeep.length > 0) {
      this.activeWindow.startIndex = toKeep[0][0];
      this.activeWindow.endIndex = toKeep[toKeep.length - 1][0];
    }
    this.activeWindow.totalEntries = toKeep.length;
  }
  
  /**
   * Create a compacted range from entries
   */
  private createCompactedRange(entries: ChunkTableEntry[]): MetadataRange {
    const redundancyGroupsSet = new Set<number>();
    let totalOriginal = 0;
    let totalCompressed = 0;
    
    for (const entry of entries) {
      totalOriginal += entry.originalSize;
      totalCompressed += entry.compressedSize;
      redundancyGroupsSet.add(entry.redundancyGroup);
    }
    
    // Compute simple checksum
    const checksumData = `${entries[0].index}-${entries[entries.length - 1].index}-${totalOriginal}-${totalCompressed}`;
    let hash = 0;
    for (let i = 0; i < checksumData.length; i++) {
      hash = ((hash << 5) - hash) + checksumData.charCodeAt(i);
      hash = hash & hash;
    }
    
    return {
      startIndex: entries[0].index,
      endIndex: entries[entries.length - 1].index,
      totalOriginalSize: totalOriginal,
      totalCompressedSize: totalCompressed,
      redundancyGroups: Array.from(redundancyGroupsSet),
      checksum: hash.toString(16),
    };
  }
  
  /**
   * Record a metadata delta
   */
  private recordDelta(delta: MetadataDelta): void {
    this.deltaBuffer.push(delta);
    
    // Flush if buffer full
    if (this.deltaBuffer.length > this.config.deltaBufferSize) {
      // Keep only recent deltas
      this.deltaBuffer = this.deltaBuffer.slice(-Math.floor(this.config.deltaBufferSize / 2));
    }
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let metadataBuilderInstance: IncrementalMetadataBuilder | null = null;

export function getMetadataBuilder(): IncrementalMetadataBuilder {
  if (!metadataBuilderInstance) {
    metadataBuilderInstance = new IncrementalMetadataBuilder();
  }
  return metadataBuilderInstance;
}

export function resetMetadataBuilder(): void {
  metadataBuilderInstance = null;
}

export function createMetadataBuilder(
  config?: Partial<MetadataBuilderConfig>
): IncrementalMetadataBuilder {
  return new IncrementalMetadataBuilder(config);
}
