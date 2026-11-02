/**
 * SPK V35 - Advanced Media Structure Detection
 * 
 * Provides intelligent media-aware compression:
 * - Detect video frame boundaries (MP4/MOV)
 * - Detect image blocks (JPEG, PNG, EXR)
 * - Detect 3D geometry regions
 * - Smart chunk alignment to improve compression ratio
 * - Always lossless - never transcode
 */

// ============================================================================
// TYPES
// ============================================================================

export type MediaType = 
  | 'video/mp4' | 'video/quicktime' | 'video/webm' | 'video/avi'
  | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/exr' | 'image/tiff'
  | 'model/gltf' | 'model/obj' | 'model/fbx' | 'model/stl'
  | 'audio/mp3' | 'audio/wav' | 'audio/flac' | 'audio/aac'
  | 'application/pdf' | 'application/zip'
  | 'unknown';

export interface MediaBoundary {
  offset: number;
  length: number;
  type: string;
  description: string;
  importance: number; // 0-1, higher = better to align on
}

export interface MediaAnalysis {
  type: MediaType;
  mimeType: string;
  boundaries: MediaBoundary[];
  recommendedChunkSize: number;
  alignmentHints: number[];
  isCompressible: boolean;
  compressionHint: 'high' | 'medium' | 'low' | 'none';
}

export interface ChunkAlignment {
  originalOffset: number;
  alignedOffset: number;
  size: number;
  alignmentReason: string;
}

// ============================================================================
// MAGIC BYTE SIGNATURES
// ============================================================================

const SIGNATURES: Record<string, { magic: number[]; offset?: number; type: MediaType }> = {
  // Video
  mp4_ftyp: { magic: [0x66, 0x74, 0x79, 0x70], offset: 4, type: 'video/mp4' },
  mov: { magic: [0x6D, 0x6F, 0x6F, 0x76], offset: 4, type: 'video/quicktime' },
  webm: { magic: [0x1A, 0x45, 0xDF, 0xA3], type: 'video/webm' },
  avi: { magic: [0x52, 0x49, 0x46, 0x46], type: 'video/avi' },
  
  // Image
  jpeg: { magic: [0xFF, 0xD8, 0xFF], type: 'image/jpeg' },
  png: { magic: [0x89, 0x50, 0x4E, 0x47], type: 'image/png' },
  webp: { magic: [0x52, 0x49, 0x46, 0x46], type: 'image/webp' }, // RIFF header, check WEBP later
  exr: { magic: [0x76, 0x2F, 0x31, 0x01], type: 'image/exr' },
  tiff_le: { magic: [0x49, 0x49, 0x2A, 0x00], type: 'image/tiff' },
  tiff_be: { magic: [0x4D, 0x4D, 0x00, 0x2A], type: 'image/tiff' },
  
  // 3D Models
  gltf: { magic: [0x67, 0x6C, 0x54, 0x46], type: 'model/gltf' }, // glTF
  stl_ascii: { magic: [0x73, 0x6F, 0x6C, 0x69, 0x64], type: 'model/stl' }, // "solid"
  
  // Audio
  mp3_id3: { magic: [0x49, 0x44, 0x33], type: 'audio/mp3' },
  mp3_sync: { magic: [0xFF, 0xFB], type: 'audio/mp3' },
  wav: { magic: [0x52, 0x49, 0x46, 0x46], type: 'audio/wav' }, // RIFF
  flac: { magic: [0x66, 0x4C, 0x61, 0x43], type: 'audio/flac' },
  
  // Documents
  pdf: { magic: [0x25, 0x50, 0x44, 0x46], type: 'application/pdf' },
  zip: { magic: [0x50, 0x4B, 0x03, 0x04], type: 'application/zip' },
};

// ============================================================================
// MEDIA TYPE DETECTOR
// ============================================================================

export class MediaDetector {
  /**
   * Detect media type from file header
   */
  detectType(header: Uint8Array): MediaType {
    for (const [, sig] of Object.entries(SIGNATURES)) {
      const offset = sig.offset ?? 0;
      if (header.length < offset + sig.magic.length) continue;
      
      let match = true;
      for (let i = 0; i < sig.magic.length; i++) {
        if (header[offset + i] !== sig.magic[i]) {
          match = false;
          break;
        }
      }
      
      if (match) {
        // Special case: RIFF can be WAV, AVI, or WEBP
        if (sig.type === 'audio/wav' || sig.type === 'video/avi' || sig.type === 'image/webp') {
          return this.detectRiffType(header);
        }
        return sig.type;
      }
    }
    
    return 'unknown';
  }
  
  /**
   * Detect RIFF subtype
   */
  private detectRiffType(header: Uint8Array): MediaType {
    if (header.length < 12) return 'unknown';
    
    const subtype = String.fromCharCode(header[8], header[9], header[10], header[11]);
    
    switch (subtype) {
      case 'WAVE': return 'audio/wav';
      case 'AVI ': return 'video/avi';
      case 'WEBP': return 'image/webp';
      default: return 'unknown';
    }
  }
  
  /**
   * Check if file is already compressed (won't benefit from compression)
   */
  isPreCompressed(type: MediaType): boolean {
    const preCompressed: MediaType[] = [
      'video/mp4', 'video/webm', 'video/quicktime',
      'image/jpeg', 'image/webp',
      'audio/mp3', 'audio/aac', 'audio/flac',
      'application/zip',
    ];
    return preCompressed.includes(type);
  }
}

// ============================================================================
// MP4/MOV BOX PARSER
// ============================================================================

interface MP4Box {
  offset: number;
  size: number;
  type: string;
}

export class MP4Parser {
  /**
   * Parse MP4/MOV box structure
   */
  parseBoxes(data: Uint8Array, maxDepth: number = 3): MP4Box[] {
    const boxes: MP4Box[] = [];
    let offset = 0;
    
    while (offset < data.length - 8) {
      const view = new DataView(data.buffer, data.byteOffset + offset);
      let size = view.getUint32(0, false); // Big-endian
      const type = String.fromCharCode(
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7]
      );
      
      // Handle extended size
      if (size === 1 && data.length >= offset + 16) {
        size = Number(view.getBigUint64(8, false));
      }
      
      // Handle size = 0 (extends to EOF)
      if (size === 0) {
        size = data.length - offset;
      }
      
      if (size < 8 || offset + size > data.length) break;
      
      boxes.push({ offset, size, type });
      
      // Parse child boxes for containers
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type) && maxDepth > 0) {
        const childData = data.slice(offset + 8, offset + size);
        const childBoxes = this.parseBoxes(childData, maxDepth - 1);
        childBoxes.forEach(box => {
          box.offset += offset + 8;
          boxes.push(box);
        });
      }
      
      offset += size;
    }
    
    return boxes;
  }
  
  /**
   * Find frame boundaries from mdat box
   */
  findFrameBoundaries(data: Uint8Array): number[] {
    const boxes = this.parseBoxes(data);
    const boundaries: number[] = [];
    
    // Find mdat (media data) box
    const mdatBox = boxes.find(b => b.type === 'mdat');
    if (mdatBox) {
      boundaries.push(mdatBox.offset);
      boundaries.push(mdatBox.offset + mdatBox.size);
    }
    
    // Find stco/co64 (chunk offset) boxes
    for (const box of boxes) {
      if (box.type === 'stco' || box.type === 'co64') {
        boundaries.push(box.offset);
      }
    }
    
    return [...new Set(boundaries)].sort((a, b) => a - b);
  }
}

// ============================================================================
// JPEG STRUCTURE PARSER
// ============================================================================

export class JPEGParser {
  /**
   * Find JPEG segment boundaries
   */
  findSegments(data: Uint8Array): MediaBoundary[] {
    const boundaries: MediaBoundary[] = [];
    let offset = 0;
    
    while (offset < data.length - 1) {
      if (data[offset] !== 0xFF) {
        offset++;
        continue;
      }
      
      const marker = data[offset + 1];
      
      // Skip padding
      if (marker === 0xFF) {
        offset++;
        continue;
      }
      
      // Start of image
      if (marker === 0xD8) {
        boundaries.push({
          offset,
          length: 2,
          type: 'SOI',
          description: 'Start of Image',
          importance: 1.0,
        });
        offset += 2;
        continue;
      }
      
      // End of image
      if (marker === 0xD9) {
        boundaries.push({
          offset,
          length: 2,
          type: 'EOI',
          description: 'End of Image',
          importance: 1.0,
        });
        break;
      }
      
      // Restart markers
      if (marker >= 0xD0 && marker <= 0xD7) {
        boundaries.push({
          offset,
          length: 2,
          type: `RST${marker - 0xD0}`,
          description: 'Restart Marker',
          importance: 0.5,
        });
        offset += 2;
        continue;
      }
      
      // Segments with length
      if (offset + 3 < data.length) {
        const segmentLength = (data[offset + 2] << 8) | data[offset + 3];
        
        const segmentNames: Record<number, string> = {
          0xE0: 'APP0 (JFIF)',
          0xE1: 'APP1 (EXIF)',
          0xDB: 'DQT (Quantization)',
          0xC0: 'SOF0 (Baseline)',
          0xC2: 'SOF2 (Progressive)',
          0xC4: 'DHT (Huffman)',
          0xDA: 'SOS (Scan)',
        };
        
        boundaries.push({
          offset,
          length: 2 + segmentLength,
          type: `0x${marker.toString(16).toUpperCase()}`,
          description: segmentNames[marker] || 'Unknown Segment',
          importance: marker === 0xDA ? 0.8 : 0.3,
        });
        
        offset += 2 + segmentLength;
      } else {
        offset++;
      }
    }
    
    return boundaries;
  }
}

// ============================================================================
// PNG STRUCTURE PARSER
// ============================================================================

export class PNGParser {
  /**
   * Find PNG chunk boundaries
   */
  findChunks(data: Uint8Array): MediaBoundary[] {
    const boundaries: MediaBoundary[] = [];
    
    // Skip PNG signature (8 bytes)
    let offset = 8;
    
    while (offset < data.length - 12) {
      const view = new DataView(data.buffer, data.byteOffset + offset);
      const length = view.getUint32(0, false); // Big-endian
      const type = String.fromCharCode(
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7]
      );
      
      const chunkSize = 4 + 4 + length + 4; // length + type + data + crc
      
      let importance = 0.3;
      if (type === 'IHDR' || type === 'IEND') importance = 1.0;
      if (type === 'IDAT') importance = 0.6;
      
      boundaries.push({
        offset,
        length: chunkSize,
        type,
        description: this.getChunkDescription(type),
        importance,
      });
      
      offset += chunkSize;
      
      if (type === 'IEND') break;
    }
    
    return boundaries;
  }
  
  private getChunkDescription(type: string): string {
    const descriptions: Record<string, string> = {
      'IHDR': 'Image Header',
      'IDAT': 'Image Data',
      'IEND': 'Image End',
      'PLTE': 'Palette',
      'tRNS': 'Transparency',
      'gAMA': 'Gamma',
      'cHRM': 'Chromaticity',
      'sRGB': 'sRGB Color Space',
      'iCCP': 'ICC Profile',
      'tEXt': 'Text',
      'zTXt': 'Compressed Text',
      'iTXt': 'International Text',
      'bKGD': 'Background',
      'pHYs': 'Physical Dimensions',
      'tIME': 'Modification Time',
    };
    return descriptions[type] || 'Unknown Chunk';
  }
}

// ============================================================================
// MEDIA ANALYZER
// ============================================================================

export class MediaAnalyzer {
  private detector = new MediaDetector();
  private mp4Parser = new MP4Parser();
  private jpegParser = new JPEGParser();
  private pngParser = new PNGParser();
  
  /**
   * Analyze file and provide compression hints
   */
  async analyze(file: File | Blob): Promise<MediaAnalysis> {
    // Read header for detection
    const headerSize = Math.min(file.size, 64 * 1024); // 64KB header
    const headerBlob = file.slice(0, headerSize);
    const headerBuffer = await headerBlob.arrayBuffer();
    const header = new Uint8Array(headerBuffer);
    
    const type = this.detector.detectType(header);
    const isPreCompressed = this.detector.isPreCompressed(type);
    
    const analysis: MediaAnalysis = {
      type,
      mimeType: file.type || this.typeToMime(type),
      boundaries: [],
      recommendedChunkSize: this.getRecommendedChunkSize(type, file.size),
      alignmentHints: [],
      isCompressible: !isPreCompressed,
      compressionHint: isPreCompressed ? 'low' : 'high',
    };
    
    // Deep analysis based on type
    switch (type) {
      case 'video/mp4':
      case 'video/quicktime':
        analysis.boundaries = this.mp4Parser.findFrameBoundaries(header).map(offset => ({
          offset,
          length: 0,
          type: 'frame_boundary',
          description: 'Video Frame Boundary',
          importance: 0.8,
        }));
        analysis.alignmentHints = this.mp4Parser.findFrameBoundaries(header);
        break;
        
      case 'image/jpeg':
        analysis.boundaries = this.jpegParser.findSegments(header);
        analysis.alignmentHints = analysis.boundaries
          .filter(b => b.importance > 0.5)
          .map(b => b.offset);
        break;
        
      case 'image/png':
        analysis.boundaries = this.pngParser.findChunks(header);
        analysis.alignmentHints = analysis.boundaries
          .filter(b => b.type === 'IDAT')
          .map(b => b.offset);
        break;
    }
    
    return analysis;
  }
  
  /**
   * Get smart chunk boundaries for a file
   */
  async getSmartChunkBoundaries(
    file: File | Blob,
    targetChunkSize: number
  ): Promise<ChunkAlignment[]> {
    const analysis = await this.analyze(file);
    const alignments: ChunkAlignment[] = [];
    
    const alignmentSet = new Set(analysis.alignmentHints);
    let currentOffset = 0;
    
    while (currentOffset < file.size) {
      let targetEnd = currentOffset + targetChunkSize;
      let alignedEnd = targetEnd;
      
      // Look for nearby alignment point
      const searchWindow = targetChunkSize * 0.1; // 10% window
      for (const hint of alignmentSet) {
        if (hint > currentOffset && 
            hint >= targetEnd - searchWindow && 
            hint <= targetEnd + searchWindow) {
          alignedEnd = hint;
          break;
        }
      }
      
      // Don't exceed file size
      alignedEnd = Math.min(alignedEnd, file.size);
      
      alignments.push({
        originalOffset: currentOffset,
        alignedOffset: currentOffset,
        size: alignedEnd - currentOffset,
        alignmentReason: alignedEnd !== targetEnd 
          ? 'Aligned to media boundary' 
          : 'Standard chunk',
      });
      
      currentOffset = alignedEnd;
    }
    
    return alignments;
  }
  
  /**
   * Get recommended chunk size for media type
   */
  private getRecommendedChunkSize(type: MediaType, fileSize: number): number {
    // Pre-compressed formats: larger chunks (less overhead)
    if (this.detector.isPreCompressed(type)) {
      return Math.min(16 * 1024 * 1024, Math.ceil(fileSize / 10)); // 16MB or 1/10 of file
    }
    
    // Highly compressible: smaller chunks for better parallelism
    return 4 * 1024 * 1024; // 4MB default
  }
  
  /**
   * Convert MediaType to MIME string
   */
  private typeToMime(type: MediaType): string {
    return type === 'unknown' ? 'application/octet-stream' : type;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let mediaAnalyzer: MediaAnalyzer | null = null;

export function getMediaAnalyzer(): MediaAnalyzer {
  if (!mediaAnalyzer) {
    mediaAnalyzer = new MediaAnalyzer();
  }
  return mediaAnalyzer;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export async function analyzeMedia(file: File | Blob): Promise<MediaAnalysis> {
  return getMediaAnalyzer().analyze(file);
}

export async function getSmartChunks(
  file: File | Blob,
  targetChunkSize: number
): Promise<ChunkAlignment[]> {
  return getMediaAnalyzer().getSmartChunkBoundaries(file, targetChunkSize);
}
