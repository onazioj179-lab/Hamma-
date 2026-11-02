/**
 * Professional Compression Loader
 * Clean loading UI with animated speed indicators
 */

import { useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap } from 'lucide-react';
import type { ProgressState } from '../../store/app';

interface CompressionLoaderProps {
  progress: ProgressState;
  fileName?: string;
  onCancel?: () => void;
}

// Format bytes to human readable
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0)} ${sizes[i]}`;
}

// Format speed with auto-scaling (MB/s or GB/s)
function formatSpeed(bytesPerSecond: number): { value: string; unit: string } {
  if (bytesPerSecond === 0) return { value: '0', unit: 'MB/s' };
  
  const mbps = bytesPerSecond / (1024 * 1024);
  
  if (mbps >= 1000) {
    return { value: (mbps / 1024).toFixed(2), unit: 'GB/s' };
  }
  
  return { value: mbps.toFixed(mbps >= 100 ? 0 : mbps >= 10 ? 1 : 2), unit: 'MB/s' };
}

// Format ETA
function formatETA(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '--';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function CompressionLoaderBase({ progress, fileName, onCancel }: CompressionLoaderProps) {
  const {
    bytesProcessed,
    totalBytes,
    chunksProcessed,
    totalChunks,
    speed,
    eta,
  } = progress;

  // Calculate percentage
  const percent = useMemo(() => {
    if (totalBytes === 0) return 0;
    return Math.min(100, (bytesProcessed / totalBytes) * 100);
  }, [bytesProcessed, totalBytes]);

  // Circular progress values
  const radius = 70;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  // Formatted speed
  const speedDisplay = useMemo(() => formatSpeed(speed), [speed]);

  return (
    <div className="relative w-full max-w-[480px] mx-auto">
      {/* Pulsing Background */}
      <motion.div
        className="absolute inset-0 rounded-3xl opacity-30"
        style={{
          background: 'radial-gradient(circle at center, rgb(99 102 241 / 0.3), transparent 70%)',
        }}
        animate={{
          scale: [1, 1.05, 1],
          opacity: [0.2, 0.35, 0.2],
        }}
        transition={{
          duration: 2.5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Cancel Button - Top Right */}
      {onCancel && (
        <motion.button
          onClick={onCancel}
          className="absolute top-2 right-2 p-2 rounded-full
                     bg-white/10 hover:bg-white/20 dark:bg-black/20 dark:hover:bg-black/30
                     backdrop-blur-sm transition-colors z-10"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title="Cancel compression"
        >
          <X className="w-5 h-5 text-muted" />
        </motion.button>
      )}

      {/* Main Content */}
      <div className="relative flex flex-col items-center py-8 px-6">
        {/* Large Circular Progress */}
        <div className="relative w-44 h-44 mb-6">
          {/* Background glow */}
          <div className="absolute inset-2 rounded-full bg-primary-500/10 blur-xl" />
          
          {/* SVG Progress Ring */}
          <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160">
            {/* Track */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              className="fill-none stroke-gray-200 dark:stroke-gray-800"
              strokeWidth={strokeWidth}
            />
            
            {/* Progress with gradient */}
            <defs>
              <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgb(99 102 241)" />
                <stop offset="50%" stopColor="rgb(139 92 246)" />
                <stop offset="100%" stopColor="rgb(34 211 238)" />
              </linearGradient>
            </defs>
            
            <motion.circle
              cx="80"
              cy="80"
              r={radius}
              className="fill-none"
              stroke="url(#progressGradient)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </svg>

          {/* Center Content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span 
              className="text-4xl font-bold text-foreground tabular-nums"
              key={Math.floor(percent)}
              initial={{ opacity: 0.5, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {percent.toFixed(0)}%
            </motion.span>
          </div>
        </div>

        {/* File Name */}
        {fileName && (
          <motion.p 
            className="text-sm font-medium text-foreground text-center truncate max-w-full mb-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {fileName}
          </motion.p>
        )}

        {/* Speed Display - Large */}
        <div className="flex items-center justify-center gap-2 mb-5">
          <motion.div
            className="p-2 rounded-lg bg-primary-500/10"
            animate={{ 
              backgroundColor: ['rgb(99 102 241 / 0.1)', 'rgb(99 102 241 / 0.2)', 'rgb(99 102 241 / 0.1)'] 
            }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <Zap className="w-5 h-5 text-primary-500" />
          </motion.div>
          <div className="flex items-baseline gap-1">
            <AnimatePresence mode="wait">
              <motion.span
                key={speedDisplay.value}
                className="text-3xl font-bold text-foreground tabular-nums"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
              >
                {speedDisplay.value}
              </motion.span>
            </AnimatePresence>
            <span className="text-lg text-muted font-medium">{speedDisplay.unit}</span>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex items-center justify-center gap-6 mb-4">
          {/* Chunks */}
          <div className="text-center">
            <p className="text-xs text-muted mb-0.5">Chunks</p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {chunksProcessed} / {totalChunks || '—'}
            </p>
          </div>
          
          {/* Divider */}
          <div className="w-px h-8 bg-border" />
          
          {/* ETA */}
          <div className="text-center">
            <p className="text-xs text-muted mb-0.5">ETA</p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {formatETA(eta)}
            </p>
          </div>
          
          {/* Divider */}
          <div className="w-px h-8 bg-border" />
          
          {/* Processed */}
          <div className="text-center">
            <p className="text-xs text-muted mb-0.5">Processed</p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {formatSize(bytesProcessed)}
            </p>
          </div>
        </div>

        {/* Chunk Progress Bar */}
        <div className="w-full max-w-xs">
          <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, rgb(99 102 241), rgb(139 92 246), rgb(34 211 238))',
                backgroundSize: '200% 100%',
              }}
              initial={{ width: 0 }}
              animate={{ 
                width: `${percent}%`,
                backgroundPosition: ['0% 0%', '100% 0%'],
              }}
              transition={{ 
                width: { duration: 0.3 },
                backgroundPosition: { duration: 2, repeat: Infinity, ease: 'linear' },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const CompressionLoader = memo(CompressionLoaderBase);
