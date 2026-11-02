/**
 * SPK Hard Constraint Engine - Input Validator
 * Creator: OJ Treasure Onazi
 * 
 * Validates input against hard limits before job starts:
 * - Maximum 10TB total input
 * - Maximum 5,000 files
 * - Minimum 100KB per file
 */

import {
  HARD_LIMITS,
  KB, MB, GB, TB,
  type ValidationResult,
  type ValidationError,
  type MassiveFileEntry,
  type CompressionProfile,
  FILE_TYPE_PROFILES,
} from './types';

// ============================================================================
// FILE TYPE DETECTION
// ============================================================================

const MIME_TO_PROFILE: Record<string, CompressionProfile> = {
  // Text
  'text/plain': 'text',
  'text/html': 'text',
  'text/css': 'text',
  'text/javascript': 'text',
  'application/javascript': 'text',
  'application/json': 'json',
  'application/xml': 'text',
  'text/xml': 'text',
  'text/markdown': 'text',
  
  // CSV/Logs
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/tab-separated-values': 'csv',
  'text/x-log': 'log',
  
  // Images
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/bmp': 'image',
  'image/tiff': 'image',
  'image/svg+xml': 'text',
  
  // Video
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/mpeg': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  
  // Audio
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/webm': 'audio',
  'audio/flac': 'audio',
  
  // Archives
  'application/zip': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/x-7z-compressed': 'archive',
  'application/gzip': 'archive',
  'application/x-tar': 'archive',
  
  // Binary
  'application/octet-stream': 'binary',
  'application/x-executable': 'binary',
  'application/x-sharedlib': 'binary',
};

const EXTENSION_TO_PROFILE: Record<string, CompressionProfile> = {
  // Text
  '.txt': 'text',
  '.html': 'text',
  '.htm': 'text',
  '.css': 'text',
  '.js': 'text',
  '.ts': 'text',
  '.jsx': 'text',
  '.tsx': 'text',
  '.md': 'text',
  '.xml': 'text',
  '.yaml': 'text',
  '.yml': 'text',
  '.toml': 'text',
  '.ini': 'text',
  '.conf': 'text',
  '.cfg': 'text',
  '.py': 'text',
  '.rb': 'text',
  '.java': 'text',
  '.c': 'text',
  '.cpp': 'text',
  '.h': 'text',
  '.hpp': 'text',
  '.rs': 'text',
  '.go': 'text',
  '.swift': 'text',
  '.kt': 'text',
  '.scala': 'text',
  '.php': 'text',
  '.sql': 'text',
  '.sh': 'text',
  '.bat': 'text',
  '.ps1': 'text',
  
  // JSON
  '.json': 'json',
  '.jsonl': 'json',
  
  // CSV/Logs
  '.csv': 'csv',
  '.tsv': 'csv',
  '.log': 'log',
  
  // Images
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  '.ico': 'image',
  '.svg': 'text',
  
  // Video
  '.mp4': 'video',
  '.webm': 'video',
  '.mpeg': 'video',
  '.mpg': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.flv': 'video',
  '.wmv': 'video',
  
  // Audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.aac': 'audio',
  '.m4a': 'audio',
  '.wma': 'audio',
  
  // Archives
  '.zip': 'archive',
  '.rar': 'archive',
  '.7z': 'archive',
  '.gz': 'archive',
  '.tar': 'archive',
  '.bz2': 'archive',
  '.xz': 'archive',
  
  // Binary
  '.exe': 'binary',
  '.dll': 'binary',
  '.so': 'binary',
  '.dylib': 'binary',
  '.bin': 'binary',
  '.dat': 'binary',
  '.db': 'binary',
  '.sqlite': 'binary',
  '.wasm': 'binary',
};

/**
 * Detect compression profile from file
 */
export function detectCompressionProfile(file: File | MassiveFileEntry | { name: string; type?: string }): CompressionProfile {
  // Try MIME type first
  const mimeType = 'type' in file ? file.type : '';
  if (mimeType && MIME_TO_PROFILE[mimeType]) {
    return MIME_TO_PROFILE[mimeType];
  }
  
  // Fall back to extension
  const name = file.name.toLowerCase();
  const lastDot = name.lastIndexOf('.');
  if (lastDot !== -1) {
    const ext = name.slice(lastDot);
    if (EXTENSION_TO_PROFILE[ext]) {
      return EXTENSION_TO_PROFILE[ext];
    }
  }
  
  return 'generic';
}

/**
 * Get expected compression ratio for profile
 */
export function getExpectedRatio(profile: CompressionProfile): number {
  return FILE_TYPE_PROFILES[profile].expectedRatio;
}

// ============================================================================
// INPUT VALIDATOR
// ============================================================================

export class InputValidator {
  private limits = HARD_LIMITS;

  /**
   * Validate files against hard constraints
   */
  validate(files: File[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];
    
    // Track stats
    let totalSize = 0;
    let minFileSize = Infinity;
    let maxFileSize = 0;
    
    // Check file count
    if (files.length > this.limits.MAX_FILE_COUNT) {
      errors.push({
        code: 'FILE_COUNT_EXCEEDED',
        message: `File count exceeds ${this.limits.MAX_FILE_COUNT}`,
        details: {
          limit: this.limits.MAX_FILE_COUNT,
          actual: files.length,
        },
      });
    }
    
    if (files.length === 0) {
      errors.push({
        code: 'FILE_INVALID',
        message: 'No files provided',
      });
    }
    
    // Check each file
    for (const file of files) {
      // Invalid file
      if (!file || !file.name) {
        errors.push({
          code: 'FILE_INVALID',
          message: 'Invalid file entry',
        });
        continue;
      }
      
      // File too small
      if (file.size < this.limits.MIN_FILE_SIZE) {
        errors.push({
          code: 'FILE_TOO_SMALL',
          message: `File too small or invalid: ${file.name} (${this.formatSize(file.size)})`,
          details: {
            limit: this.limits.MIN_FILE_SIZE,
            actual: file.size,
            file: file.name,
          },
        });
      }
      
      // Track sizes
      totalSize += file.size;
      minFileSize = Math.min(minFileSize, file.size);
      maxFileSize = Math.max(maxFileSize, file.size);
    }
    
    // Check total size
    if (totalSize > this.limits.MAX_TOTAL_INPUT_SIZE) {
      errors.push({
        code: 'TOTAL_SIZE_EXCEEDED',
        message: `Total size exceeds supported maximum (${this.formatSize(this.limits.MAX_TOTAL_INPUT_SIZE)})`,
        details: {
          limit: this.limits.MAX_TOTAL_INPUT_SIZE,
          actual: totalSize,
        },
      });
    }
    
    // Add warnings
    if (totalSize > 1 * TB) {
      warnings.push(`Large job detected: ${this.formatSize(totalSize)}. This may take several hours.`);
    }
    
    if (files.length > 1000) {
      warnings.push(`High file count: ${files.length}. Consider batching for better performance.`);
    }
    
    if (maxFileSize > 100 * GB) {
      warnings.push(`Very large file detected: ${this.formatSize(maxFileSize)}. Extra memory management active.`);
    }
    
    // Estimate partitions and duration
    const estimatedPartitions = Math.ceil(totalSize / (1 * GB));
    const throughputEstimate = 100 * MB; // Conservative 100MB/s
    const estimatedDuration = totalSize / throughputEstimate * 1000; // ms
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        totalSize,
        fileCount: files.length,
        avgFileSize: files.length > 0 ? totalSize / files.length : 0,
        minFileSize: minFileSize === Infinity ? 0 : minFileSize,
        maxFileSize,
        estimatedPartitions,
        estimatedDuration,
      },
    };
  }

  /**
   * Create MassiveFileEntry array from Files
   */
  createFileEntries(files: File[]): MassiveFileEntry[] {
    return files.map((file, index) => {
      const profile = detectCompressionProfile(file);
      
      return {
        id: `file_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        path: file.webkitRelativePath || file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
        file,
        compressionProfile: profile,
        state: 'pending' as const,
      };
    });
  }

  /**
   * Validate offset doesn't overflow
   */
  validateOffset(offset: bigint): boolean {
    return offset <= this.limits.MAX_64BIT_OFFSET;
  }

  /**
   * Validate offset is safe for JS number
   */
  isOffsetSafeForNumber(offset: bigint): boolean {
    return offset <= this.limits.MAX_SAFE_OFFSET;
  }

  /**
   * Format size for display
   */
  formatSize(bytes: number): string {
    if (bytes >= TB) return `${(bytes / TB).toFixed(2)} TB`;
    if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
    if (bytes >= KB) return `${(bytes / KB).toFixed(2)} KB`;
    return `${bytes} B`;
  }

  /**
   * Format duration for display
   */
  formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let validatorInstance: InputValidator | null = null;

export function getInputValidator(): InputValidator {
  if (!validatorInstance) {
    validatorInstance = new InputValidator();
  }
  return validatorInstance;
}

export function resetInputValidator(): void {
  validatorInstance = null;
}
