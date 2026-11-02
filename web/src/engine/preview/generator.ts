/**
 * Preview Generator
 * Generates thumbnails and previews for various file types
 */

import type {
  ArchiveFileEntry,
  PreviewData,
  PreviewMetadata,
  PreviewType,
  ScanOptions,
} from './types';
import { MIME_TO_PREVIEW, DEFAULT_SCAN_OPTIONS } from './types';

/**
 * Preview generator for different file types
 */
export class PreviewGenerator {
  private options: ScanOptions;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(options: Partial<ScanOptions> = {}) {
    this.options = { ...DEFAULT_SCAN_OPTIONS, ...options };
    
    // Try to create offscreen canvas for thumbnail generation
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(
        this.options.maxThumbnailSize,
        this.options.maxThumbnailSize
      );
      this.ctx = this.canvas.getContext('2d');
    }
  }

  /**
   * Generate preview for a file
   */
  async generate(file: ArchiveFileEntry, data?: ArrayBuffer): Promise<PreviewData> {
    const previewType = this.getPreviewType(file.mimeType);

    const preview: PreviewData = {
      type: previewType,
      mimeType: file.mimeType,
      available: false,
    };

    if (!data) {
      return preview;
    }

    try {
      switch (previewType) {
        case 'image':
          return await this.generateImagePreview(file, data);
        case 'video':
          return await this.generateVideoPreview(file, data);
        case 'audio':
          return await this.generateAudioPreview(file, data);
        case 'text':
        case 'code':
          return await this.generateTextPreview(file, data);
        case '3d':
          return await this.generate3DPreview(file, data);
        case 'document':
          return await this.generateDocumentPreview(file, data);
        default:
          return preview;
      }
    } catch {
      return preview;
    }
  }

  /**
   * Get preview type from MIME type
   */
  private getPreviewType(mimeType: string): PreviewType {
    return MIME_TO_PREVIEW[mimeType] || 'unknown';
  }

  /**
   * Generate image preview with thumbnail
   */
  private async generateImagePreview(
    file: ArchiveFileEntry,
    data: ArrayBuffer
  ): Promise<PreviewData> {
    const blob = new Blob([data], { type: file.mimeType });
    const url = URL.createObjectURL(blob);

    try {
      // Load image to get dimensions
      const img = await this.loadImage(url);
      
      // Generate thumbnail
      let thumbnail: Uint8Array | undefined;
      let thumbnailUrl: string | undefined;
      
      if (this.canvas && this.ctx) {
        thumbnail = await this.generateThumbnail(img);
        // Create a copy to ensure proper ArrayBuffer type
        const thumbnailCopy = new Uint8Array(thumbnail);
        const thumbnailBlob = new Blob([thumbnailCopy], { type: 'image/png' });
        thumbnailUrl = URL.createObjectURL(thumbnailBlob);
      }

      const metadata: PreviewMetadata = {
        width: img.width,
        height: img.height,
        hasAlpha: file.mimeType === 'image/png' || file.mimeType === 'image/webp',
      };

      return {
        type: 'image',
        mimeType: file.mimeType,
        available: true,
        thumbnail,
        thumbnailUrl,
        metadata,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Load image from URL
   */
  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Generate thumbnail from image
   */
  private async generateThumbnail(img: HTMLImageElement): Promise<Uint8Array> {
    if (!this.canvas || !this.ctx) {
      throw new Error('Canvas not available');
    }

    const maxSize = this.options.maxThumbnailSize;
    
    // Calculate thumbnail dimensions
    let width = img.width;
    let height = img.height;
    
    if (width > height) {
      if (width > maxSize) {
        height = Math.round(height * maxSize / width);
        width = maxSize;
      }
    } else {
      if (height > maxSize) {
        width = Math.round(width * maxSize / height);
        height = maxSize;
      }
    }

    this.canvas.width = width;
    this.canvas.height = height;
    
    this.ctx.drawImage(img, 0, 0, width, height);
    
    const blob = await this.canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    
    return new Uint8Array(buffer);
  }

  /**
   * Generate video preview
   */
  private async generateVideoPreview(
    file: ArchiveFileEntry,
    data: ArrayBuffer
  ): Promise<PreviewData> {
    // Extract video metadata from header
    const view = new Uint8Array(data);
    
    // Try to detect duration and codec from container
    const metadata = this.parseVideoMetadata(view);

    return {
      type: 'video',
      mimeType: file.mimeType,
      available: true,
      metadata,
      duration: metadata.duration,
      frameCount: metadata.duration && metadata.frameRate 
        ? Math.floor(metadata.duration * metadata.frameRate)
        : undefined,
    };
  }

  /**
   * Parse video container metadata
   */
  private parseVideoMetadata(data: Uint8Array): PreviewMetadata {
    // Simplified MP4/WebM detection
    const metadata: PreviewMetadata = {};

    // Check for MP4
    if (data.length > 12 && 
        data[4] === 0x66 && data[5] === 0x74 && 
        data[6] === 0x79 && data[7] === 0x70) {
      metadata.codec = 'H.264/AAC';
    }
    
    // Check for WebM
    if (data.length > 4 && 
        data[0] === 0x1A && data[1] === 0x45 && 
        data[2] === 0xDF && data[3] === 0xA3) {
      metadata.codec = 'VP8/VP9';
    }

    return metadata;
  }

  /**
   * Generate audio preview
   */
  private async generateAudioPreview(
    file: ArchiveFileEntry,
    data: ArrayBuffer
  ): Promise<PreviewData> {
    const view = new Uint8Array(data);
    const metadata = this.parseAudioMetadata(view);

    return {
      type: 'audio',
      mimeType: file.mimeType,
      available: true,
      metadata,
      duration: metadata.duration,
    };
  }

  /**
   * Parse audio metadata
   */
  private parseAudioMetadata(data: Uint8Array): PreviewMetadata {
    const metadata: PreviewMetadata = {};

    // Check for MP3 frame header
    if (data.length > 3 && data[0] === 0xFF && (data[1] & 0xE0) === 0xE0) {
      metadata.codec = 'MP3';
    }

    // Check for OGG
    if (data.length > 4 && 
        data[0] === 0x4F && data[1] === 0x67 && 
        data[2] === 0x67 && data[3] === 0x53) {
      metadata.codec = 'Vorbis/Opus';
    }

    return metadata;
  }

  /**
   * Generate text/code preview
   */
  private async generateTextPreview(
    file: ArchiveFileEntry,
    data: ArrayBuffer
  ): Promise<PreviewData> {
    const decoder = new TextDecoder();
    const text = decoder.decode(data);
    
    // Get first N lines
    const lines = text.split('\n');
    const previewLines = lines.slice(0, this.options.previewTextLines);
    const textPreview = previewLines.join('\n');

    // Detect language from extension
    const language = this.detectLanguage(file.extension);

    return {
      type: file.mimeType.startsWith('text/') ? 'text' : 'code',
      mimeType: file.mimeType,
      available: true,
      textPreview,
      metadata: {
        encoding: 'utf-8',
        lineCount: lines.length,
        language,
      },
    };
  }

  /**
   * Detect programming language from extension
   */
  private detectLanguage(extension: string): string {
    const langMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'javascript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.cs': 'csharp',
      '.php': 'php',
      '.html': 'html',
      '.css': 'css',
      '.json': 'json',
      '.xml': 'xml',
      '.md': 'markdown',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.sql': 'sql',
      '.sh': 'bash',
      '.bat': 'batch',
      '.ps1': 'powershell',
    };

    return langMap[extension] || 'plaintext';
  }

  /**
   * Generate 3D model preview
   */
  private async generate3DPreview(
    file: ArchiveFileEntry,
    data: ArrayBuffer
  ): Promise<PreviewData> {
    const metadata = this.parse3DMetadata(file.mimeType, data);

    return {
      type: '3d',
      mimeType: file.mimeType,
      available: true,
      metadata,
    };
  }

  /**
   * Parse 3D model metadata
   */
  private parse3DMetadata(mimeType: string, data: ArrayBuffer): PreviewMetadata {
    const metadata: PreviewMetadata = {
      materials: [],
    };

    // GLTF/GLB parsing
    if (mimeType.includes('gltf')) {
      try {
        if (mimeType.includes('binary')) {
          // GLB format - has header
          const view = new DataView(data);
          // First 12 bytes are header: magic (4), version (4), length (4)
          const version = view.getUint32(4, true);
          metadata.vertexCount = version; // Placeholder
        } else {
          // GLTF JSON
          const decoder = new TextDecoder();
          const json = JSON.parse(decoder.decode(data));
          
          if (json.meshes) {
            let vertices = 0;
            let faces = 0;
            
            for (const mesh of json.meshes) {
              for (const prim of mesh.primitives || []) {
                // Count from accessors
                vertices += 100; // Placeholder
                faces += 50;
              }
            }
            
            metadata.vertexCount = vertices;
            metadata.faceCount = faces;
          }
          
          if (json.materials) {
            metadata.materials = json.materials.map((m: any) => m.name || 'Unnamed');
          }
        }
      } catch {
        // Parsing failed
      }
    }

    return metadata;
  }

  /**
   * Generate document preview
   */
  private async generateDocumentPreview(
    file: ArchiveFileEntry,
    data: ArrayBuffer
  ): Promise<PreviewData> {
    const metadata: PreviewMetadata = {};

    // PDF parsing
    if (file.mimeType === 'application/pdf') {
      const view = new Uint8Array(data);
      const pageCount = this.countPDFPages(view);
      metadata.pageCount = pageCount;
    }

    return {
      type: 'document',
      mimeType: file.mimeType,
      available: true,
      metadata,
    };
  }

  /**
   * Count pages in PDF
   */
  private countPDFPages(data: Uint8Array): number {
    // Simple page count by searching for /Type /Page
    const decoder = new TextDecoder();
    const text = decoder.decode(data);
    
    // Count /Type /Page occurrences (excluding /Type /Pages)
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 1;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.canvas = null;
    this.ctx = null;
  }
}

/**
 * Create preview generator instance
 */
export function createPreviewGenerator(options?: Partial<ScanOptions>): PreviewGenerator {
  return new PreviewGenerator(options);
}
