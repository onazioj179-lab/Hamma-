/**
 * Compact Progress View
 * Centered, max 60% width, no scroll
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { formatBytes, formatSpeed, formatDuration } from '../../engine/streaming/reader';
import type { ProgressState } from '../../store/app';

interface ProgressCompactProps {
  progress: ProgressState;
  fileName?: string;
  onCancel?: () => void;
}

export function ProgressCompact({ progress, fileName, onCancel }: ProgressCompactProps) {
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

  // Circular progress values
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  // Savings
  const savings = compressionRatio < 1 
    ? `${((1 - compressionRatio) * 100).toFixed(0)}%` 
    : '0%';

  return (
    <div className="progress-container mx-auto">
      {/* Progress Circle */}
      <div className="relative w-28 h-28 mx-auto mb-4">
        <svg className="w-full h-full -rotate-90">
          <circle
            cx="56"
            cy="56"
            r={radius}
            className="fill-none stroke-gray-200 dark:stroke-gray-800"
            strokeWidth="6"
          />
          <motion.circle
            cx="56"
            cy="56"
            r={radius}
            className="fill-none stroke-primary-500"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.3 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-foreground">{percent.toFixed(0)}%</span>
        </div>
      </div>

      {/* File name */}
      {fileName && (
        <p className="text-sm font-medium text-foreground text-center truncate max-w-full mb-3">
          {fileName}
        </p>
      )}

      {/* Stats Row - Compact */}
      <div className="flex justify-center gap-4 text-xs mb-4">
        <StatBadge label="Speed" value={formatSpeed(speed)} />
        <StatBadge label="ETA" value={eta > 0 ? formatDuration(eta) : '—'} />
        <StatBadge label="Saved" value={savings} highlight />
      </div>

      {/* Chunk Progress */}
      <div className="w-full mb-4">
        <div className="flex justify-between text-xs text-muted mb-1">
          <span>Chunk {chunksProcessed}/{totalChunks || '?'}</span>
          <span>{formatBytes(bytesProcessed)}</span>
        </div>
        <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.2 }}
          />
        </div>
      </div>

      {/* Cancel Button */}
      {onCancel && (
        <button
          onClick={onCancel}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-4
                     bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
                     text-sm text-muted rounded-lg transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          <span>Cancel</span>
        </button>
      )}
    </div>
  );
}

function StatBadge({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className="text-muted mb-0.5">{label}</p>
      <p className={`font-semibold ${highlight ? 'text-emerald-500' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  );
}
