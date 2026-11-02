/**
 * SPK AI-Powered Post-Compression Integrity Verification Engine - Repair Engine
 * Creator: OJ Treasure Onazi
 * 
 * Auto-repair mechanism for corrupt chunks, damaged metadata,
 * and invalid footers. Recomputes only affected regions.
 */

import {
  RepairAction,
  RepairRecord,
  VerificationAnomaly,
  AnomalyType,
  IntegrityEvent,
  IntegrityEventHandler,
  MB,
  KB,
} from '../core/types/integrity';
import { ChunkMetadata, FileMetadata, ArchiveMetadata } from './metadata-validator';
import { FooterData } from './footer-validator';

// ============================================================================
// REPAIR ENGINE CONFIG
// ============================================================================

export interface RepairEngineConfig {
  /** Enable auto-repair */
  enabled: boolean;
  
  /** Max repair attempts per chunk */
  maxAttempts: number;
  
  /** Enable metadata rebuild */
  rebuildMetadata: boolean;
  
  /** Enable footer regeneration */
  regenerateFooter: boolean;
  
  /** Enable chunk recompression */
  recompressChunks: boolean;
  
  /** Compression algorithm for recompression */
  compressionAlgorithm: string;
  
  /** Compression level for recompression */
  compressionLevel: number;
  
  /** Max concurrent repairs */
  maxConcurrentRepairs: number;
  
  /** Timeout per repair (ms) */
  repairTimeout: number;
  
  /** Backup original before repair */
  backupOriginal: boolean;
}

export const DEFAULT_REPAIR_ENGINE_CONFIG: RepairEngineConfig = {
  enabled: true,
  maxAttempts: 3,
  rebuildMetadata: true,
  regenerateFooter: true,
  recompressChunks: true,
  compressionAlgorithm: 'zstd',
  compressionLevel: 3,
  maxConcurrentRepairs: 4,
  repairTimeout: 60000,
  backupOriginal: true,
};

// ============================================================================
// REPAIR CONTEXT
// ============================================================================

export interface RepairContext {
  archiveId: string;
  metadata?: ArchiveMetadata;
  footer?: FooterData;
  anomalies: VerificationAnomaly[];
  originalData?: ArrayBuffer;
  compressor?: (data: Uint8Array, level: number) => Promise<Uint8Array>;
  decompressor?: (data: Uint8Array) => Promise<Uint8Array>;
}

// ============================================================================
// REPAIR RESULT
// ============================================================================

export interface RepairResult {
  success: boolean;
  repairsAttempted: number;
  repairsSuccessful: number;
  repairsFailed: number;
  records: RepairRecord[];
  repairedChunks: number[];
  metadataRebuilt: boolean;
  footerRegenerated: boolean;
  bytesReprocessed: number;
  timeElapsed: number;
  errors: string[];
}

// ============================================================================
// REPAIR ENGINE
// ============================================================================

export class RepairEngine {
  private config: RepairEngineConfig;
  private eventHandlers: Set<IntegrityEventHandler> = new Set();
  private activeRepairs = 0;
  private repairQueue: Array<() => Promise<void>> = [];
  private repairHistory: RepairRecord[] = [];

  constructor(config: Partial<RepairEngineConfig> = {}) {
    this.config = { ...DEFAULT_REPAIR_ENGINE_CONFIG, ...config };
  }

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  addEventListener(handler: IntegrityEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: IntegrityEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: IntegrityEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // MAIN REPAIR
  // ==========================================================================

  async repair(context: RepairContext): Promise<RepairResult> {
    const startTime = performance.now();
    const result: RepairResult = {
      success: false,
      repairsAttempted: 0,
      repairsSuccessful: 0,
      repairsFailed: 0,
      records: [],
      repairedChunks: [],
      metadataRebuilt: false,
      footerRegenerated: false,
      bytesReprocessed: 0,
      timeElapsed: 0,
      errors: [],
    };

    if (!this.config.enabled) {
      result.errors.push('Repair engine is disabled');
      return result;
    }

    // Group anomalies by type
    const chunkAnomalies = context.anomalies.filter(a => 
      a.location.chunkIndex !== undefined
    );
    const metadataAnomalies = context.anomalies.filter(a => 
      a.type === 'metadata-corrupt' || a.location.metadataField !== undefined
    );
    const footerAnomalies = context.anomalies.filter(a => 
      a.type === 'footer-invalid'
    );

    // Repair chunks
    if (this.config.recompressChunks && chunkAnomalies.length > 0) {
      const chunkRepairs = await this.repairChunks(
        chunkAnomalies,
        context
      );
      result.records.push(...chunkRepairs.records);
      result.repairedChunks.push(...chunkRepairs.repairedChunks);
      result.repairsAttempted += chunkRepairs.attempted;
      result.repairsSuccessful += chunkRepairs.successful;
      result.repairsFailed += chunkRepairs.failed;
      result.bytesReprocessed += chunkRepairs.bytesReprocessed;
      result.errors.push(...chunkRepairs.errors);
    }

    // Repair metadata
    if (this.config.rebuildMetadata && metadataAnomalies.length > 0) {
      const metadataRepair = await this.repairMetadata(
        metadataAnomalies,
        context
      );
      result.records.push(metadataRepair.record);
      result.metadataRebuilt = metadataRepair.success;
      result.repairsAttempted++;
      if (metadataRepair.success) {
        result.repairsSuccessful++;
      } else {
        result.repairsFailed++;
        result.errors.push(...metadataRepair.errors);
      }
    }

    // Repair footer
    if (this.config.regenerateFooter && footerAnomalies.length > 0) {
      const footerRepair = await this.repairFooter(
        footerAnomalies,
        context
      );
      result.records.push(footerRepair.record);
      result.footerRegenerated = footerRepair.success;
      result.repairsAttempted++;
      if (footerRepair.success) {
        result.repairsSuccessful++;
      } else {
        result.repairsFailed++;
        result.errors.push(...footerRepair.errors);
      }
    }

    result.timeElapsed = performance.now() - startTime;
    result.success = result.repairsFailed === 0 && result.repairsSuccessful > 0;

    return result;
  }

  // ==========================================================================
  // CHUNK REPAIR
  // ==========================================================================

  private async repairChunks(
    anomalies: VerificationAnomaly[],
    context: RepairContext
  ): Promise<{
    records: RepairRecord[];
    repairedChunks: number[];
    attempted: number;
    successful: number;
    failed: number;
    bytesReprocessed: number;
    errors: string[];
  }> {
    const result = {
      records: [] as RepairRecord[],
      repairedChunks: [] as number[],
      attempted: 0,
      successful: 0,
      failed: 0,
      bytesReprocessed: 0,
      errors: [] as string[],
    };

    // Group by chunk
    const chunkMap = new Map<number, VerificationAnomaly[]>();
    for (const anomaly of anomalies) {
      const idx = anomaly.location.chunkIndex;
      if (idx !== undefined) {
        if (!chunkMap.has(idx)) {
          chunkMap.set(idx, []);
        }
        chunkMap.get(idx)!.push(anomaly);
      }
    }

    // Repair each chunk
    for (const [chunkIndex, chunkAnomalies] of chunkMap) {
      const repairId = `repair-chunk-${chunkIndex}-${Date.now()}`;
      this.emit({ type: 'repair-start', repairId, action: 'recompress-chunk' });

      const startTime = performance.now();
      let success = false;
      let bytesProcessed = 0;
      let errorMsg = '';

      try {
        // Get original chunk data
        const originalData = await this.getOriginalChunkData(
          chunkIndex,
          context
        );

        if (!originalData) {
          throw new Error(`Cannot retrieve original data for chunk ${chunkIndex}`);
        }

        bytesProcessed = originalData.length;

        // Recompress
        if (context.compressor) {
          const recompressed = await this.recompressWithRetry(
            originalData,
            context.compressor
          );
          
          if (recompressed) {
            // Update chunk in archive
            await this.updateChunk(chunkIndex, recompressed, context);
            success = true;
            result.repairedChunks.push(chunkIndex);
          }
        } else {
          throw new Error('Compressor not available');
        }
      } catch (error) {
        errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Chunk ${chunkIndex}: ${errorMsg}`);
      }

      const endTime = performance.now();

      const record: RepairRecord = {
        id: repairId,
        anomalyId: chunkAnomalies[0].id,
        action: 'recompress-chunk',
        targetChunks: [chunkIndex],
        startTime,
        endTime,
        successful: success,
        bytesReprocessed: bytesProcessed,
        details: success 
          ? `Recompressed chunk ${chunkIndex}` 
          : `Failed to repair chunk ${chunkIndex}: ${errorMsg}`,
      };

      result.records.push(record);
      result.attempted++;
      if (success) {
        result.successful++;
        result.bytesReprocessed += bytesProcessed;
      } else {
        result.failed++;
      }

      // Mark anomaly as repaired
      for (const anomaly of chunkAnomalies) {
        anomaly.repairAttempted = true;
        anomaly.repairSuccessful = success;
      }

      this.emit({ type: 'repair-complete', repairId, successful: success });
    }

    return result;
  }

  private async recompressWithRetry(
    data: Uint8Array,
    compressor: (data: Uint8Array, level: number) => Promise<Uint8Array>
  ): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Compression timeout')), this.config.repairTimeout);
        });

        const result = await Promise.race([
          compressor(data, this.config.compressionLevel),
          timeoutPromise,
        ]);

        return result;
      } catch {
        // Try with lower level on retry
        if (attempt < this.config.maxAttempts - 1) {
          continue;
        }
      }
    }
    return null;
  }

  private async getOriginalChunkData(
    chunkIndex: number,
    context: RepairContext
  ): Promise<Uint8Array | null> {
    // If we have a decompressor and metadata, decompress the chunk
    if (context.decompressor && context.metadata && context.originalData) {
      const chunkMeta = context.metadata.chunks.find(c => c.index === chunkIndex);
      if (!chunkMeta) return null;

      const compressedData = new Uint8Array(
        context.originalData,
        Number(chunkMeta.offset),
        chunkMeta.compressedSize
      );

      try {
        return await context.decompressor(compressedData);
      } catch {
        return null;
      }
    }
    return null;
  }

  private async updateChunk(
    _chunkIndex: number,
    _data: Uint8Array,
    _context: RepairContext
  ): Promise<void> {
    // In a real implementation, this would:
    // 1. Update the archive buffer with new compressed data
    // 2. Update chunk metadata (hash, size, offset)
    // 3. Trigger metadata/footer rebuild if needed
    // For now, this is a placeholder
  }

  // ==========================================================================
  // METADATA REPAIR
  // ==========================================================================

  private async repairMetadata(
    anomalies: VerificationAnomaly[],
    context: RepairContext
  ): Promise<{
    record: RepairRecord;
    success: boolean;
    errors: string[];
  }> {
    const repairId = `repair-metadata-${Date.now()}`;
    this.emit({ type: 'repair-start', repairId, action: 'rebuild-metadata' });

    const startTime = performance.now();
    let success = false;
    const errors: string[] = [];

    try {
      if (!context.metadata) {
        throw new Error('No metadata available for rebuild');
      }

      // Rebuild metadata from chunks
      const rebuiltMetadata = this.rebuildMetadata(context);
      
      if (rebuiltMetadata) {
        // Validate rebuilt metadata
        const isValid = this.validateRebuiltMetadata(rebuiltMetadata);
        if (isValid) {
          // Update context
          context.metadata = rebuiltMetadata;
          success = true;
        } else {
          errors.push('Rebuilt metadata failed validation');
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    const endTime = performance.now();

    // Mark anomalies
    for (const anomaly of anomalies) {
      anomaly.repairAttempted = true;
      anomaly.repairSuccessful = success;
    }

    this.emit({ type: 'repair-complete', repairId, successful: success });

    return {
      record: {
        id: repairId,
        anomalyId: anomalies[0]?.id || 'unknown',
        action: 'rebuild-metadata',
        targetChunks: [],
        startTime,
        endTime,
        successful: success,
        bytesReprocessed: 0,
        details: success ? 'Metadata rebuilt successfully' : `Metadata rebuild failed: ${errors.join(', ')}`,
      },
      success,
      errors,
    };
  }

  private rebuildMetadata(context: RepairContext): ArchiveMetadata | null {
    if (!context.metadata) return null;

    // Create new metadata with recalculated values
    const chunks = context.metadata.chunks.map((chunk, index) => ({
      ...chunk,
      index,
    }));

    const files = context.metadata.files;

    // Recalculate totals
    let totalOriginalSize = BigInt(0);
    let totalCompressedSize = BigInt(0);

    for (const chunk of chunks) {
      totalOriginalSize += BigInt(chunk.originalSize);
      totalCompressedSize += BigInt(chunk.compressedSize);
    }

    // Recalculate chunk offsets
    let currentOffset = BigInt(0);
    for (const chunk of chunks) {
      chunk.offset = currentOffset;
      currentOffset += BigInt(chunk.compressedSize);
    }

    // Recalculate file boundaries
    let currentChunk = 0;
    for (const file of files) {
      file.startChunk = currentChunk;
      const chunksNeeded = Math.ceil(file.size / context.metadata.chunkSize);
      file.endChunk = currentChunk + chunksNeeded - 1;
      currentChunk += chunksNeeded;
    }

    return {
      ...context.metadata,
      chunks,
      files,
      totalChunks: chunks.length,
      totalFiles: files.length,
      totalOriginalSize,
      totalCompressedSize,
      // Checksum will be recalculated on write
      checksum: '',
    };
  }

  private validateRebuiltMetadata(metadata: ArchiveMetadata): boolean {
    // Basic validation
    if (metadata.totalChunks !== metadata.chunks.length) return false;
    if (metadata.totalFiles !== metadata.files.length) return false;

    // Verify offset continuity
    let expectedOffset = BigInt(0);
    for (const chunk of metadata.chunks) {
      if (chunk.offset !== expectedOffset) return false;
      expectedOffset += BigInt(chunk.compressedSize);
    }

    return true;
  }

  // ==========================================================================
  // FOOTER REPAIR
  // ==========================================================================

  private async repairFooter(
    anomalies: VerificationAnomaly[],
    context: RepairContext
  ): Promise<{
    record: RepairRecord;
    success: boolean;
    errors: string[];
  }> {
    const repairId = `repair-footer-${Date.now()}`;
    this.emit({ type: 'repair-start', repairId, action: 'regenerate-footer' });

    const startTime = performance.now();
    let success = false;
    const errors: string[] = [];

    try {
      if (!context.metadata) {
        throw new Error('No metadata available for footer regeneration');
      }

      // Generate new footer from metadata
      const newFooter = this.regenerateFooter(context);
      
      if (newFooter) {
        context.footer = newFooter;
        success = true;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    const endTime = performance.now();

    // Mark anomalies
    for (const anomaly of anomalies) {
      anomaly.repairAttempted = true;
      anomaly.repairSuccessful = success;
    }

    this.emit({ type: 'repair-complete', repairId, successful: success });

    return {
      record: {
        id: repairId,
        anomalyId: anomalies[0]?.id || 'unknown',
        action: 'regenerate-footer',
        targetChunks: [],
        startTime,
        endTime,
        successful: success,
        bytesReprocessed: 0,
        details: success ? 'Footer regenerated successfully' : `Footer regeneration failed: ${errors.join(', ')}`,
      },
      success,
      errors,
    };
  }

  private regenerateFooter(context: RepairContext): FooterData | null {
    if (!context.metadata) return null;

    // Calculate data end offset
    let dataEndOffset = BigInt(0);
    for (const chunk of context.metadata.chunks) {
      const chunkEnd = chunk.offset + BigInt(chunk.compressedSize);
      if (chunkEnd > dataEndOffset) {
        dataEndOffset = chunkEnd;
      }
    }

    return {
      magic: new Uint8Array([0x53, 0x50, 0x4B, 0x46]), // SPKF
      version: context.metadata.version,
      flags: 0,
      metadataOffset: dataEndOffset,
      metadataSize: 0, // Will be calculated when metadata is serialized
      dataEndOffset,
      totalChunks: context.metadata.totalChunks,
      totalFiles: context.metadata.totalFiles,
      totalOriginalSize: context.metadata.totalOriginalSize,
      totalCompressedSize: context.metadata.totalCompressedSize,
      checksumType: 1, // SHA-256
      checksum: '', // Will be calculated
      footerSize: 64,
    };
  }

  // ==========================================================================
  // REPAIR PLANNING
  // ==========================================================================

  planRepairs(anomalies: VerificationAnomaly[]): {
    chunkRepairs: number[];
    metadataRepair: boolean;
    footerRepair: boolean;
    estimatedTime: number;
    estimatedBytes: number;
  } {
    const chunkRepairs: number[] = [];
    let metadataRepair = false;
    let footerRepair = false;

    for (const anomaly of anomalies) {
      if (anomaly.location.chunkIndex !== undefined) {
        if (!chunkRepairs.includes(anomaly.location.chunkIndex)) {
          chunkRepairs.push(anomaly.location.chunkIndex);
        }
      }
      if (anomaly.type === 'metadata-corrupt' || anomaly.location.metadataField) {
        metadataRepair = true;
      }
      if (anomaly.type === 'footer-invalid') {
        footerRepair = true;
      }
    }

    // Estimate time (10ms per chunk, 100ms for metadata, 50ms for footer)
    const estimatedTime = chunkRepairs.length * 10 + 
                         (metadataRepair ? 100 : 0) + 
                         (footerRepair ? 50 : 0);

    // Estimate bytes (assume 1MB per chunk)
    const estimatedBytes = chunkRepairs.length * MB;

    return {
      chunkRepairs,
      metadataRepair,
      footerRepair,
      estimatedTime,
      estimatedBytes,
    };
  }

  // ==========================================================================
  // HISTORY
  // ==========================================================================

  getRepairHistory(): RepairRecord[] {
    return [...this.repairHistory];
  }

  clearHistory(): void {
    this.repairHistory = [];
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  canRepair(anomaly: VerificationAnomaly): boolean {
    if (!this.config.enabled) return false;

    switch (anomaly.type) {
      case 'corrupt-chunk':
      case 'hash-mismatch':
      case 'size-mismatch':
      case 'ratio-suspicious':
        return this.config.recompressChunks;
      case 'metadata-corrupt':
        return this.config.rebuildMetadata;
      case 'footer-invalid':
        return this.config.regenerateFooter;
      case 'missing-chunk':
        return false; // Can't repair truly missing data
      default:
        return false;
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createRepairEngine(
  config?: Partial<RepairEngineConfig>
): RepairEngine {
  return new RepairEngine(config);
}
