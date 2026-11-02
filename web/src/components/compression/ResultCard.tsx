/**
 * Result Card Component
 * Clean results view after compression completes
 */

import { useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { Download, RotateCcw, Check, ArrowDown, Clock, Zap } from 'lucide-react';

interface ResultCardProps {
  operation?: 'compress' | 'decompress';
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  duration: number; // milliseconds
  averageSpeed: number; // bytes per second
  fileName: string;
  downloadUrl: string | null;
  onDownload?: () => void;
  onReset?: () => void;
}

// Format bytes
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0)} ${sizes[i]}`;
}

// Format duration
function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Format speed
function formatSpeed(bytesPerSecond: number): string {
  const mbps = bytesPerSecond / (1024 * 1024);
  if (mbps >= 1000) return `${(mbps / 1024).toFixed(2)} GB/s`;
  return `${mbps.toFixed(mbps >= 100 ? 0 : 1)} MB/s`;
}

function ResultCardBase({
  operation = 'compress',
  originalSize,
  compressedSize,
  compressionRatio,
  duration,
  averageSpeed,
  fileName,
  downloadUrl,
  onDownload,
  onReset,
}: ResultCardProps) {
  // Calculate savings
  const savings = useMemo(() => {
    const savedBytes = originalSize - compressedSize;
    const savedPercent = (originalSize === 0 ? 0 : (1 - compressionRatio) * 100).toFixed(0);
    return { bytes: savedBytes, percent: savedPercent };
  }, [originalSize, compressedSize, compressionRatio]);

  // Handle download click
  const handleDownload = () => {
    if (onDownload) { onDownload(); return; }
    if (downloadUrl) {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <motion.div
      className="w-full max-w-[420px] mx-auto bg-card rounded-2xl shadow-xl overflow-hidden"
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {/* Success Header */}
      <div className="relative py-8 px-6 text-center overflow-hidden">
        {/* Background gradient */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            background: 'radial-gradient(circle at center top, rgb(16 185 129), transparent 60%)',
          }}
        />

        {/* Success Icon */}
        <motion.div
          className="relative w-9 h-9 mx-auto mb-4 rounded-full bg-emerald-500
                     flex items-center justify-center "
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
        >
          <Check className="w-4 h-4 text-white" strokeWidth={3} />
        </motion.div>

        <motion.h2
          className="text-xl font-bold text-foreground mb-1"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {operation === 'decompress' ? 'Restoration Complete' : 'Compression Complete'}
        </motion.h2>

        <motion.p
          className="text-sm text-muted truncate max-w-[280px] mx-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {fileName}
        </motion.p>
      </div>

      {/* Stats Section */}
      <div className="px-6 pb-4">
        {/* Size Comparison */}
        <motion.div
          className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 mb-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-center">
              <p className="text-xs text-muted mb-1">{operation === 'decompress' ? 'Archive' : 'Original'}</p>
              <p className="text-base font-semibold text-foreground">{formatSize(originalSize)}</p>
            </div>

            <motion.div
              className="flex flex-col items-center"
              animate={{ y: [0, 3, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <ArrowDown className="w-4 h-4 text-emerald-500" />
            </motion.div>

            <div className="text-center">
              <p className="text-xs text-muted mb-1">{operation === 'decompress' ? 'Restored' : 'Compressed'}</p>
              <p className="text-base font-semibold text-foreground">{formatSize(compressedSize)}</p>
            </div>
          </div>

          {/* Savings Highlight */}
          {operation === 'compress' && (
          <div className={`text-center p-3 rounded-lg ${
            Number(savings.percent) < 5
              ? 'bg-amber-50 dark:bg-amber-900/20'
              : 'bg-emerald-50 dark:bg-emerald-900/20'
          }`}>
            <motion.p
              className={`text-2xl font-bold ${
                Number(savings.percent) < 5
                  ? 'text-amber-500'
                  : 'text-emerald-500'
              }`}
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.35, type: 'spring' }}
            >
              {savings.percent}% saved
            </motion.p>
            <p className={`text-xs ${
              Number(savings.percent) < 5
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}>
              {Number(savings.percent) < 5
                ? 'Little or no space saved for this file'
                : `${formatSize(savings.bytes)} smaller`
              }
            </p>
          </div>
          )}
        </motion.div>

        {/* Performance Stats */}
        <motion.div
          className="flex justify-center gap-6 mb-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <Zap className="w-4 h-4 text-primary-500" />
            </div>
            <div>
              <p className="text-xs text-muted">Speed</p>
              <p className="text-sm font-semibold text-foreground">{formatSpeed(averageSpeed)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
              <Clock className="w-4 h-4 text-cyan-500" />
            </div>
            <div>
              <p className="text-xs text-muted">Duration</p>
              <p className="text-sm font-semibold text-foreground">{formatDuration(duration)}</p>
            </div>
          </div>
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          className="flex gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          {downloadUrl ? (
            <motion.button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3
                         bg-primary-500 hover:bg-primary-600 text-white
                         rounded-md text-sm font-semibold transition-colors "
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Download className="w-4 h-4" />
              <span>Download</span>
            </motion.button>
          ) : (
            <div className="flex-1 flex items-center justify-center gap-2 py-2 px-3
                           bg-emerald-500 text-white rounded-md text-sm font-semibold">
              <Check className="w-4 h-4" />
              <span>Saved to Disk</span>
            </div>
          )}

          <motion.button
            onClick={onReset}
            className="flex items-center justify-center gap-2 py-2 px-3
                       bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
                       text-foreground rounded-md text-sm font-semibold transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RotateCcw className="w-4 h-4" />
            <span>New</span>
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}

// Memoize to prevent unnecessary re-renders
export const ResultCard = memo(ResultCardBase);
