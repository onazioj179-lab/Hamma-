/**
 * Archive Preview UI
 * Display file metadata, thumbnails, and selective extraction
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Image,
  Video,
  Music,
  Archive,
  Code,
  File,
  Folder,
  FolderOpen,
  Download,
  Eye,
  ChevronRight,
  ChevronDown,
  Search,
  Check,
  X,
  Info,
  Clock,
  HardDrive,
} from 'lucide-react';

/**
 * File entry from archive
 */
interface ArchiveFile {
  id: string;
  name: string;
  path: string;
  size: number;
  compressedSize: number;
  modifiedAt: Date;
  isDirectory: boolean;
  children?: ArchiveFile[];
  mimeType?: string;
  thumbnail?: string;
}

/**
 * Archive metadata
 */
interface ArchiveMetadata {
  name: string;
  version: string;
  createdAt: Date;
  totalFiles: number;
  totalSize: number;
  compressedSize: number;
  encrypted: boolean;
  signed: boolean;
}

interface ArchivePreviewProps {
  metadata: ArchiveMetadata;
  files: ArchiveFile[];
  onExtract: (files: ArchiveFile[]) => void;
  onPreview: (file: ArchiveFile) => void;
  className?: string;
}

export function ArchivePreview({
  metadata,
  files,
  onExtract,
  onPreview,
  className = '',
}: ArchivePreviewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showMetadata, setShowMetadata] = useState(true);

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
   * Get file icon based on type
   */
  const getFileIcon = (file: ArchiveFile) => {
    if (file.isDirectory) {
      return expandedFolders.has(file.id) ? FolderOpen : Folder;
    }
    
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = file.mimeType || '';
    
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      return Image;
    }
    if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
      return Video;
    }
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
      return Music;
    }
    if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'xml'].includes(ext)) {
      return FileText;
    }
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h'].includes(ext)) {
      return Code;
    }
    if (['zip', 'tar', 'gz', 'rar', '7z', 'spk'].includes(ext)) {
      return Archive;
    }
    
    return File;
  };

  /**
   * Get file icon color
   */
  const getFileIconColor = (file: ArchiveFile): string => {
    if (file.isDirectory) return 'text-amber-500';
    
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = file.mimeType || '';
    
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      return 'text-emerald-500';
    }
    if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
      return 'text-purple-500';
    }
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
      return 'text-pink-500';
    }
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h'].includes(ext)) {
      return 'text-blue-500';
    }
    
    return 'text-muted';
  };

  /**
   * Toggle folder expansion
   */
  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  /**
   * Toggle file selection
   */
  const toggleSelection = (fileId: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  /**
   * Select all files
   */
  const selectAll = () => {
    const allIds = new Set<string>();
    const traverse = (files: ArchiveFile[]) => {
      files.forEach((f) => {
        if (!f.isDirectory) allIds.add(f.id);
        if (f.children) traverse(f.children);
      });
    };
    traverse(files);
    setSelectedFiles(allIds);
  };

  /**
   * Clear selection
   */
  const clearSelection = () => {
    setSelectedFiles(new Set());
  };

  /**
   * Filter files by search query
   */
  const filterFiles = (files: ArchiveFile[]): ArchiveFile[] => {
    if (!searchQuery) return files;
    
    return files.filter((file) => {
      const matches = file.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (file.children) {
        const filteredChildren = filterFiles(file.children);
        return matches || filteredChildren.length > 0;
      }
      return matches;
    });
  };

  /**
   * Get selected files for extraction
   */
  const getSelectedFiles = (): ArchiveFile[] => {
    const selected: ArchiveFile[] = [];
    const traverse = (files: ArchiveFile[]) => {
      files.forEach((f) => {
        if (selectedFiles.has(f.id)) selected.push(f);
        if (f.children) traverse(f.children);
      });
    };
    traverse(files);
    return selected;
  };

  /**
   * Calculate total selected size
   */
  const selectedSize = useMemo(() => {
    let total = 0;
    const traverse = (files: ArchiveFile[]) => {
      files.forEach((f) => {
        if (selectedFiles.has(f.id)) total += f.size;
        if (f.children) traverse(f.children);
      });
    };
    traverse(files);
    return total;
  }, [files, selectedFiles]);

  /**
   * Render file tree recursively
   */
  const renderFileTree = (files: ArchiveFile[], depth = 0) => {
    return filterFiles(files).map((file) => {
      const FileIcon = getFileIcon(file);
      const isExpanded = expandedFolders.has(file.id);
      const isSelected = selectedFiles.has(file.id);

      return (
        <div key={file.id}>
          <div
            className={`flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
              isSelected
                ? 'bg-primary-500/10'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {/* Expand/Collapse for folders */}
            {file.isDirectory ? (
              <button
                onClick={() => toggleFolder(file.id)}
                className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted" />
                )}
              </button>
            ) : (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleSelection(file.id)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
              />
            )}

            {/* Thumbnail or Icon */}
            {file.thumbnail ? (
              <img
                src={file.thumbnail}
                alt=""
                className="w-6 h-6 rounded object-cover"
              />
            ) : (
              <FileIcon className={`w-4 h-4 ${getFileIconColor(file)}`} />
            )}

            {/* File name */}
            <span
              className={`flex-1 text-sm truncate ${
                file.isDirectory ? 'font-medium' : ''
              } text-foreground`}
              onClick={() => file.isDirectory ? toggleFolder(file.id) : toggleSelection(file.id)}
            >
              {file.name}
            </span>

            {/* Size */}
            {!file.isDirectory && (
              <span className="text-xs text-muted">
                {formatBytes(file.size)}
              </span>
            )}

            {/* Preview button */}
            {!file.isDirectory && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(file);
                }}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100"
                aria-label={`Preview ${file.name}`}
              >
                <Eye className="w-3.5 h-3.5 text-muted" />
              </button>
            )}
          </div>

          {/* Render children if expanded */}
          {file.isDirectory && isExpanded && file.children && (
            <div>{renderFileTree(file.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Archive Metadata */}
      <AnimatePresence>
        {showMetadata && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Archive className="w-5 h-5 text-primary-500" />
                  <h3 className="font-semibold text-foreground">{metadata.name}</h3>
                </div>
                <button
                  onClick={() => setShowMetadata(false)}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800"
                  aria-label="Close metadata panel"
                >
                  <X className="w-4 h-4 text-muted" />
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted mb-1">Files</p>
                  <p className="font-medium text-foreground">{metadata.totalFiles}</p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">Original Size</p>
                  <p className="font-medium text-foreground">{formatBytes(metadata.totalSize)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">Compressed</p>
                  <p className="font-medium text-emerald-500">{formatBytes(metadata.compressedSize)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">Ratio</p>
                  <p className="font-medium text-foreground">
                    {((1 - metadata.compressedSize / metadata.totalSize) * 100).toFixed(1)}%
                  </p>
                </div>
              </div>

              <div className="flex gap-4 mt-3 pt-3 border-t border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <Clock className="w-3.5 h-3.5" />
                  {metadata.createdAt.toLocaleDateString()}
                </div>
                {metadata.encrypted && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-500">
                    <HardDrive className="w-3.5 h-3.5" />
                    Encrypted
                  </div>
                )}
                {metadata.signed && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                    <Check className="w-3.5 h-3.5" />
                    Signed
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search and Actions */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <button
          onClick={selectAll}
          className="px-3 py-2 text-xs font-medium text-primary-500 hover:bg-primary-500/10 rounded-lg transition-colors"
        >
          Select All
        </button>

        {selectedFiles.size > 0 && (
          <button
            onClick={clearSelection}
            className="px-3 py-2 text-xs font-medium text-muted hover:text-foreground rounded-lg transition-colors"
          >
            Clear
          </button>
        )}

        {!showMetadata && (
          <button
            onClick={() => setShowMetadata(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Show archive metadata"
          >
            <Info className="w-4 h-4 text-muted" />
          </button>
        )}
      </div>

      {/* File Tree */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-800 max-h-80 overflow-y-auto">
        <div className="p-2 group">
          {files.length === 0 ? (
            <div className="text-center py-8 text-muted">
              <Archive className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No files in archive</p>
            </div>
          ) : (
            renderFileTree(files)
          )}
        </div>
      </div>

      {/* Extract Button */}
      {selectedFiles.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between bg-primary-500 text-white rounded-lg p-3"
        >
          <div>
            <p className="font-medium">{selectedFiles.size} files selected</p>
            <p className="text-xs text-primary-100">{formatBytes(selectedSize)}</p>
          </div>
          
          <button
            onClick={() => onExtract(getSelectedFiles())}
            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            Extract Selected
          </button>
        </motion.div>
      )}
    </div>
  );
}
