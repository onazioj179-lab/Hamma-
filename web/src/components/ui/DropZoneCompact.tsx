/**
 * Compact Drop Zone
 * Supports multiple files (up to 5000) and folder selection
 * Optimized for large file batches with streaming
 */

import { useCallback, useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileArchive, Files, FolderOpen, ChevronDown } from 'lucide-react';

// Maximum files allowed
const MAX_FILES = 5000;

interface DropZoneCompactProps {
  onFileSelect: (file: File) => void;
  onFilesSelect?: (files: File[]) => void;
  disabled?: boolean;
  multiple?: boolean;
}

export function DropZoneCompact({ 
  onFileSelect, 
  onFilesSelect,
  disabled = false,
  multiple = true,
}: DropZoneCompactProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const menuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle single or multiple files
  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setSelectionError(null);
    if (files.length > MAX_FILES) {
      setSelectionError(`Select at most ${MAX_FILES.toLocaleString()} files. No files were processed.`);
      return;
    }
    
    setIsProcessing(true);
    setFileCount(files.length);
    
    try {
      // Small delay to let UI update
      await new Promise(r => setTimeout(r, 10));
      
      if (files.length === 1) {
        // Single file - use original callback
        onFileSelect(files[0]);
      } else if (onFilesSelect) {
        // Multiple files - use multi callback
        onFilesSelect(files);
      } else {
        // Fallback: compress first file only (for backward compat)
        onFileSelect(files[0]);
      }
    } finally {
      setIsProcessing(false);
      setFileCount(0);
    }
  }, [onFileSelect, onFilesSelect]);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items?.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Process a FileSystemEntry recursively (for folder drops)
   */
  const processEntry = async (entry: FileSystemEntry): Promise<File[]> => {
    if (entry.isFile) {
      return new Promise((resolve, reject) => {
        (entry as FileSystemFileEntry).file(
          (file) => {
            // Preserve relative path
            Object.defineProperty(file, 'webkitRelativePath', {
              value: entry.fullPath.substring(1), // Remove leading /
              writable: false,
            });
            resolve([file]);
          },
          () => reject(new Error(`Unable to read ${entry.name}`))
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const files: File[] = [];
      
      const readEntries = (): Promise<FileSystemEntry[]> => {
        return new Promise((resolve, reject) => {
          dirReader.readEntries(resolve, () => reject(new Error(`Unable to read folder ${entry.name}`)));
        });
      };

      let entries: FileSystemEntry[];
      do {
        entries = await readEntries();
        for (const e of entries) {
          if (files.length > MAX_FILES) break;
          const entryFiles = await processEntry(e);
          files.push(...entryFiles.slice(0, MAX_FILES + 1 - files.length));
        }
      } while (entries.length > 0 && files.length <= MAX_FILES);

      return files;
    }
    
    return [];
  };

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (disabled) return;

    try {

    const items = e.dataTransfer.items;
    const collectedFiles: File[] = [];

    // Try to get FileSystemEntry for folder support
    if (items && items.length > 0) {
      const entries: FileSystemEntry[] = [];
      
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) {
          entries.push(entry);
        }
      }

      if (entries.length > 0) {
        // Process entries (handles folders recursively)
        for (const entry of entries) {
          if (collectedFiles.length > MAX_FILES) break;
          const files = await processEntry(entry);
          collectedFiles.push(...files.slice(0, MAX_FILES + 1 - collectedFiles.length));
        }
      }
    }

    // Fallback to regular file list if no entries
    if (collectedFiles.length === 0) {
      const files = e.dataTransfer.files;
      for (let i = 0; i < Math.min(files.length, MAX_FILES + 1); i++) {
        collectedFiles.push(files[i]);
      }
    }

    if (collectedFiles.length > 0) {
      handleFiles(collectedFiles);
    }
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'Unable to read selected files');
    }
  }, [disabled, handleFiles]);

  const handleFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      handleFiles(fileArray);
    }
    e.target.value = '';
  }, [handleFiles]);

  const handleFolderInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      handleFiles(fileArray);
    }
    e.target.value = '';
  }, [handleFiles]);

  const openFileDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      fileInputRef.current?.click();
      setShowMenu(false);
    }
  }, [disabled]);

  const openFolderDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      folderInputRef.current?.click();
      setShowMenu(false);
    }
  }, [disabled]);

  const handleMenuToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(prev => !prev);
  }, []);

  const handleMenuLeave = useCallback(() => {
    // Delay closing menu to allow clicking on menu items
    menuTimeoutRef.current = setTimeout(() => {
      setShowMenu(false);
    }, 150);
  }, []);

  const handleMenuEnter = useCallback(() => {
    if (menuTimeoutRef.current) {
      clearTimeout(menuTimeoutRef.current);
      menuTimeoutRef.current = null;
    }
  }, []);

  // Close menu when clicking anywhere on the dropzone (not the button)
  const handleDropzoneClick = useCallback(() => {
    setShowMenu(false);
  }, []);

  return (
    <motion.div
      className={`
        drop-zone w-full cursor-pointer
        ${isDragOver ? 'drop-zone-active' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleDropzoneClick}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
    >
      <div className="flex flex-col items-center text-center">
        {selectionError && <p role="alert" className="text-red-500 mb-3">{selectionError}</p>}
        {/* Icon */}
        <motion.div 
          className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-5
            ${isDragOver 
              ? 'bg-gradient-to-br from-blue-500/20 to-purple-500/20' 
              : 'bg-gradient-to-br from-blue-500/10 to-purple-500/5'
            }`}
          animate={isDragOver ? { scale: 1.15, rotate: 5 } : { scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300 }}
        >
          {isDragOver ? (
            <FileArchive className="w-10 h-10 text-accent" />
          ) : isProcessing ? (
            <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            <Upload className="w-10 h-10 text-accent" />
          )}
        </motion.div>

        {/* Text */}
        <p className="text-lg font-semibold text-foreground mb-2">
          {isDragOver ? 'Drop to compress' : isProcessing ? `Processing ${fileCount} files...` : 'Drop files here'}
        </p>
        <p className="text-sm text-muted mb-6">
          or click to browse • Up to {MAX_FILES.toLocaleString()} files
        </p>

        {/* Buttons Row */}
        <div className="flex gap-3">
          <button
            onClick={openFileDialog}
            disabled={disabled || isProcessing}
            className="ios-btn-primary flex items-center gap-2"
          >
            <Files className="w-4 h-4" />
            Select Files
          </button>
          <button
            onClick={openFolderDialog}
            disabled={disabled || isProcessing}
            className="ios-btn-secondary flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            Select Folder
          </button>
        </div>
      </div>

      {/* Combined file/folder input - supports both multiple files and directories */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        className="hidden"
        onChange={handleFileInputChange}
        disabled={disabled}
        aria-label="Select files to compress"
      />

      {/* Folder input for directory selection */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore - webkitdirectory is not in types
        webkitdirectory=""
        className="hidden"
        onChange={handleFolderInputChange}
        disabled={disabled}
        aria-label="Select folder to compress"
      />
    </motion.div>
  );
}
