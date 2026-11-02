/**
 * Compression Progress Component
 * Real-time progress with speed, ETA, and chunk visualization
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Zap, Clock, Layers, TrendingDown } from 'lucide-react';
import { formatBytes, formatSpeed, formatDuration } from '../../engine/streaming/reader';
import type { ProgressState } from '../../store/app';

interface CompressionProgressProps {
  progress: ProgressState;
  onCancel?: () => void;
  fileName?: string;
}

export function CompressionProgress({ 
  progress, 
  onCancel,
  fileName = 'file',
}: CompressionProgressProps) {
  const {
    bytesProcessed,
    totalBytes,
    chunksProcessed,
    totalChunks,
    speed,
    eta,
    compressionRatio,
  } = progress;

  // Calculate percentage
  const percent = useMemo(() => {
    if (totalBytes === 0) return 0;
    return Math.min(100, (bytesProcessed / totalBytes) * 100);
  }, [bytesProcessed, totalBytes]);

  // Circular progress
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  // Format compression ratio as savings
  const savings = useMemo(() => {
    if (compressionRatio >= 1) return '0%';
    return `${((1 - compressionRatio) * 100).toFixed(1)}%`;
  }, [compressionRatio]);

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Progress ring */}
      <div className="relative w-48 h-48 mx-auto mb-8">
        {/* Background circle */}
        <svg className="w-full h-full -rotate-90">
          <circle
            cx="96"
            cy="96"
            r="45"
            className="fill-none stroke-gray-200 dark:stroke-gray-800"
            strokeWidth="8"
          />
          {/* Progress circle */}
          <motion.circle
            cx="96"
            cy="96"
            r="45"
            className="fill-none stroke-primary-500"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-foreground">
            {percent.toFixed(0)}%
          </span>
          <span className="text-sm text-muted mt-1">
            {formatBytes(bytesProcessed)} / {formatBytes(totalBytes)}
          </span>
        </div>
      </div>

      {/* File name */}
      <div className="text-center mb-6">
        <p className="text-lg font-medium text-foreground truncate px-4">
          {fileName}
        </p>
        <p className="text-sm text-muted mt-1">
          Compressing...
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Speed */}
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
          <div className="flex items-center gap-2 text-muted mb-1">
            <Zap className="w-4 h-4" />
            <span className="text-xs font-medium uppercase">Speed</span>
          </div>
          <p className="text-lg font-semibold text-foreground">
            {formatSpeed(speed)}
          </p>
        </div>

        {/* ETA */}
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
          <div className="flex items-center gap-2 text-muted mb-1">
            <Clock className="w-4 h-4" />
            <span className="text-xs font-medium uppercase">ETA</span>
          </div>
          <p className="text-lg font-semibold text-foreground">
            {eta > 0 ? formatDuration(eta) : '—'}
          </p>
        </div>

        {/* Chunks */}
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
          <div className="flex items-center gap-2 text-muted mb-1">
            <Layers className="w-4 h-4" />
            <span className="text-xs font-medium uppercase">Chunks</span>
          </div>
          <p className="text-lg font-semibold text-foreground">
            {chunksProcessed} / {totalChunks || '?'}
          </p>
        </div>

        {/* Savings */}
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
          <div className="flex items-center gap-2 text-muted mb-1">
            <TrendingDown className="w-4 h-4" />
            <span className="text-xs font-medium uppercase">Savings</span>
          </div>
          <p className="text-lg font-semibold text-emerald-500">
            {savings}
          </p>
        </div>
      </div>

      {/* Chunk progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-muted mb-2">
          <span>Chunk progress</span>
          <span>{chunksProcessed} of {totalChunks || '?'} chunks</span>
        </div>
        <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-primary-500 to-accent-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Cancel button */}
      {onCancel && (
        <motion.button
          onClick={onCancel}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 
                     bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
                     text-gray-600 dark:text-gray-400 rounded-xl transition-colors"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <X className="w-4 h-4" />
          <span className="font-medium">Cancel</span>
        </motion.button>
      )}
    </div>
  );
}

/**
 * Compact progress bar for header/minimal UI
 */
export function CompactProgress({ 
  progress, 
  onCancel 
}: { 
  progress: ProgressState; 
  onCancel?: () => void;
}) {
  const percent = progress.totalBytes > 0 
    ? (progress.bytesProcessed / progress.totalBytes) * 100 
    : 0;

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.2 }}
          />
        </div>
      </div>
      <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">
        {percent.toFixed(0)}%
      </span>
      {onCancel && (
        <button
          onClick={onCancel}
          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
        >
          <X className="w-4 h-4 text-muted" />
        </button>
      )}
    </div>
  );
}
