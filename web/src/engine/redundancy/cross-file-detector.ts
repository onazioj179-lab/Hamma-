/**
 * SPK Dynamic Redundancy Detection Engine - Cross-File Detector
 * Creator: OJ Treasure Onazi
 * 
 * Detects redundancy patterns across multiple files,
 * enabling compression families and shared block detection.
 */

import {
  ChunkSignature,
  RedundancyClass,
  CompressionFamily,
  CompressionMode,
  CrossFileAnalysis,
  SharedBlock,
  FileRelationship,
} from './types';

// ============================================================================
// CROSS-FILE DETECTOR
// ============================================================================

export class CrossFileDetector {
  // File signature aggregates - hash is number now
  private fileSignatures: Map<string, {
    signatures: ChunkSignature[];
    hash: number;
    entropy: number;
  }> = new Map();

  // Shared block tracking - use number hash as key
  private sharedBlocks: Map<number, SharedBlock> = new Map();
  
  // File relationships
  private relationships: Map<string, Set<string>> = new Map(); // fileId -> related fileIds
  
  // Compression families
  private families: Map<string, CompressionFamily> = new Map(); // familyId -> family

  // Config
  private readonly maxSharedBlocks: number;
  private readonly similarityThreshold: number;
  private readonly minSharedForFamily: number;

  constructor(config?: {
    maxSharedBlocks?: number;
    similarityThreshold?: number;
    minSharedForFamily?: number;
  }) {
    this.maxSharedBlocks = config?.maxSharedBlocks ?? 50000;
    this.similarityThreshold = config?.similarityThreshold ?? 0.7;
    this.minSharedForFamily = config?.minSharedForFamily ?? 3;
  }

  // ==========================================================================
  // SIGNATURE REGISTRATION
  // ==========================================================================

  /**
   * Register a chunk signature from a file
   */
  registerSignature(signature: ChunkSignature): void {
    const fileId = signature.fileId || 'default';
    
    // Get or create file aggregate
    let fileData = this.fileSignatures.get(fileId);
    if (!fileData) {
      fileData = { signatures: [], hash: 0, entropy: 0 };
      this.fileSignatures.set(fileId, fileData);
    }

    // Add signature (limited to prevent memory issues)
    if (fileData.signatures.length < 1000) {
      fileData.signatures.push(signature);
    }

    // Update file hash (XOR of chunk hashes for simplicity)
    fileData.hash ^= signature.hash;
    
    // Update running entropy average
    const count = fileData.signatures.length;
    fileData.entropy = ((fileData.entropy * (count - 1)) + signature.entropy) / count;

    // Check for shared blocks
    this.checkSharedBlock(signature);
  }

  /**
   * Check if this signature matches blocks from other files
   */
  private checkSharedBlock(signature: ChunkSignature): void {
    const fileId = signature.fileId || 'default';
    const hash = signature.hash;

    let block = this.sharedBlocks.get(hash);
    
    if (!block) {
      // First occurrence
      if (this.sharedBlocks.size < this.maxSharedBlocks) {
        block = {
          hash,
          size: signature.size,
          fileIds: new Set([fileId]),
          indices: new Map([[fileId, [signature.index]]]),
          occurrenceCount: 1,
          entropy: signature.entropy,
        };
        this.sharedBlocks.set(hash, block);
      }
    } else {
      // Additional occurrence
      block.occurrenceCount++;
      
      if (!block.fileIds.has(fileId)) {
        block.fileIds.add(fileId);
        block.indices.set(fileId, [signature.index]);
        
        // Update relationships between files
        this.updateRelationships(fileId, block.fileIds);
      } else {
        // Same file, different chunk
        const indices = block.indices.get(fileId)!;
        if (indices.length < 100) { // Limit indices per file
          indices.push(signature.index);
        }
      }
    }
  }

  /**
   * Update file relationships based on shared blocks
   */
  private updateRelationships(newFileId: string, sharedWith: Set<string>): void {
    for (const existingFileId of sharedWith) {
      if (existingFileId === newFileId) continue;
      
      // Add bidirectional relationship
      let rels = this.relationships.get(newFileId);
      if (!rels) {
        rels = new Set();
        this.relationships.set(newFileId, rels);
      }
      rels.add(existingFileId);

      let existingRels = this.relationships.get(existingFileId);
      if (!existingRels) {
        existingRels = new Set();
        this.relationships.set(existingFileId, existingRels);
      }
      existingRels.add(newFileId);
    }

    // Check if we should form a family
    this.checkForFamily(newFileId);
  }

  // ==========================================================================
  // COMPRESSION FAMILIES
  // ==========================================================================

  /**
   * Check if file should join or form a compression family
   */
  private checkForFamily(fileId: string): void {
    const relations = this.relationships.get(fileId);
    if (!relations || relations.size < this.minSharedForFamily - 1) {
      return;
    }

    // Check if file is already in a family
    for (const family of this.families.values()) {
      if (family.fileIds.has(fileId)) {
        // Update existing family
        for (const relatedId of relations) {
          if (!family.fileIds.has(relatedId)) {
            this.addToFamily(family, relatedId);
          }
        }
        return;
      }
    }

    // Check if any related file is in a family
    for (const relatedId of relations) {
      for (const family of this.families.values()) {
        if (family.fileIds.has(relatedId)) {
          this.addToFamily(family, fileId);
          return;
        }
      }
    }

    // Create new family
    this.createFamily(fileId, relations);
  }

  /**
   * Create a new compression family
   */
  private createFamily(primaryFileId: string, relatedIds: Set<string>): void {
    const familyId = `family_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const fileIds = new Set([primaryFileId, ...relatedIds]);
    
    // Calculate shared blocks
    const familySharedBlocks: SharedBlock[] = [];
    for (const block of this.sharedBlocks.values()) {
      const intersection = [...block.fileIds].filter(id => fileIds.has(id));
      if (intersection.length >= 2) {
        familySharedBlocks.push(block);
      }
    }

    // Analyze file data for recommendations
    const entropies: number[] = [];
    for (const fid of fileIds) {
      const fd = this.fileSignatures.get(fid);
      if (fd) entropies.push(fd.entropy);
    }
    
    const avgEntropy = entropies.length > 0
      ? entropies.reduce((a, b) => a + b, 0) / entropies.length
      : 0.5;

    const family: CompressionFamily = {
      id: familyId,
      name: `Pattern Group ${this.families.size + 1}`,
      fileIds,
      commonPatterns: [],
      sharedBlocks: familySharedBlocks.slice(0, 100), // Limit stored blocks
      recommendedMode: this.selectFamilyMode(avgEntropy, familySharedBlocks.length),
      averageRatio: this.estimateFamilyRatio(avgEntropy, familySharedBlocks.length),
      memberCount: fileIds.size,
    };

    this.families.set(familyId, family);
  }

  /**
   * Add a file to an existing family
   */
  private addToFamily(family: CompressionFamily, fileId: string): void {
    family.fileIds.add(fileId);
    
    // Update shared blocks
    for (const block of this.sharedBlocks.values()) {
      if (block.fileIds.has(fileId)) {
        const familyIntersection = [...block.fileIds].filter(id => family.fileIds.has(id));
        if (familyIntersection.length >= 2) {
          if (!family.sharedBlocks.includes(block) && family.sharedBlocks.length < 100) {
            family.sharedBlocks.push(block);
          }
        }
      }
    }

    // Recalculate recommendations
    const entropies: number[] = [];
    for (const fid of family.fileIds) {
      const fd = this.fileSignatures.get(fid);
      if (fd) entropies.push(fd.entropy);
    }
    
    const avgEntropy = entropies.length > 0
      ? entropies.reduce((a, b) => a + b, 0) / entropies.length
      : 0.5;

    family.recommendedMode = this.selectFamilyMode(avgEntropy, family.sharedBlocks.length);
    family.averageRatio = this.estimateFamilyRatio(avgEntropy, family.sharedBlocks.length);
  }

  /**
   * Select compression mode for a family
   */
  private selectFamilyMode(avgEntropy: number, sharedBlockCount: number): CompressionMode {
    // Many shared blocks = deduplication is very effective
    if (sharedBlockCount > 50) {
      return 'lightweight'; // Fast since we'll deduplicate a lot
    }
    
    if (avgEntropy < 0.3) {
      return 'lightweight';
    } else if (avgEntropy < 0.6) {
      return 'structural';
    } else if (avgEntropy < 0.8) {
      return 'strong';
    }
    
    return 'auto';
  }

  /**
   * Estimate compression ratio for a family
   */
  private estimateFamilyRatio(avgEntropy: number, sharedBlockCount: number): number {
    // Base ratio from entropy
    let ratio = avgEntropy * 0.8 + 0.1;
    
    // Bonus for shared blocks (deduplication)
    const dedupBonus = Math.min(0.3, sharedBlockCount * 0.005);
    ratio -= dedupBonus;
    
    return Math.max(0.1, Math.min(0.9, ratio));
  }

  // ==========================================================================
  // ANALYSIS QUERIES
  // ==========================================================================

  /**
   * Get cross-file analysis for a specific file
   */
  analyzeFile(fileId: string): CrossFileAnalysis | null {
    const fileData = this.fileSignatures.get(fileId);
    if (!fileData) return null;

    const relations = this.relationships.get(fileId);
    
    // Find shared blocks involving this file
    const sharedWithOthers: SharedBlock[] = [];
    let totalSharedBytes = 0n;
    
    for (const block of this.sharedBlocks.values()) {
      if (block.fileIds.has(fileId) && block.fileIds.size > 1) {
        sharedWithOthers.push(block);
        totalSharedBytes += BigInt(block.size) * BigInt(block.occurrenceCount - 1);
      }
    }

    // Find family
    let family: CompressionFamily | undefined;
    for (const f of this.families.values()) {
      if (f.fileIds.has(fileId)) {
        family = f;
        break;
      }
    }

    // Build relationships list
    const fileRelationships: FileRelationship[] = [];
    if (relations) {
      for (const relatedId of relations) {
        const sharedCount = sharedWithOthers.filter(
          b => b.fileIds.has(relatedId)
        ).length;
        
        const similarity = this.calculateFileSimilarity(fileId, relatedId);
        
        fileRelationships.push({
          fileId: relatedId,
          sharedBlocks: sharedCount,
          similarity,
        });
      }
    }

    return {
      fileId,
      chunkCount: fileData.signatures.length,
      averageEntropy: fileData.entropy,
      sharedBlocks: sharedWithOthers.length,
      sharedBytes: totalSharedBytes,
      relatedFiles: fileRelationships.sort((a, b) => b.similarity - a.similarity),
      family: family ? {
        id: family.id,
        memberCount: family.fileIds.size,
        recommendedMode: family.recommendedMode,
      } : undefined,
    };
  }

  /**
   * Calculate similarity between two files
   */
  private calculateFileSimilarity(fileIdA: string, fileIdB: string): number {
    let sharedCount = 0;
    let totalCount = 0;

    for (const block of this.sharedBlocks.values()) {
      const hasA = block.fileIds.has(fileIdA);
      const hasB = block.fileIds.has(fileIdB);
      
      if (hasA || hasB) {
        totalCount++;
        if (hasA && hasB) {
          sharedCount++;
        }
      }
    }

    return totalCount > 0 ? sharedCount / totalCount : 0;
  }

  /**
   * Get compression family for a file
   */
  getFamily(fileId: string): CompressionFamily | null {
    for (const family of this.families.values()) {
      if (family.fileIds.has(fileId)) {
        return family;
      }
    }
    return null;
  }

  /**
   * Get all families
   */
  getAllFamilies(): CompressionFamily[] {
    return [...this.families.values()];
  }

  // ==========================================================================
  // REDUNDANCY DETECTION
  // ==========================================================================

  /**
   * Classify redundancy for a new chunk across all known files
   */
  classifyGlobalRedundancy(signature: ChunkSignature): {
    redundancyClass: RedundancyClass;
    matchingFiles: string[];
    occurrences: number;
  } {
    const block = this.sharedBlocks.get(signature.hash);
    
    if (!block) {
      return {
        redundancyClass: 'unique',
        matchingFiles: [],
        occurrences: 0,
      };
    }

    const matchingFiles = [...block.fileIds];
    const occurrences = block.occurrenceCount;

    let redundancyClass: RedundancyClass;
    
    if (occurrences >= 5) {
      redundancyClass = 'duplicate';
    } else if (occurrences >= 2) {
      redundancyClass = 'near-duplicate';
    } else {
      redundancyClass = 'unique';
    }

    return {
      redundancyClass,
      matchingFiles,
      occurrences,
    };
  }

  /**
   * Find all duplicates of a chunk across files
   */
  findCrossFileDuplicates(hash: number): {
    fileId: string;
    indices: number[];
  }[] {
    const block = this.sharedBlocks.get(hash);
    if (!block) return [];

    const results: { fileId: string; indices: number[] }[] = [];
    
    for (const [fileId, indices] of block.indices) {
      results.push({ fileId, indices });
    }

    return results;
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  getStats(): {
    filesTracked: number;
    sharedBlocks: number;
    families: number;
    totalRelationships: number;
    potentialSavings: bigint;
  } {
    let totalRelationships = 0;
    for (const rels of this.relationships.values()) {
      totalRelationships += rels.size;
    }
    totalRelationships /= 2; // Bidirectional counted twice

    // Calculate potential savings from deduplication
    let potentialSavings = 0n;
    for (const block of this.sharedBlocks.values()) {
      if (block.occurrenceCount > 1) {
        potentialSavings += BigInt(block.size) * BigInt(block.occurrenceCount - 1);
      }
    }

    return {
      filesTracked: this.fileSignatures.size,
      sharedBlocks: this.sharedBlocks.size,
      families: this.families.size,
      totalRelationships,
      potentialSavings,
    };
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): number {
    let usage = 0;
    
    // File signatures
    for (const fd of this.fileSignatures.values()) {
      usage += fd.signatures.length * 200; // ~200 bytes per signature
    }
    
    // Shared blocks
    usage += this.sharedBlocks.size * 300;
    
    // Relationships
    let relCount = 0;
    for (const rels of this.relationships.values()) {
      relCount += rels.size;
    }
    usage += relCount * 50;
    
    // Families
    for (const family of this.families.values()) {
      usage += family.fileIds.size * 50;
      usage += family.sharedBlocks.length * 100;
    }

    return usage;
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Prune old/unused data to free memory
   */
  prune(maxFiles?: number, maxBlocks?: number): {
    filesRemoved: number;
    blocksRemoved: number;
  } {
    let filesRemoved = 0;
    let blocksRemoved = 0;

    // Prune files if over limit
    if (maxFiles && this.fileSignatures.size > maxFiles) {
      // Remove files with fewest signatures (least data)
      const sorted = [...this.fileSignatures.entries()]
        .sort((a, b) => a[1].signatures.length - b[1].signatures.length);
      
      const toRemove = this.fileSignatures.size - maxFiles;
      for (let i = 0; i < toRemove; i++) {
        const fileId = sorted[i][0];
        this.fileSignatures.delete(fileId);
        this.relationships.delete(fileId);
        filesRemoved++;
      }
    }

    // Prune blocks if over limit
    if (maxBlocks && this.sharedBlocks.size > maxBlocks) {
      // Remove blocks with lowest occurrence count
      const sorted = [...this.sharedBlocks.entries()]
        .sort((a, b) => a[1].occurrenceCount - b[1].occurrenceCount);
      
      const toRemove = this.sharedBlocks.size - maxBlocks;
      for (let i = 0; i < toRemove; i++) {
        this.sharedBlocks.delete(sorted[i][0]);
        blocksRemoved++;
      }
    }

    return { filesRemoved, blocksRemoved };
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.fileSignatures.clear();
    this.sharedBlocks.clear();
    this.relationships.clear();
    this.families.clear();
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createCrossFileDetector(config?: {
  maxSharedBlocks?: number;
  similarityThreshold?: number;
  minSharedForFamily?: number;
}): CrossFileDetector {
  return new CrossFileDetector(config);
}
