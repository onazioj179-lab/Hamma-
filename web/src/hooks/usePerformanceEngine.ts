/**
 * Performance Engine Hook
 * React integration for high-throughput compression
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { PerformanceEngine } from '../engine/performance';
import type { PerformanceConfig, DetailedProgress, CompressionJob } from '../engine/performance/types';

interface UsePerformanceEngineOptions {
  config?: Partial<PerformanceConfig>;
  onProgress?: (progress: DetailedProgress) => void;
  onComplete?: (result: { output: Blob; stats: CompressionJob['stats'] }) => void;
  onError?: (error: Error) => void;
}

interface UsePerformanceEngineReturn {
  compress: (files: File[]) => Promise<void>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  progress: DetailedProgress | null;
  isCompressing: boolean;
  isPaused: boolean;
  error: Error | null;
  stats: {
    throughput: number;
    peakMemory: number;
    laneUtilization: number;
  } | null;
}

/**
 * Hook for high-performance compression with lane-level progress
 */
export function usePerformanceEngine(
  options: UsePerformanceEngineOptions = {}
): UsePerformanceEngineReturn {
  const { config, onProgress, onComplete, onError } = options;

  const [progress, setProgress] = useState<DetailedProgress | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [stats, setStats] = useState<UsePerformanceEngineReturn['stats']>(null);

  const engineRef = useRef<PerformanceEngine | null>(null);
  const jobIdRef = useRef<string | null>(null);

  /**
   * Initialize engine on mount
   */
  useEffect(() => {
    engineRef.current = new PerformanceEngine(config);

    return () => {
      engineRef.current?.shutdown();
      engineRef.current = null;
    };
  }, [config]);

  /**
   * Start compression
   */
  const compress = useCallback(async (files: File[]) => {
    if (!engineRef.current) {
      throw new Error('Performance engine not initialized');
    }

    setIsCompressing(true);
    setIsPaused(false);
    setError(null);
    setProgress(null);

    try {
      const result = await engineRef.current.compress(files, (detailedProgress) => {
        setProgress(detailedProgress);
        onProgress?.(detailedProgress);

        // Extract job ID for pause/resume
        if (detailedProgress.lanes.length > 0) {
          const laneId = detailedProgress.lanes[0].id.toString();
          jobIdRef.current = laneId.split('-')[0] || null;
        }
      });

      setStats({
        throughput: result.stats?.averageThroughput || 0,
        peakMemory: result.stats?.peakMemory || 0,
        laneUtilization: result.stats?.laneUtilization || 0,
      });

      onComplete?.(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
    } finally {
      setIsCompressing(false);
      jobIdRef.current = null;
    }
  }, [onProgress, onComplete, onError]);

  /**
   * Pause compression
   */
  const pause = useCallback(() => {
    if (engineRef.current && jobIdRef.current) {
      engineRef.current.pause(jobIdRef.current);
      setIsPaused(true);
    }
  }, []);

  /**
   * Resume compression
   */
  const resume = useCallback(() => {
    if (engineRef.current && jobIdRef.current) {
      engineRef.current.resume(jobIdRef.current);
      setIsPaused(false);
    }
  }, []);

  /**
   * Cancel compression
   */
  const cancel = useCallback(() => {
    if (engineRef.current && jobIdRef.current) {
      engineRef.current.cancel(jobIdRef.current);
      setIsCompressing(false);
      setIsPaused(false);
      jobIdRef.current = null;
    }
  }, []);

  return {
    compress,
    pause,
    resume,
    cancel,
    progress,
    isCompressing,
    isPaused,
    error,
    stats,
  };
}
