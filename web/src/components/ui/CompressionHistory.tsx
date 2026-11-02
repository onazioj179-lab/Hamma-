/**
 * Compression History UI
 * Named jobs, quick re-run, status tracking
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History,
  Play,
  Trash2,
  Share2,
  Download,
  Check,
  Clock,
  AlertCircle,
  Search,
  Filter,
  File,
} from 'lucide-react';

/**
 * History entry interface
 */
interface HistoryEntry {
  id: string;
  name: string;
  createdAt: Date;
  status: 'completed' | 'shared' | 'pending' | 'failed';
  inputFiles: number;
  inputSize: number;
  outputSize: number;
  compressionRatio: number;
  duration: number;
  outputPath?: string;
  shareToken?: string;
}

interface CompressionHistoryProps {
  entries: HistoryEntry[];
  onRerun: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
  onShare: (entry: HistoryEntry) => void;
  onDownload: (entry: HistoryEntry) => void;
  className?: string;
}

export function CompressionHistory({
  entries,
  onRerun,
  onDelete,
  onShare,
  onDownload,
  className = '',
}: CompressionHistoryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

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
   * Format duration
   */
  const formatDuration = (ms: number): string => {
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  /**
   * Format relative time
   */
  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  /**
   * Get status icon and color
   */
  const getStatusIcon = (status: HistoryEntry['status']) => {
    switch (status) {
      case 'completed':
        return { icon: Check, color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
      case 'shared':
        return { icon: Share2, color: 'text-primary-500', bg: 'bg-primary-500/10' };
      case 'pending':
        return { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' };
      case 'failed':
        return { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10' };
    }
  };

  /**
   * Filter entries
   */
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesSearch = entry.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || entry.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [entries, searchQuery, statusFilter]);

  /**
   * Days until auto-cleanup
   */
  const getDaysUntilCleanup = (date: Date): number => {
    const cleanupDate = new Date(date.getTime() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    return Math.max(0, Math.ceil((cleanupDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary-500" />
          <h3 className="text-lg font-semibold text-foreground">
            Compression History
          </h3>
        </div>
        
        <span className="text-xs text-muted">
          {entries.length} jobs ({filteredEntries.length} shown)
        </span>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search jobs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            aria-label="Search compression jobs"
          />
        </div>
        
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 rounded-lg border transition-colors ${
            showFilters
              ? 'bg-primary-500 text-white border-primary-500'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800'
          }`}
          aria-label={showFilters ? 'Hide filters' : 'Show filters'}
          aria-expanded={showFilters}
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Options */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex gap-2 py-2">
              {['all', 'completed', 'shared', 'pending', 'failed'].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    statusFilter === status
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-muted hover:text-foreground'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History List */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {filteredEntries.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8 text-muted"
            >
              <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No compression jobs found</p>
            </motion.div>
          ) : (
            filteredEntries.map((entry) => {
              const statusInfo = getStatusIcon(entry.status);
              const StatusIcon = statusInfo.icon;
              const daysLeft = getDaysUntilCleanup(entry.createdAt);

              return (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-800"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      {/* Job Name and Status */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`p-1 rounded ${statusInfo.bg}`}>
                          <StatusIcon className={`w-3.5 h-3.5 ${statusInfo.color}`} />
                        </span>
                        <h4 className="font-medium text-foreground truncate">
                          {entry.name}
                        </h4>
                      </div>

                      {/* Metadata */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                        <span className="flex items-center gap-1">
                          <File className="w-3 h-3" />
                          {entry.inputFiles} files
                        </span>
                        <span>
                          {formatBytes(entry.inputSize)} → {formatBytes(entry.outputSize)}
                        </span>
                        <span className="text-emerald-500">
                          {(entry.compressionRatio * 100).toFixed(1)}% ratio
                        </span>
                        <span>
                          {formatDuration(entry.duration)}
                        </span>
                        <span>
                          {formatRelativeTime(entry.createdAt)}
                        </span>
                      </div>

                      {/* Cleanup Warning */}
                      {daysLeft <= 7 && (
                        <p className="mt-2 text-xs text-amber-500">
                          Auto-cleanup in {daysLeft} days
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 ml-4">
                      {entry.status === 'completed' && (
                        <>
                          <button
                            onClick={() => onDownload(entry)}
                            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                            title="Download"
                          >
                            <Download className="w-4 h-4 text-muted hover:text-foreground" />
                          </button>
                          <button
                            onClick={() => onShare(entry)}
                            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                            title="Share"
                          >
                            <Share2 className="w-4 h-4 text-muted hover:text-foreground" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => onRerun(entry)}
                        className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                        title="Re-run"
                      >
                        <Play className="w-4 h-4 text-muted hover:text-primary-500" />
                      </button>
                      <button
                        onClick={() => onDelete(entry)}
                        className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-muted hover:text-red-500" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
