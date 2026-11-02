/**
 * SPK Hard Constraint Engine - Compression Profiler
 * Creator: OJ Treasure Onazi
 * 
 * Section 8: Compression Target (~1/3 original size)
 * - Per-file-type tuning
 * - Skip already-compressed files
 * - Track actual vs target ratios
 */

import {
  KB, MB, GB,
  type CompressionProfile,
  type MassiveFileEntry,
  FILE_TYPE_PROFILES,
} from './types';

// ============================================================================
// COMPRESSION CONSTANTS
// ============================================================================

/**
 * Target compression ratio (compressed/original)
 */
export const TARGET_RATIO = 0.33; // ~1/3 original size

/**
 * Acceptable ratio variance
 */
export const RATIO_TOLERANCE = 0.1; // ±10%

/**
 * Pre-compressed formats that should be stored rather than compressed
 */
export const PRE_COMPRESSED_FORMATS = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  
  // Audio
  'audio/mpeg',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/mp4',
  
  // Video
  'video/mp4',
  'video/webm',
  'video/mpeg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  
  // Archives
  'application/zip',
  'application/gzip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/x-bzip2',
  'application/x-xz',
  'application/x-lz4',
  'application/zstd',
  
  // Documents (already compressed)
  'application/pdf',
  'application/epub+zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/**
 * Extension-based pre-compressed detection
 */
export const PRE_COMPRESSED_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif',
  
  // Audio
  '.mp3', '.aac', '.ogg', '.opus', '.flac', '.m4a',
  
  // Video
  '.mp4', '.webm', '.mkv', '.avi', '.mov', '.mpg', '.mpeg',
  
  // Archives
  '.zip', '.gz', '.7z', '.rar', '.bz2', '.xz', '.lz4', '.zst', '.br',
  
  // Documents
  '.pdf', '.epub', '.docx', '.xlsx', '.pptx',
  
  // Game/App assets
  '.pak', '.bundle', '.apk', '.ipa',
]);

// ============================================================================
// COMPRESSION PROFILE TYPES
// ============================================================================

export interface CompressionSettings {
  level: number;
  strategy: 'default' | 'filtered' | 'huffman' | 'rle' | 'fixed';
  windowBits: number;
  memLevel: number;
  chunkSize: number;
  skip: boolean;
}

export interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  meetsTarget: boolean;
  timeTaken: number;
  profile: CompressionProfile;
}

export interface ProfileStatistics {
  profile: CompressionProfile;
  filesProcessed: number;
  totalOriginal: number;
  totalCompressed: number;
  avgRatio: number;
  minRatio: number;
  maxRatio: number;
  targetHitRate: number;
  avgCompressionTime: number;
}

// ============================================================================
// COMPRESSION SETTINGS PER PROFILE
// ============================================================================

const PROFILE_SETTINGS: Record<CompressionProfile, CompressionSettings> = {
  text: {
    level: 9,           // Maximum compression for text
    strategy: 'default',
    windowBits: 15,     // Maximum window
    memLevel: 9,        // Maximum memory
    chunkSize: 4 * MB,  // Larger chunks for better compression
    skip: false,
  },
  
  binary: {
    level: 6,
    strategy: 'default',
    windowBits: 15,
    memLevel: 8,
    chunkSize: 8 * MB,
    skip: false,
  },
  
  image: {
    level: 1,           // Minimal - already compressed
    strategy: 'default',
    windowBits: 9,      // Small window
    memLevel: 4,
    chunkSize: 16 * MB,
    skip: true,         // Skip compression for most images
  },
  
  video: {
    level: 1,
    strategy: 'default',
    windowBits: 9,
    memLevel: 4,
    chunkSize: 32 * MB,
    skip: true,         // Skip compression for video
  },
  
  audio: {
    level: 1,
    strategy: 'default',
    windowBits: 9,
    memLevel: 4,
    chunkSize: 16 * MB,
    skip: true,         // Skip compression for audio
  },
  
  archive: {
    level: 1,
    strategy: 'default',
    windowBits: 9,
    memLevel: 4,
    chunkSize: 32 * MB,
    skip: true,         // Skip - already compressed
  },
  
  log: {
    level: 8,           // High compression - logs are repetitive
    strategy: 'default',
    windowBits: 15,
    memLevel: 9,
    chunkSize: 8 * MB,
    skip: false,
  },
  
  csv: {
    level: 7,           // Good compression for tabular data
    strategy: 'filtered', // Better for structured data
    windowBits: 15,
    memLevel: 8,
    chunkSize: 8 * MB,
    skip: false,
  },
  
  json: {
    level: 7,
    strategy: 'default',
    windowBits: 15,
    memLevel: 8,
    chunkSize: 4 * MB,
    skip: false,
  },
  
  generic: {
    level: 6,           // Balanced default
    strategy: 'default',
    windowBits: 15,
    memLevel: 8,
    chunkSize: 8 * MB,
    skip: false,
  },
};

// ============================================================================
// COMPRESSION PROFILER
// ============================================================================

export class CompressionProfiler {
  private statistics: Map<CompressionProfile, ProfileStatistics> = new Map();
  private adaptiveLevels: Map<CompressionProfile, number> = new Map();
  
  // Target tracking
  private targetHits = 0;
  private targetMisses = 0;

  constructor() {
    this.initializeStatistics();
  }

  /**
   * Initialize statistics for all profiles
   */
  private initializeStatistics(): void {
    for (const profile of Object.keys(PROFILE_SETTINGS) as CompressionProfile[]) {
      this.statistics.set(profile, {
        profile,
        filesProcessed: 0,
        totalOriginal: 0,
        totalCompressed: 0,
        avgRatio: FILE_TYPE_PROFILES[profile].expectedRatio,
        minRatio: 1,
        maxRatio: 0,
        targetHitRate: 0,
        avgCompressionTime: 0,
      });
      
      this.adaptiveLevels.set(profile, PROFILE_SETTINGS[profile].level);
    }
  }

  // ---------------------------------------------------------------------------
  // FILE ANALYSIS
  // ---------------------------------------------------------------------------

  /**
   * Check if file is already compressed
   */
  isPreCompressed(file: MassiveFileEntry): boolean {
    // Check MIME type
    if (PRE_COMPRESSED_FORMATS.has(file.file.type)) {
      return true;
    }
    
    // Check extension
    const ext = this.getExtension(file.path).toLowerCase();
    if (PRE_COMPRESSED_EXTENSIONS.has(ext)) {
      return true;
    }
    
    // Check profile
    return PROFILE_SETTINGS[file.compressionProfile].skip;
  }

  /**
   * Get extension from path
   */
  private getExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    return lastDot >= 0 ? path.slice(lastDot) : '';
  }

  /**
   * Get compression settings for file
   */
  getSettings(file: MassiveFileEntry): CompressionSettings {
    const baseSettings = { ...PROFILE_SETTINGS[file.compressionProfile] };
    
    // Use adaptive level if available
    const adaptiveLevel = this.adaptiveLevels.get(file.compressionProfile);
    if (adaptiveLevel !== undefined) {
      baseSettings.level = adaptiveLevel;
    }
    
    // Adjust for file size
    if (file.size > GB) {
      // Large files - reduce memory usage
      baseSettings.memLevel = Math.min(baseSettings.memLevel, 6);
    } else if (file.size < 100 * KB) {
      // Small files - reduce chunk size
      baseSettings.chunkSize = Math.min(baseSettings.chunkSize, file.size * 2);
    }
    
    return baseSettings;
  }

  /**
   * Get recommended compression level for profile
   */
  getRecommendedLevel(profile: CompressionProfile): number {
    return this.adaptiveLevels.get(profile) || PROFILE_SETTINGS[profile].level;
  }

  /**
   * Should skip compression for this file?
   */
  shouldSkip(file: MassiveFileEntry): boolean {
    // Check if pre-compressed
    if (this.isPreCompressed(file)) {
      return true;
    }
    
    // Check if profile indicates skip
    return PROFILE_SETTINGS[file.compressionProfile].skip;
  }

  // ---------------------------------------------------------------------------
  // RESULT TRACKING
  // ---------------------------------------------------------------------------

  /**
   * Record compression result
   */
  recordResult(result: CompressionResult): void {
    const stats = this.statistics.get(result.profile);
    if (!stats) return;
    
    // Update counts
    stats.filesProcessed++;
    stats.totalOriginal += result.originalSize;
    stats.totalCompressed += result.compressedSize;
    
    // Update ratio stats
    stats.minRatio = Math.min(stats.minRatio, result.ratio);
    stats.maxRatio = Math.max(stats.maxRatio, result.ratio);
    stats.avgRatio = stats.totalCompressed / stats.totalOriginal;
    
    // Update target hit rate
    if (result.meetsTarget) {
      this.targetHits++;
    } else {
      this.targetMisses++;
    }
    stats.targetHitRate = this.targetHits / (this.targetHits + this.targetMisses);
    
    // Update timing
    stats.avgCompressionTime = 
      (stats.avgCompressionTime * (stats.filesProcessed - 1) + result.timeTaken) / 
      stats.filesProcessed;
    
    // Adapt compression level
    this.adaptLevel(result.profile, result.ratio);
  }

  /**
   * Adapt compression level based on results
   */
  private adaptLevel(profile: CompressionProfile, achievedRatio: number): void {
    const currentLevel = this.adaptiveLevels.get(profile) || PROFILE_SETTINGS[profile].level;
    const targetRatio = TARGET_RATIO;
    
    // If ratio is too high (not enough compression), increase level
    if (achievedRatio > targetRatio + RATIO_TOLERANCE && currentLevel < 9) {
      this.adaptiveLevels.set(profile, Math.min(9, currentLevel + 1));
    }
    // If ratio is very good, we might reduce level for speed
    else if (achievedRatio < targetRatio - RATIO_TOLERANCE && currentLevel > 1) {
      // Only reduce if we're significantly below target
      if (achievedRatio < targetRatio * 0.7) {
        this.adaptiveLevels.set(profile, Math.max(1, currentLevel - 1));
      }
    }
  }

  /**
   * Create compression result
   */
  createResult(
    originalSize: number,
    compressedSize: number,
    timeTaken: number,
    profile: CompressionProfile
  ): CompressionResult {
    const ratio = originalSize > 0 ? compressedSize / originalSize : 1;
    const meetsTarget = ratio <= TARGET_RATIO + RATIO_TOLERANCE;
    
    return {
      originalSize,
      compressedSize,
      ratio,
      meetsTarget,
      timeTaken,
      profile,
    };
  }

  // ---------------------------------------------------------------------------
  // STATISTICS
  // ---------------------------------------------------------------------------

  /**
   * Get statistics for profile
   */
  getProfileStats(profile: CompressionProfile): ProfileStatistics | undefined {
    return this.statistics.get(profile);
  }

  /**
   * Get all statistics
   */
  getAllStats(): ProfileStatistics[] {
    return Array.from(this.statistics.values());
  }

  /**
   * Get overall compression statistics
   */
  getOverallStats(): {
    totalOriginal: number;
    totalCompressed: number;
    overallRatio: number;
    targetHitRate: number;
    filesProcessed: number;
  } {
    let totalOriginal = 0;
    let totalCompressed = 0;
    let filesProcessed = 0;
    
    for (const stats of this.statistics.values()) {
      totalOriginal += stats.totalOriginal;
      totalCompressed += stats.totalCompressed;
      filesProcessed += stats.filesProcessed;
    }
    
    return {
      totalOriginal,
      totalCompressed,
      overallRatio: totalOriginal > 0 ? totalCompressed / totalOriginal : 1,
      targetHitRate: this.targetHits / Math.max(1, this.targetHits + this.targetMisses),
      filesProcessed,
    };
  }

  /**
   * Check if overall ratio meets target
   */
  meetsTarget(): boolean {
    const stats = this.getOverallStats();
    return stats.overallRatio <= TARGET_RATIO + RATIO_TOLERANCE;
  }

  /**
   * Get compression savings
   */
  getSavings(): {
    byteSaved: number;
    percentageSaved: number;
    humanReadable: string;
  } {
    const stats = this.getOverallStats();
    const saved = stats.totalOriginal - stats.totalCompressed;
    const percentage = stats.totalOriginal > 0 
      ? (saved / stats.totalOriginal) * 100 
      : 0;
    
    return {
      byteSaved: saved,
      percentageSaved: percentage,
      humanReadable: this.formatBytes(saved),
    };
  }

  /**
   * Format bytes as human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(2)} KB`;
    if (bytes < GB) return `${(bytes / MB).toFixed(2)} MB`;
    return `${(bytes / GB).toFixed(2)} GB`;
  }

  // ---------------------------------------------------------------------------
  // PREDICTIONS
  // ---------------------------------------------------------------------------

  /**
   * Predict compression ratio for file
   */
  predictRatio(file: MassiveFileEntry): number {
    const stats = this.statistics.get(file.compressionProfile);
    
    if (stats && stats.filesProcessed > 0) {
      // Use historical average
      return stats.avgRatio;
    }
    
    // Fall back to expected ratio from profile
    return FILE_TYPE_PROFILES[file.compressionProfile].expectedRatio;
  }

  /**
   * Predict compressed size
   */
  predictCompressedSize(file: MassiveFileEntry): number {
    const ratio = this.predictRatio(file);
    return Math.ceil(file.size * ratio);
  }

  /**
   * Predict total archive size
   */
  predictArchiveSize(files: MassiveFileEntry[]): number {
    let total = 0;
    for (const file of files) {
      total += this.predictCompressedSize(file);
    }
    return total;
  }

  // ---------------------------------------------------------------------------
  // RECOMMENDATIONS
  // ---------------------------------------------------------------------------

  /**
   * Get compression recommendations
   */
  getRecommendations(): string[] {
    const recommendations: string[] = [];
    const stats = this.getOverallStats();
    
    // Check overall ratio
    if (stats.overallRatio > TARGET_RATIO + RATIO_TOLERANCE) {
      recommendations.push(
        `Overall ratio (${(stats.overallRatio * 100).toFixed(1)}%) is above target (${(TARGET_RATIO * 100).toFixed(1)}%). ` +
        `Consider increasing compression level.`
      );
    }
    
    // Check individual profiles
    for (const [profile, profileStats] of this.statistics) {
      if (profileStats.filesProcessed < 5) continue; // Need enough data
      
      if (profileStats.avgRatio > TARGET_RATIO + RATIO_TOLERANCE * 2) {
        recommendations.push(
          `${profile} files have low compression (${(profileStats.avgRatio * 100).toFixed(1)}%). ` +
          `Current level: ${this.adaptiveLevels.get(profile)}.`
        );
      }
    }
    
    // Check for pre-compressed files being compressed
    const archiveStats = this.statistics.get('archive');
    const imageStats = this.statistics.get('image');
    const videoStats = this.statistics.get('video');
    
    for (const stats of [archiveStats, imageStats, videoStats]) {
      if (stats && stats.filesProcessed > 0 && stats.avgRatio > 0.95) {
        recommendations.push(
          `${stats.profile} files show minimal compression (${(stats.avgRatio * 100).toFixed(1)}%). ` +
          `These are likely already compressed - consider storing without compression.`
        );
      }
    }
    
    return recommendations;
  }

  // ---------------------------------------------------------------------------
  // RESET
  // ---------------------------------------------------------------------------

  /**
   * Reset profiler
   */
  reset(): void {
    this.statistics.clear();
    this.adaptiveLevels.clear();
    this.targetHits = 0;
    this.targetMisses = 0;
    this.initializeStatistics();
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let profilerInstance: CompressionProfiler | null = null;

export function getCompressionProfiler(): CompressionProfiler {
  if (!profilerInstance) {
    profilerInstance = new CompressionProfiler();
  }
  return profilerInstance;
}

export function resetCompressionProfiler(): void {
  profilerInstance?.reset();
  profilerInstance = null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Quick check if MIME type is pre-compressed
 */
export function isCompressedMimeType(mimeType: string): boolean {
  return PRE_COMPRESSED_FORMATS.has(mimeType);
}

/**
 * Quick check if extension is pre-compressed
 */
export function isCompressedExtension(extension: string): boolean {
  return PRE_COMPRESSED_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Get optimal compression level for MIME type
 */
export function getOptimalLevel(mimeType: string, profile: CompressionProfile): number {
  if (PRE_COMPRESSED_FORMATS.has(mimeType)) {
    return 1; // Minimal compression
  }
  return PROFILE_SETTINGS[profile].level;
}

/**
 * Calculate target compressed size
 */
export function calculateTargetSize(originalSize: number): number {
  return Math.ceil(originalSize * TARGET_RATIO);
}

/**
 * Check if ratio meets target
 */
export function ratioMeetsTarget(ratio: number): boolean {
  return ratio <= TARGET_RATIO + RATIO_TOLERANCE;
}
