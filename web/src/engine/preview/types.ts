/**
 * Preview System Types
 * Real-time preview and selective extraction
 */

// Archive manifest for preview
export interface ArchiveManifest {
  version: number;
  createdAt: number;
  originalSize: number;
  compressedSize: number;
  fileCount: number;
  folderCount: number;
  compressionMode: string;
  encrypted: boolean;
  files: ArchiveFileEntry[];
  folders: ArchiveFolderEntry[];
  chunkTable: ChunkTableEntry[];
}

// File entry in archive
export interface ArchiveFileEntry {
  id: string;
  name: string;
  path: string;
  size: number;
  compressedSize: number;
  mimeType: string;
  extension: string;
  modifiedAt: number;
  chunks: string[]; // Chunk IDs containing this file
  startOffset: number; // Offset within first chunk
  endOffset: number; // End offset within last chunk
  hash: string;
  previewable: boolean;
  thumbnailChunk?: string; // Chunk containing thumbnail
  thumbnailOffset?: number;
  thumbnailSize?: number;
}

// Folder entry
export interface ArchiveFolderEntry {
  id: string;
  name: string;
  path: string;
  fileCount: number;
  totalSize: number;
  parentId?: string;
}

// Chunk table entry for seeking
export interface ChunkTableEntry {
  id: string;
  offset: number; // Offset in archive
  compressedSize: number;
  originalSize: number;
  hash: string;
}

// Preview types
export type PreviewType = 
  | 'image' 
  | 'video' 
  | 'audio' 
  | 'text' 
  | 'document' 
  | '3d' 
  | 'code' 
  | 'archive' 
  | 'unknown';

// Preview data
export interface PreviewData {
  type: PreviewType;
  mimeType: string;
  available: boolean;
  thumbnail?: Uint8Array;
  thumbnailUrl?: string;
  metadata?: PreviewMetadata;
  textPreview?: string;
  frameCount?: number;
  duration?: number;
}

// Preview metadata by type
export interface PreviewMetadata {
  // Image
  width?: number;
  height?: number;
  colorDepth?: number;
  hasAlpha?: boolean;
  
  // Video/Audio
  duration?: number;
  frameRate?: number;
  bitrate?: number;
  codec?: string;
  
  // Text/Code
  encoding?: string;
  lineCount?: number;
  language?: string;
  
  // 3D
  vertexCount?: number;
  faceCount?: number;
  materials?: string[];
  
  // Document
  pageCount?: number;
  title?: string;
  author?: string;
}

// Extraction options
export interface ExtractionOptions {
  fileIds?: string[]; // Specific files to extract
  folderIds?: string[]; // Specific folders to extract
  outputPath?: string;
  preserveStructure: boolean;
  overwrite: boolean;
  onProgress?: (progress: ExtractionProgress) => void;
}

// Extraction progress
export interface ExtractionProgress {
  currentFile: string;
  currentFileIndex: number;
  totalFiles: number;
  bytesExtracted: number;
  totalBytes: number;
  chunksProcessed: number;
  totalChunks: number;
  speed: number;
  eta: number;
}

// Extraction result
export interface ExtractionResult {
  success: boolean;
  filesExtracted: number;
  bytesExtracted: number;
  duration: number;
  errors: ExtractionError[];
  outputFiles: ExtractedFile[];
}

export interface ExtractionError {
  fileId: string;
  fileName: string;
  error: string;
}

export interface ExtractedFile {
  id: string;
  name: string;
  path: string;
  size: number;
  blob?: Blob;
}

// Scan options
export interface ScanOptions {
  generateThumbnails: boolean;
  maxThumbnailSize: number;
  previewTextLines: number;
  detectMediaMetadata: boolean;
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  generateThumbnails: true,
  maxThumbnailSize: 256,
  previewTextLines: 50,
  detectMediaMetadata: true,
};

// Preview callbacks
export interface PreviewCallbacks {
  onManifestReady: (manifest: ArchiveManifest) => void;
  onPreviewReady: (fileId: string, preview: PreviewData) => void;
  onError: (error: Error) => void;
}

// MIME type to preview type mapping
export const MIME_TO_PREVIEW: Record<string, PreviewType> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'image/bmp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/webm': 'audio',
  'text/plain': 'text',
  'text/html': 'code',
  'text/css': 'code',
  'text/javascript': 'code',
  'application/json': 'code',
  'application/xml': 'code',
  'application/pdf': 'document',
  'application/msword': 'document',
  'model/gltf-binary': '3d',
  'model/gltf+json': '3d',
  'model/obj': '3d',
  'application/zip': 'archive',
  'application/x-rar': 'archive',
  'application/x-7z-compressed': 'archive',
};

// File extension to MIME type
export const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/msword',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'model/obj',
  '.zip': 'application/zip',
  '.rar': 'application/x-rar',
  '.7z': 'application/x-7z-compressed',
};
