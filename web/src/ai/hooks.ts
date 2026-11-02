/**
 * SPK V46 - React Hook for AI Optimization
 * Frontend integration for AI-driven optimization
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAIIntegration, AICoordinatorIntegration } from './integration';
import type { AIOptimizationOutput } from './types';

/**
 * AI optimization status for UI display
 */
export interface AIOptimizationStatus {
  /** Whether AI is enabled */
  enabled: boolean;
  /** Whether AI is currently active */
  active: boolean;
  /** Current status message for display */
  statusMessage: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Estimated performance gain */
  estimatedGain: number;
  /** Can toggle AI on/off */
  canToggle: boolean;
}

/**
 * AI training statistics
 */
export interface AITrainingStats {
  /** Number of jobs analyzed */
  jobsAnalyzed: number;
  /** Average speed achieved */
  avgSpeedMBps: number;
  /** Success rate percentage */
  successRate: number;
}

/**
 * Hook return type
 */
export interface UseAIOptimizationReturn {
  /** Current AI status */
  status: AIOptimizationStatus;
  /** Training statistics */
  trainingStats: AITrainingStats | null;
  /** Toggle AI on/off */
  toggleAI: () => void;
  /** Reset optimization data */
  resetData: () => void;
  /** Get optimized config for files */
  getOptimizedConfig: (files: File[]) => AIOptimizationOutput;
  /** Start job monitoring */
  startJob: () => void;
  /** Report job progress */
  reportProgress: (metrics: ProgressMetrics) => void;
  /** Complete job */
  completeJob: (outcome: JobOutcome) => void;
}

/**
 * Progress metrics for AI
 */
export interface ProgressMetrics {
  chunkTimeMs?: number;
  workerLoadPercent?: number;
  wasmStall?: boolean;
  memoryUsage?: number;
  memoryLimit?: number;
  throughputBps?: number;
}

/**
 * Job outcome for AI learning
 */
export interface JobOutcome {
  success: boolean;
  totalBytes: number;
  durationMs: number;
  compressionRatio: number;
  peakMemory: number;
  errorCount: number;
  stallCount: number;
}

/**
 * React hook for AI optimization
 */
export function useAIOptimization(): UseAIOptimizationReturn {
  const integrationRef = useRef<AICoordinatorIntegration | null>(null);
  
  const [status, setStatus] = useState<AIOptimizationStatus>({
    enabled: true,
    active: false,
    statusMessage: 'Initializing...',
    confidence: 0,
    estimatedGain: 0,
    canToggle: false,
  });

  const [trainingStats, setTrainingStats] = useState<AITrainingStats | null>(null);

  // Initialize AI integration
  useEffect(() => {
    const init = async () => {
      try {
        const integration = getAIIntegration();
        await integration.initialize();
        integrationRef.current = integration;
        
        // Update initial status
        const aiStatus = integration.getStatus();
        setStatus({
          enabled: aiStatus.enabled,
          active: aiStatus.optimizing,
          statusMessage: getStatusMessage(aiStatus.status),
          confidence: aiStatus.confidence,
          estimatedGain: aiStatus.estimatedGainPercent,
          canToggle: true,
        });

        // Get training stats
        const stats = integration.getTrainingStats();
        setTrainingStats(stats);
      } catch (error) {
        console.warn('[AI Hook] Initialization failed:', error);
        setStatus(prev => ({
          ...prev,
          enabled: false,
          statusMessage: 'AI optimization unavailable',
          canToggle: false,
        }));
      }
    };

    init();
  }, []);

  // Convert status to user-friendly message
  const getStatusMessage = (status: string): string => {
    switch (status) {
      case 'idle':
        return 'Ready';
      case 'analyzing':
        return 'Optimizing for your device...';
      case 'optimizing':
        return 'Adaptive mode active';
      case 'monitoring':
        return 'Adaptive mode active';
      case 'disabled':
        return 'AI optimization disabled';
      case 'error':
        return 'Using default settings';
      default:
        return 'Ready';
    }
  };

  // Toggle AI on/off
  const toggleAI = useCallback(() => {
    if (!integrationRef.current) return;
    
    const newEnabled = !status.enabled;
    integrationRef.current.setEnabled(newEnabled);
    
    setStatus(prev => ({
      ...prev,
      enabled: newEnabled,
      statusMessage: newEnabled ? 'Ready' : 'AI optimization disabled',
    }));
  }, [status.enabled]);

  // Reset optimization data
  const resetData = useCallback(() => {
    if (!integrationRef.current) return;
    
    integrationRef.current.resetData();
    setTrainingStats(null);
    setStatus(prev => ({
      ...prev,
      estimatedGain: 0,
    }));
  }, []);

  // Get optimized config for files
  const getOptimizedConfig = useCallback((files: File[]): AIOptimizationOutput => {
    if (!integrationRef.current || !status.enabled) {
      // Return default config
      return {
        chunkSize: 4 * 1024 * 1024,
        concurrentLanes: 4,
        workerCount: 4,
        wasmBatchSize: 8,
        ioBufferStrategy: 'balanced',
        compressionMode: 'auto',
        predictedTimeMs: 0,
        confidence: 0,
      };
    }

    const fileInfo = files.map(f => ({
      type: f.type || 'application/octet-stream',
      size: f.size,
    }));

    const config = integrationRef.current.getOptimizedConfig(fileInfo);
    
    // Update status
    setStatus(prev => ({
      ...prev,
      active: true,
      statusMessage: 'Optimizing for your device...',
      confidence: config.confidence,
    }));

    return config;
  }, [status.enabled]);

  // Start job monitoring
  const startJob = useCallback(() => {
    if (!integrationRef.current) return;
    
    integrationRef.current.startJob();
    setStatus(prev => ({
      ...prev,
      active: true,
      statusMessage: 'Adaptive mode active',
    }));
  }, []);

  // Report progress
  const reportProgress = useCallback((metrics: ProgressMetrics) => {
    if (!integrationRef.current) return;
    integrationRef.current.reportProgress(metrics);
  }, []);

  // Complete job
  const completeJob = useCallback((outcome: JobOutcome) => {
    if (!integrationRef.current) return;
    
    integrationRef.current.completeJob(outcome);
    
    // Update status
    const aiStatus = integrationRef.current.getStatus();
    setStatus(prev => ({
      ...prev,
      active: false,
      statusMessage: getStatusMessage(aiStatus.status),
      estimatedGain: aiStatus.estimatedGainPercent,
    }));

    // Refresh training stats
    const stats = integrationRef.current.getTrainingStats();
    setTrainingStats(stats);
  }, []);

  return {
    status,
    trainingStats,
    toggleAI,
    resetData,
    getOptimizedConfig,
    startJob,
    reportProgress,
    completeJob,
  };
}

/**
 * Get status message for UI display
 */
export function getAIStatusMessage(status: AIOptimizationStatus): string {
  if (!status.enabled) {
    return '';
  }
  return status.active ? status.statusMessage : 'Ready';
}
