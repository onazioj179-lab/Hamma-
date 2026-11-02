/**
 * Advanced File Picker
 * Multi-select up to 5,000 files with folder support
 */

import { useState, useCallback, useRef, type DragEvent, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, 
  FolderOpen, 
  File, 
  X, 
  CheckCircle, 
  AlertCircle,
  FileArchive,
  Image,
  Video,
  Music,
  FileText,
  Code,
} from 'lucide-react';

// Maximum files allowed
const MAX_FILES = 5000;

// File type icons
const FILE_ICONS: Record<string, typeof File> = {
  'image': Image,
  'video': Video,
  'audio': Music,
  'text': FileText,
  'application/json': Code,
  'application/javascript': Code,
  'application/zip': FileArchive,
  'application/x-rar': FileArchive,
  'application/x-7z-compressed': FileArchive,
};

interface SelectedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  path?: string;
}

interface AdvancedFilePickerProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  accept?: string;
  className?: string;
}

export function AdvancedFilePicker({
  onFilesSelected,
  maxFiles = MAX_FILES,
  accept,
  className = '',
}: AdvancedFilePickerProps) {
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  /**
   * Get icon for file type
   */
  const getFileIcon = (type: string) => {
    const category = type.split('/')[0];
    return FILE_ICONS[type] || FILE_ICONS[category] || File;
  };

  /**
   * Format file size
   */
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  /**
   * Process file list
   */
  const processFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    
    if (fileArray.length > maxFiles) {
      setError(`Maximum ${maxFiles} files allowed`);
      return;
    }

    const newFiles: SelectedFile[] = fileArray.map((file, index) => ({
      id: `file-${Date.now()}-${index}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      path: (file as any).webkitRelativePath || undefined,
    }));

    setSelectedFiles(prev => {
      const combined = [...prev, ...newFiles];
      if (combined.length > maxFiles) {
        setError(`Maximum ${maxFiles} files allowed`);
        return prev;
      }
      return combined;
    });
    
    setError(null);
  }, [maxFiles]);

  /**
   * Handle file input change
   */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  };

  /**
   * Handle drag over
   */
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  /**
   * Handle drag leave
   */
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  /**
   * Handle drop
   */
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    const files: File[] = [];

    // Handle folder drops
    if (items) {
      const entries: FileSystemEntry[] = [];
      
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) {
          entries.push(entry);
        }
      }

      // Process entries recursively
      for (const entry of entries) {
        const entryFiles = await processEntry(entry);
        files.push(...entryFiles);
        
        if (files.length > maxFiles) {
          setError(`Maximum ${maxFiles} files allowed`);
          break;
        }
      }
    } else {
      // Fallback for simple file drops
      files.push(...Array.from(e.dataTransfer.files));
    }

    if (files.length > 0) {
      processFiles(files);
    }
  };

  /**
   * Process file system entry recursively
   */
  const processEntry = async (entry: FileSystemEntry): Promise<File[]> => {
    if (entry.isFile) {
      return new Promise((resolve) => {
        (entry as FileSystemFileEntry).file(
          (file) => resolve([file]),
          () => resolve([])
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const files: File[] = [];
      
      const readEntries = (): Promise<FileSystemEntry[]> => {
        return new Promise((resolve) => {
          dirReader.readEntries(resolve, () => resolve([]));
        });
      };

      let entries: FileSystemEntry[];
      do {
        entries = await readEntries();
        for (const e of entries) {
          const entryFiles = await processEntry(e);
          files.push(...entryFiles);
        }
      } while (entries.length > 0);

      return files;
    }
    
    return [];
  };

  /**
   * Remove file from selection
   */
  const removeFile = (id: string) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== id));
  };

  /**
   * Clear all files
   */
  const clearAll = () => {
    setSelectedFiles([]);
    setError(null);
  };

  /**
   * Confirm selection
   */
  const confirmSelection = () => {
    onFilesSelected(selectedFiles.map(f => f.file));
  };

  /**
   * Calculate total size
   */
  const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center transition-all
          ${isDragging 
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30' 
            : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
          }
        `}
      >
        <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? 'text-primary-500' : 'text-muted'}`} />
        
        <p className="text-lg font-medium text-foreground mb-2">
          {isDragging ? 'Drop files here' : 'Drag files or folders here'}
        </p>
        
        <p className="text-sm text-muted mb-4">
          or use the buttons below
        </p>

        <div className="flex justify-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            <File className="w-4 h-4" />
            Select Files
          </button>
          
          <button
            onClick={() => folderInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-foreground rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            Select Folder
          </button>
        </div>

        {/* Hidden inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          onChange={handleFileChange}
          className="hidden"
          aria-label="Select files to compress"
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-ignore - webkitdirectory is not in types
          webkitdirectory=""
          onChange={handleFileChange}
          className="hidden"
          aria-label="Select folder to compress"
        />
      </div>

      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-lg"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected files */}
      {selectedFiles.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 border-b border-border">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <span className="font-medium text-foreground">
                {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
              </span>
              <span className="text-muted">({formatSize(totalSize)})</span>
            </div>
            
            <button
              onClick={clearAll}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          </div>

          {/* File list */}
          <div className="max-h-64 overflow-y-auto">
            {selectedFiles.slice(0, 100).map((file) => {
              const Icon = getFileIcon(file.type);
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-3 border-b border-border last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                >
                  <Icon className="w-5 h-5 text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {file.name}
                    </p>
                    {file.path && (
                      <p className="text-xs text-muted truncate">{file.path}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted shrink-0">
                    {formatSize(file.size)}
                  </span>
                  <button
                    onClick={() => removeFile(file.id)}
                    className="p-1 text-muted hover:text-foreground transition-colors"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            
            {selectedFiles.length > 100 && (
              <div className="p-3 text-center text-sm text-muted">
                ... and {selectedFiles.length - 100} more files
              </div>
            )}
          </div>

          {/* Action button */}
          <div className="p-3 bg-gray-50 dark:bg-gray-900 border-t border-border">
            <button
              onClick={confirmSelection}
              className="w-full py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium"
            >
              Compress {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
