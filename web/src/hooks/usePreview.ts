/**
 * Preview System Hook
 * React integration for archive scanning and selective extraction
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ArchiveScanner, SelectiveExtractor, PreviewGenerator } from '../engine/preview';
import type { 
  ArchiveManifest, 
  ManifestEntry, 
  ScanProgress, 
  ExtractionProgress,
  ThumbnailResult 
} from '../engine/preview/types';

interface UsePreviewOptions {
  maxThumbnailSize?: number;
  thumbnailQuality?: number;
  onScanProgress?: (progress: ScanProgress) => void;
  onExtractionProgress?: (progress: ExtractionProgress) => void;
}

interface UsePreviewReturn {
  scan: (file: File) => Promise<ArchiveManifest>;
  extract: (file: File, entries: ManifestEntry[]) => Promise<Map<string, Blob>>;
  extractSingle: (file: File, entry: ManifestEntry) => Promise<Blob>;
  generateThumbnail: (data: Uint8Array, mimeType: string) => Promise<ThumbnailResult>;
  manifest: ArchiveManifest | null;
  scanProgress: ScanProgress | null;
  extractionProgress: ExtractionProgress | null;
  isScanning: boolean;
  isExtracting: boolean;
  error: Error | null;
}

/**
 * Hook for archive preview and selective extraction
 */
export function usePreview(options: UsePreviewOptions = {}): UsePreviewReturn {
  const { maxThumbnailSize, thumbnailQuality, onScanProgress, onExtractionProgress } = options;

  const [manifest, setManifest] = useState<ArchiveManifest | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const scannerRef = useRef<ArchiveScanner | null>(null);
  const extractorRef = useRef<SelectiveExtractor | null>(null);
  const generatorRef = useRef<PreviewGenerator | null>(null);

  /**
   * Initialize components
   */
  useEffect(() => {
    scannerRef.current = new ArchiveScanner();
    extractorRef.current = new SelectiveExtractor();
    generatorRef.current = new PreviewGenerator({
      maxSize: maxThumbnailSize,
      quality: thumbnailQuality,
    });

    return () => {
      scannerRef.current = null;
      extractorRef.current = null;
      generatorRef.current = null;
    };
  }, [maxThumbnailSize, thumbnailQuality]);

  /**
   * Scan archive for manifest
   */
  const scan = useCallback(async (file: File): Promise<ArchiveManifest> => {
    if (!scannerRef.current) {
      throw new Error('Scanner not initialized');
    }

    setIsScanning(true);
    setError(null);
    setManifest(null);

    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const result = await scannerRef.current.scan(data, (progress) => {
        setScanProgress(progress);
        onScanProgress?.(progress);
      });

      setManifest(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsScanning(false);
    }
  }, [onScanProgress]);

  /**
   * Extract selected entries
   */
  const extract = useCallback(async (
    file: File, 
    entries: ManifestEntry[]
  ): Promise<Map<string, Blob>> => {
    if (!extractorRef.current) {
      throw new Error('Extractor not initialized');
    }

    setIsExtracting(true);
    setError(null);

    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const results = await extractorRef.current.extractMultiple(
        data,
        entries,
        (progress) => {
          setExtractionProgress(progress);
          onExtractionProgress?.(progress);
        }
      );

      // Convert to Blob map
      const blobMap = new Map<string, Blob>();
      for (const [path, rawData] of results) {
        const entry = entries.find(e => e.path === path);
        const blob = new Blob([rawData], { 
          type: entry?.metadata?.mimeType || 'application/octet-stream' 
        });
        blobMap.set(path, blob);
      }

      return blobMap;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsExtracting(false);
    }
  }, [onExtractionProgress]);

  /**
   * Extract single entry
   */
  const extractSingle = useCallback(async (
    file: File,
    entry: ManifestEntry
  ): Promise<Blob> => {
    if (!extractorRef.current) {
      throw new Error('Extractor not initialized');
    }

    setIsExtracting(true);
    setError(null);

    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const result = await extractorRef.current.extractEntry(data, entry);
      
      return new Blob([result], { 
        type: entry.metadata?.mimeType || 'application/octet-stream' 
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsExtracting(false);
    }
  }, []);

  /**
   * Generate thumbnail for extracted data
   */
  const generateThumbnail = useCallback(async (
    data: Uint8Array,
    mimeType: string
  ): Promise<ThumbnailResult> => {
    if (!generatorRef.current) {
      throw new Error('Generator not initialized');
    }

    return generatorRef.current.generateThumbnail(data, mimeType);
  }, []);

  return {
    scan,
    extract,
    extractSingle,
    generateThumbnail,
    manifest,
    scanProgress,
    extractionProgress,
    isScanning,
    isExtracting,
    error,
  };
}
