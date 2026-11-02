/**
 * Lane Progress Visualization
 * Real-time multi-lane progress with speed metrics
 */

import { motion } from 'framer-motion';
import { Zap, Cpu, Activity } from 'lucide-react';
import type { LaneState, DetailedProgress } from '../../engine/performance/types';

interface LaneProgressProps {
  progress: DetailedProgress;
  className?: string;
}

export function LaneProgress({ progress, className = '' }: LaneProgressProps) {
  const { lanes, bytesProcessed, totalBytes, speed, eta, phase } = progress;

  /**
   * Format speed
   */
  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
  };

  /**
   * Format time
   */
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  /**
   * Format bytes
   */
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  /**
   * Overall progress percentage
   */
  const overallPercent = totalBytes > 0 ? (bytesProcessed / totalBytes) * 100 : 0;

  /**
   * Get lane color based on utilization
   */
  const getLaneColor = (lane: LaneState): string => {
    if (!lane.active) return 'bg-gray-300 dark:bg-gray-700';
    if (lane.bufferUtilization > 0.8) return 'bg-amber-500';
    if (lane.bufferUtilization > 0.5) return 'bg-emerald-500';
    return 'bg-primary-500';
  };

  /**
   * Calculate throughput target
   */
  const targetThroughput = 1.67 * 1024 * 1024 * 1024; // 100GB/min
  const throughputPercent = Math.min((speed / targetThroughput) * 100, 100);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Overall Progress */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">
            Overall Progress
          </span>
          <span className="text-sm text-muted">
            {overallPercent.toFixed(1)}%
          </span>
        </div>
        
        <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${overallPercent}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        
        <div className="flex justify-between mt-1 text-xs text-muted">
          <span>{formatBytes(bytesProcessed)}</span>
          <span>{formatBytes(totalBytes)}</span>
        </div>
      </div>

      {/* Speed and ETA */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-muted">Speed</span>
          </div>
          <p className="text-lg font-semibold text-foreground">
            {formatSpeed(speed)}
          </p>
        </div>
        
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-primary-500" />
            <span className="text-xs text-muted">Phase</span>
          </div>
          <p className="text-lg font-semibold text-foreground capitalize">
            {phase}
          </p>
        </div>
        
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4 text-emerald-500" />
            <span className="text-xs text-muted">ETA</span>
          </div>
          <p className="text-lg font-semibold text-foreground">
            {eta > 0 ? formatTime(eta) : '--'}
          </p>
        </div>
      </div>

      {/* Lane Visualization */}
      {lanes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              Processing Lanes
            </span>
            <span className="text-xs text-muted">
              {lanes.filter(l => l.active).length}/{lanes.length} active
            </span>
          </div>
          
          <div className="grid gap-2">
            {lanes.map((lane) => (
              <div key={lane.id} className="flex items-center gap-3">
                <span className="text-xs text-muted w-16">Lane {lane.id + 1}</span>
                
                <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${getLaneColor(lane)}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${lane.bufferUtilization * 100}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
                
                <span className="text-xs text-muted w-20 text-right">
                  {formatSpeed(lane.currentSpeed)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Throughput Target */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">
            Throughput Target
          </span>
          <span className={`text-xs ${throughputPercent >= 80 ? 'text-emerald-500' : 'text-amber-500'}`}>
            {throughputPercent.toFixed(0)}% of 100GB/min
          </span>
        </div>
        
        <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              throughputPercent >= 80 ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${throughputPercent}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>
    </div>
  );
}
