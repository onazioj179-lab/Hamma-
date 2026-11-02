/**
 * SPK V44 - UI Integration Hooks
 * React hooks that consume the unified API
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  JobId,
  FileId,
  ApiError,
  CompressionOptions,
  CompressionJob,
  CompressionProgress,
  CompressionResult,
  DecompressionJob,
  DecompressionProgress,
  DecompressionResult,
  ArchiveManifest,
  ManifestEntry,
  ManifestSummary,
  FileThumbnail,
  ShareToken,
  JobHistoryRecord,
  HistoryQueryOptions,
  TelemetryPacket,
  PlatformCapabilities,
} from './types';
import type { SpkApi } from './interface';
import { DEFAULT_COMPRESSION_OPTIONS } from './interface';

// ============================================================================
// API Context (to be provided by a context provider)
// ============================================================================

let apiInstance: SpkApi | null = null;

/**
 * Set the global API instance
 */
export function setApiInstance(api: SpkApi): void {
  apiInstance = api;
}

/**
 * Get the global API instance
 */
function getApi(): SpkApi {
  if (!apiInstance) {
    throw new Error('SPK API not initialized. Call setApiInstance first.');
  }
  return apiInstance;
}

// ============================================================================
// Compression Hook
// ============================================================================

export interface UseCompressionReturn {
  // State
  job: CompressionJob | null;
  progress: CompressionProgress | null;
  result: CompressionResult | null;
  error: ApiError | null;
  isCompressing: boolean;
  isPaused: boolean;
  
  // Actions
  startCompression: (files: File[], options?: Partial<CompressionOptions>) => Promise<void>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  reset: () => void;
  
  // Computed
  progressPercent: number;
  speedMbps: number;
  etaSeconds: number;
}

/**
 * Hook for compression operations
 */
export function useCompression(): UseCompressionReturn {
  const [job, setJob] = useState<CompressionJob | null>(null);
  const [progress, setProgress] = useState<CompressionProgress | null>(null);
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Subscribe to progress updates
  useEffect(() => {
    const api = getApi();
    
    unsubscribeRef.current = api.onProgress(({ jobId, progress: p }) => {
      if (job?.id === jobId && 'phase' in p && 'chunksProcessed' in p) {
        setProgress(p as CompressionProgress);
      }
    });

    return () => {
      unsubscribeRef.current?.();
    };
  }, [job?.id]);

  const startCompression = useCallback(async (
    files: File[],
    options?: Partial<CompressionOptions>
  ) => {
    const api = getApi();
    setIsCompressing(true);
    setError(null);
    setResult(null);
    
    try {
      // Start compression
      const startResult = await api.startCompression(files, {
        ...DEFAULT_COMPRESSION_OPTIONS,
        ...options,
      });
      
      if (!startResult.success || !startResult.data) {
        setError(startResult.error || { code: 'INTERNAL_ERROR', message: 'Failed to start compression', recoverable: false });
        setIsCompressing(false);
        return;
      }
      
      setJob(startResult.data);
      
      // Wait for completion
      const finishResult = await api.finishArchive(startResult.data.id);
      
      if (finishResult.success && finishResult.data) {
        setResult(finishResult.data);
      } else {
        setError(finishResult.error || { code: 'INTERNAL_ERROR', message: 'Compression failed', recoverable: false });
      }
    } catch (err) {
      setError({
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
        recoverable: false,
      });
    } finally {
      setIsCompressing(false);
    }
  }, []);

  const pause = useCallback(() => {
    if (job) {
      getApi().pauseCompression(job.id);
      setIsPaused(true);
    }
  }, [job]);

  const resume = useCallback(() => {
    if (job) {
      getApi().resumeCompression(job.id);
      setIsPaused(false);
    }
  }, [job]);

  const cancel = useCallback(() => {
    if (job) {
      getApi().cancelCompression(job.id);
      setIsCompressing(false);
      setIsPaused(false);
    }
  }, [job]);

  const reset = useCallback(() => {
    setJob(null);
    setProgress(null);
    setResult(null);
    setError(null);
    setIsCompressing(false);
    setIsPaused(false);
  }, []);

  // Computed values
  const progressPercent = progress
    ? progress.totalBytes > 0
      ? (progress.bytesWritten / progress.totalBytes) * 100
      : 0
    : 0;
  
  const speedMbps = progress
    ? progress.speed / (1024 * 1024)
    : 0;
  
  const etaSeconds = progress?.eta || 0;

  return {
    job,
    progress,
    result,
    error,
    isCompressing,
    isPaused,
    startCompression,
    pause,
    resume,
    cancel,
    reset,
    progressPercent,
    speedMbps,
    etaSeconds,
  };
}

// ============================================================================
// Decompression Hook
// ============================================================================

export interface UseDecompressionReturn {
  // State
  job: DecompressionJob | null;
  manifest: ArchiveManifest | null;
  contents: ManifestEntry[];
  progress: DecompressionProgress | null;
  result: DecompressionResult | null;
  error: ApiError | null;
  isExtracting: boolean;
  
  // Actions
  openArchive: (blob: Blob, password?: string) => Promise<void>;
  extractFile: (fileId: FileId) => Promise<Blob | null>;
  extractAll: () => Promise<void>;
  closeArchive: () => void;
  reset: () => void;
  
  // Computed
  progressPercent: number;
}

/**
 * Hook for decompression operations
 */
export function useDecompression(): UseDecompressionReturn {
  const [job, setJob] = useState<DecompressionJob | null>(null);
  const [manifest, setManifest] = useState<ArchiveManifest | null>(null);
  const [contents, setContents] = useState<ManifestEntry[]>([]);
  const [progress, setProgress] = useState<DecompressionProgress | null>(null);
  const [result, setResult] = useState<DecompressionResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const openArchive = useCallback(async (blob: Blob, password?: string) => {
    const api = getApi();
    setError(null);
    
    try {
      const openResult = await api.openArchive(blob, password);
      
      if (!openResult.success || !openResult.data) {
        setError(openResult.error || { code: 'INTERNAL_ERROR', message: 'Failed to open archive', recoverable: false });
        return;
      }
      
      setJob(openResult.data);
      
      // Get manifest
      const metadataResult = api.getMetadata(openResult.data.id);
      if (metadataResult.success && metadataResult.data) {
        setManifest(metadataResult.data);
      }
      
      // List contents
      const contentsResult = api.listContents(openResult.data.id);
      if (contentsResult.success && contentsResult.data) {
        setContents(contentsResult.data);
      }
    } catch (err) {
      setError({
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
        recoverable: false,
      });
    }
  }, []);

  const extractFile = useCallback(async (fileId: FileId): Promise<Blob | null> => {
    if (!job) return null;
    
    const api = getApi();
    setIsExtracting(true);
    
    try {
      const extractResult = await api.extractFile(job.id, fileId);
      
      if (extractResult.success && extractResult.data) {
        return extractResult.data;
      } else {
        setError(extractResult.error || { code: 'INTERNAL_ERROR', message: 'Extraction failed', recoverable: false });
        return null;
      }
    } finally {
      setIsExtracting(false);
    }
  }, [job]);

  const extractAll = useCallback(async () => {
    if (!job) return;
    
    const api = getApi();
    setIsExtracting(true);
    setError(null);
    
    try {
      const extractResult = await api.extractAll(job.id);
      
      if (extractResult.success && extractResult.data) {
        setResult(extractResult.data);
      } else {
        setError(extractResult.error || { code: 'INTERNAL_ERROR', message: 'Extraction failed', recoverable: false });
      }
    } finally {
      setIsExtracting(false);
    }
  }, [job]);

  const closeArchive = useCallback(() => {
    if (job) {
      getApi().closeArchive(job.id);
    }
    reset();
  }, [job]);

  const reset = useCallback(() => {
    setJob(null);
    setManifest(null);
    setContents([]);
    setProgress(null);
    setResult(null);
    setError(null);
    setIsExtracting(false);
  }, []);

  const progressPercent = progress
    ? progress.totalBytes > 0
      ? (progress.bytesWritten / progress.totalBytes) * 100
      : 0
    : 0;

  return {
    job,
    manifest,
    contents,
    progress,
    result,
    error,
    isExtracting,
    openArchive,
    extractFile,
    extractAll,
    closeArchive,
    reset,
    progressPercent,
  };
}

// ============================================================================
// Preview Hook
// ============================================================================

export interface UsePreviewReturn {
  summary: ManifestSummary | null;
  thumbnails: Map<FileId, FileThumbnail>;
  isLoading: boolean;
  error: ApiError | null;
  
  getSummary: (jobId: JobId) => void;
  getThumbnails: (jobId: JobId, fileIds?: FileId[]) => Promise<void>;
}

/**
 * Hook for archive preview
 */
export function usePreview(): UsePreviewReturn {
  const [summary, setSummary] = useState<ManifestSummary | null>(null);
  const [thumbnails, setThumbnails] = useState<Map<FileId, FileThumbnail>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const getSummary = useCallback((jobId: JobId) => {
    const api = getApi();
    const result = api.getManifestSummary(jobId);
    
    if (result.success && result.data) {
      setSummary(result.data);
    } else {
      setError(result.error || null);
    }
  }, []);

  const getThumbnails = useCallback(async (jobId: JobId, fileIds?: FileId[]) => {
    const api = getApi();
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await api.getThumbnails(jobId, fileIds);
      
      if (result.success && result.data) {
        const newThumbnails = new Map(thumbnails);
        for (const thumb of result.data) {
          newThumbnails.set(thumb.fileId, thumb);
        }
        setThumbnails(newThumbnails);
      } else {
        setError(result.error || null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [thumbnails]);

  return {
    summary,
    thumbnails,
    isLoading,
    error,
    getSummary,
    getThumbnails,
  };
}

// ============================================================================
// Sharing Hook
// ============================================================================

export interface UseSharingReturn {
  token: ShareToken | null;
  isCreating: boolean;
  isVerifying: boolean;
  error: ApiError | null;
  
  createToken: (jobId: JobId, options?: { expiresInHours?: number; maxDownloads?: number; password?: string }) => Promise<void>;
  verifyToken: (tokenString: string) => Promise<boolean>;
  exportForSharing: (jobId: JobId) => Promise<Blob | null>;
  reset: () => void;
}

/**
 * Hook for sharing operations
 */
export function useSharing(): UseSharingReturn {
  const [token, setToken] = useState<ShareToken | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const createToken = useCallback(async (
    jobId: JobId,
    options?: { expiresInHours?: number; maxDownloads?: number; password?: string }
  ) => {
    const api = getApi();
    setIsCreating(true);
    setError(null);
    
    try {
      const result = await api.createShareToken(jobId, options);
      
      if (result.success && result.data) {
        setToken(result.data);
      } else {
        setError(result.error || null);
      }
    } finally {
      setIsCreating(false);
    }
  }, []);

  const verifyToken = useCallback(async (tokenString: string): Promise<boolean> => {
    const api = getApi();
    setIsVerifying(true);
    
    try {
      const result = await api.verifyShareToken(tokenString);
      return result.success && result.data?.valid === true;
    } finally {
      setIsVerifying(false);
    }
  }, []);

  const exportForSharing = useCallback(async (jobId: JobId): Promise<Blob | null> => {
    const api = getApi();
    
    try {
      const result = await api.exportForSharing(jobId, true);
      return result.success && result.data ? result.data.blob : null;
    } catch {
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    setError(null);
  }, []);

  return {
    token,
    isCreating,
    isVerifying,
    error,
    createToken,
    verifyToken,
    exportForSharing,
    reset,
  };
}

// ============================================================================
// History Hook
// ============================================================================

export interface UseHistoryReturn {
  records: JobHistoryRecord[];
  isLoading: boolean;
  error: ApiError | null;
  
  loadHistory: (options?: HistoryQueryOptions) => Promise<void>;
  deleteEntry: (historyId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook for history management
 */
export function useHistory(): UseHistoryReturn {
  const [records, setRecords] = useState<JobHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const optionsRef = useRef<HistoryQueryOptions>();

  const loadHistory = useCallback(async (options?: HistoryQueryOptions) => {
    const api = getApi();
    setIsLoading(true);
    setError(null);
    optionsRef.current = options;
    
    try {
      const result = await api.listJobHistory(options);
      
      if (result.success && result.data) {
        setRecords(result.data);
      } else {
        setError(result.error || null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteEntry = useCallback(async (historyId: string) => {
    const api = getApi();
    
    const result = await api.deleteHistoryEntry(historyId);
    
    if (result.success) {
      setRecords((prev) => prev.filter((r) => r.id !== historyId));
    } else {
      setError(result.error || null);
    }
  }, []);

  const clearHistory = useCallback(async () => {
    const api = getApi();
    
    const result = await api.clearHistory();
    
    if (result.success) {
      setRecords([]);
    } else {
      setError(result.error || null);
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadHistory(optionsRef.current);
  }, [loadHistory]);

  // Subscribe to history updates
  useEffect(() => {
    const api = getApi();
    
    const unsubscribe = api.onHistoryUpdated((newRecords) => {
      setRecords(newRecords);
    });

    return unsubscribe;
  }, []);

  return {
    records,
    isLoading,
    error,
    loadHistory,
    deleteEntry,
    clearHistory,
    refresh,
  };
}

// ============================================================================
// Telemetry Hook
// ============================================================================

export interface UseTelemetryReturn {
  currentSpeed: number;
  averageSpeed: number;
  peakSpeed: number;
  memoryUsed: number;
  throughputPercent: number;
  packets: TelemetryPacket[];
}

/**
 * Hook for telemetry monitoring
 */
export function useTelemetry(maxPackets = 100): UseTelemetryReturn {
  const [packets, setPackets] = useState<TelemetryPacket[]>([]);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [averageSpeed, setAverageSpeed] = useState(0);
  const [peakSpeed, setPeakSpeed] = useState(0);
  const [memoryUsed, setMemoryUsed] = useState(0);
  const [throughputPercent, setThroughputPercent] = useState(0);

  useEffect(() => {
    const api = getApi();
    
    const unsubscribe = api.onTelemetry((packet) => {
      setPackets((prev) => {
        const next = [...prev, packet];
        return next.slice(-maxPackets);
      });
      
      if (packet.type === 'speed' && 'payload' in packet) {
        const payload = packet.payload as { type: 'speed'; currentSpeed: number; averageSpeed: number; peakSpeed: number; throughputPercent: number };
        if (payload.type === 'speed') {
          setCurrentSpeed(payload.currentSpeed);
          setAverageSpeed(payload.averageSpeed);
          setPeakSpeed(payload.peakSpeed);
          setThroughputPercent(payload.throughputPercent);
        }
      }
      
      if (packet.type === 'memory' && 'payload' in packet) {
        const payload = packet.payload as { type: 'memory'; heapUsed: number };
        if (payload.type === 'memory') {
          setMemoryUsed(payload.heapUsed);
        }
      }
    });

    return unsubscribe;
  }, [maxPackets]);

  return {
    currentSpeed,
    averageSpeed,
    peakSpeed,
    memoryUsed,
    throughputPercent,
    packets,
  };
}

// ============================================================================
// Platform Hook
// ============================================================================

export interface UsePlatformReturn {
  capabilities: PlatformCapabilities | null;
  isReady: boolean;
  error: ApiError | null;
  
  initialize: () => Promise<void>;
  shutdown: () => Promise<void>;
}

/**
 * Hook for platform capabilities
 */
export function usePlatform(): UsePlatformReturn {
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const initialize = useCallback(async () => {
    const api = getApi();
    
    try {
      const result = await api.initialize();
      
      if (result.success && result.data) {
        setCapabilities(result.data);
        setIsReady(true);
      } else {
        setError(result.error || null);
      }
    } catch (err) {
      setError({
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Initialization failed',
        recoverable: false,
      });
    }
  }, []);

  const shutdown = useCallback(async () => {
    const api = getApi();
    await api.shutdown();
    setIsReady(false);
  }, []);

  return {
    capabilities,
    isReady,
    error,
    initialize,
    shutdown,
  };
}

// ============================================================================
// Recovery Hook
// ============================================================================

export interface UseRecoveryReturn {
  isRecovering: boolean;
  lastError: ApiError | null;
  
  recoverCompression: (jobId: JobId) => Promise<boolean>;
  recoverDecompression: (jobId: JobId) => Promise<boolean>;
  retryChunk: (jobId: JobId, chunkId: string) => Promise<boolean>;
  enableSafeMode: () => Promise<void>;
}

/**
 * Hook for error recovery
 */
export function useRecovery(): UseRecoveryReturn {
  const [isRecovering, setIsRecovering] = useState(false);
  const [lastError, setLastError] = useState<ApiError | null>(null);

  const recoverCompression = useCallback(async (jobId: JobId): Promise<boolean> => {
    const api = getApi();
    setIsRecovering(true);
    
    try {
      const result = await api.recoverCompressionJob(jobId);
      
      if (!result.success) {
        setLastError(result.error || null);
      }
      
      return result.success;
    } finally {
      setIsRecovering(false);
    }
  }, []);

  const recoverDecompression = useCallback(async (jobId: JobId): Promise<boolean> => {
    const api = getApi();
    setIsRecovering(true);
    
    try {
      const result = await api.recoverDecompressionJob(jobId);
      
      if (!result.success) {
        setLastError(result.error || null);
      }
      
      return result.success;
    } finally {
      setIsRecovering(false);
    }
  }, []);

  const retryChunk = useCallback(async (jobId: JobId, chunkId: string): Promise<boolean> => {
    const api = getApi();
    
    const result = await api.retryChunk(jobId, chunkId);
    
    if (!result.success) {
      setLastError(result.error || null);
    }
    
    return result.success;
  }, []);

  const enableSafeMode = useCallback(async () => {
    const api = getApi();
    await api.fallbackToSafeMode();
  }, []);

  return {
    isRecovering,
    lastError,
    recoverCompression,
    recoverDecompression,
    retryChunk,
    enableSafeMode,
  };
}
