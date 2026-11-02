/**
 * SPK WASM bindings interface
 */

export interface CompressOptions {
  codec: 'zstd' | 'lz4' | 'brotli' | 'none';
  level: number;
  chunkSize: number;
  dedup: boolean;
  password?: string;
}

export interface DecompressOptions {
  password?: string;
  files?: string[];
  verify: boolean;
}

export interface ArchiveInfo {
  fileCount: number;
  totalSize: number;
  compressedSize: number;
  files: FileInfo[];
}

export interface FileInfo {
  path: string;
  size: number;
  mode: number;
}

export interface CompressResult {
  data: Uint8Array;
  originalSize: number;
  compressedSize: number;
  fileCount: number;
}

export interface ExtractedFile {
  path: string;
  data: Uint8Array;
}

// WASM module interface
interface SpkWasmModule {
  version(): string;
  supported_features(): string[];
  SpkCompressor: SpkCompressorClass;
  SpkDecompressor: SpkDecompressorClass;
  StreamProcessor: StreamProcessorClass;
  utils: {
    sha256(data: Uint8Array): string;
    crc32(data: Uint8Array): number;
    formatSize(bytes: bigint): string;
  };
}

interface SpkCompressorClass {
  new(): SpkCompressorInstance;
  withOptions(options: any): SpkCompressorInstance;
}

interface SpkCompressorInstance {
  setCodec(codec: string): void;
  setLevel(level: number): void;
  setDedup(enabled: boolean): void;
  setPassword(password: string): void;
  addFile(name: string, data: Uint8Array): void;
  fileCount(): number;
  compress(): Uint8Array;
  compressWithProgress(callback: (progress: number, filename: string) => void): Uint8Array;
  clear(): void;
}

interface SpkDecompressorClass {
  new(): SpkDecompressorInstance;
  withOptions(options: any): SpkDecompressorInstance;
}

interface SpkDecompressorInstance {
  setPassword(password: string): void;
  getInfo(data: Uint8Array): ArchiveInfo;
  listFiles(data: Uint8Array): string[];
  decompress(data: Uint8Array): Array<{ path: string; data: Uint8Array }>;
  extractFile(data: Uint8Array, path: string): Uint8Array;
  decompressWithProgress(
    data: Uint8Array,
    callback: (progress: number, filename: string) => void
  ): Array<{ path: string; data: Uint8Array }>;
  previewFile(data: Uint8Array, path: string, maxBytes: number): Uint8Array;
}

interface StreamProcessorClass {
  new(chunkSize: number): StreamProcessorInstance;
}

interface StreamProcessorInstance {
  compressChunk(data: Uint8Array, codec: string, level: number): Uint8Array;
  decompressChunk(data: Uint8Array, codec: string): Uint8Array;
}

// Module singleton
let wasmModule: SpkWasmModule | null = null;

/**
 * Initialize the WASM module
 */
export async function initSpkWasm(): Promise<void> {
  if (wasmModule) return;
  
  try {
    // Dynamic import of WASM module
    const module = await import('../../wasm/pkg/spk_wasm');
    wasmModule = module as unknown as SpkWasmModule;
  } catch (error) {
    console.error('Failed to load SPK WASM module:', error);
    throw new Error('WASM module not available. Using API fallback.');
  }
}

/**
 * Get WASM module version
 */
export function getVersion(): string {
  if (!wasmModule) throw new Error('WASM module not initialized');
  return wasmModule.version();
}

/**
 * Get supported features
 */
export function getSupportedFeatures(): string[] {
  if (!wasmModule) throw new Error('WASM module not initialized');
  return wasmModule.supported_features();
}

/**
 * Compress files using WASM
 */
export async function compressFiles(
  files: Array<{ name: string; data: Uint8Array }>,
  options: CompressOptions,
  onProgress?: (progress: number, filename: string) => void
): Promise<CompressResult> {
  if (!wasmModule) {
    throw new Error('WASM module not initialized');
  }

  const compressor = wasmModule.SpkCompressor.withOptions({
    codec: options.codec,
    level: options.level,
    chunk_size: options.chunkSize,
    dedup: options.dedup,
    password: options.password,
  });

  let originalSize = 0;
  for (const file of files) {
    compressor.addFile(file.name, file.data);
    originalSize += file.data.length;
  }

  const data = onProgress
    ? compressor.compressWithProgress(onProgress)
    : compressor.compress();

  return {
    data,
    originalSize,
    compressedSize: data.length,
    fileCount: files.length,
  };
}

/**
 * Decompress archive using WASM
 */
export async function decompressArchive(
  data: Uint8Array,
  options: DecompressOptions,
  onProgress?: (progress: number, filename: string) => void
): Promise<ExtractedFile[]> {
  if (!wasmModule) {
    throw new Error('WASM module not initialized');
  }

  const decompressor = wasmModule.SpkDecompressor.withOptions({
    password: options.password,
    files: options.files,
    verify: options.verify,
  });

  if (options.password) {
    decompressor.setPassword(options.password);
  }

  const result = onProgress
    ? decompressor.decompressWithProgress(data, onProgress)
    : decompressor.decompress(data);

  return result.map(file => ({
    path: file.path,
    data: file.data,
  }));
}

/**
 * Get archive info using WASM
 */
export async function getArchiveInfo(data: Uint8Array): Promise<ArchiveInfo> {
  if (!wasmModule) {
    throw new Error('WASM module not initialized');
  }

  const decompressor = new wasmModule.SpkDecompressor();
  return decompressor.getInfo(data);
}

/**
 * Extract single file using WASM
 */
export async function extractFile(
  archiveData: Uint8Array,
  path: string,
  password?: string
): Promise<Uint8Array> {
  if (!wasmModule) {
    throw new Error('WASM module not initialized');
  }

  const decompressor = new wasmModule.SpkDecompressor();
  if (password) {
    decompressor.setPassword(password);
  }
  
  return decompressor.extractFile(archiveData, path);
}

/**
 * Preview file content using WASM
 */
export async function previewFile(
  archiveData: Uint8Array,
  path: string,
  maxBytes: number = 4096
): Promise<Uint8Array> {
  if (!wasmModule) {
    throw new Error('WASM module not initialized');
  }

  const decompressor = new wasmModule.SpkDecompressor();
  return decompressor.previewFile(archiveData, path, maxBytes);
}

/**
 * Calculate SHA-256 hash
 */
export function sha256(data: Uint8Array): string {
  if (!wasmModule) {
    throw new Error('WASM module not initialized');
  }
  return wasmModule.utils.sha256(data);
}

/**
 * Calculate CRC32 checksum
 */
export function crc32(data: Uint8Array): number {
  if (!wasmModule) {
    throw new Error('WASM module not initialized');
  }
  return wasmModule.utils.crc32(data);
}
