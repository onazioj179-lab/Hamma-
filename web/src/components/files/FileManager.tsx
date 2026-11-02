/**
 * SPK V26 - File Manager
 * HAMMA-managed file catalog with search, filter, and summon
 */

import { useState, useMemo, useCallback } from 'react';
import { useAccountStore, CatalogFile, FileType, formatBytes } from '../../store/account';

// File type icons
const fileTypeIcons: Record<FileType, string> = {
  document: 'Doc',
  image: 'Img',
  video: 'Vid',
  audio: 'Aud',
  archive: 'Arc',
  code: 'Code',
  data: 'Data',
  binary: 'Bin',
  unknown: '?',
};

// File type colors
const fileTypeColors: Record<FileType, string> = {
  document: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  image: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  video: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  audio: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  archive: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  code: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  data: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  binary: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  unknown: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

export function FileManager() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FileType | 'all'>('all');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  const { 
    files, 
    selectedFiles, 
    getAllTags, 
    searchFiles, 
    selectFile, 
    deselectFile,
    clearSelection,
    deleteFile,
  } = useAccountStore();
  
  const tags = useMemo(() => getAllTags(), [getAllTags, files]);
  
  // Filter and sort files
  const displayedFiles = useMemo(() => {
    let result: CatalogFile[];
    
    // Search first
    if (searchQuery.trim()) {
      result = searchFiles(searchQuery);
    } else {
      result = files.filter((f: CatalogFile) => f.status !== 'deleted');
    }
    
    // Filter by type
    if (filterType !== 'all') {
      result = result.filter(f => f.fileType === filterType);
    }
    
    // Filter by tag
    if (filterTag) {
      result = result.filter(f => f.tags.includes(filterTag));
    }
    
    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = a.createdAt - b.createdAt;
      else if (sortBy === 'name') cmp = a.filename.localeCompare(b.filename);
      else if (sortBy === 'size') cmp = a.size - b.size;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    
    return result;
  }, [files, searchQuery, filterType, filterTag, sortBy, sortDir, searchFiles]);
  
  const handleSelect = useCallback((serial: string, e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey) {
      if (selectedFiles.includes(serial)) {
        deselectFile(serial);
      } else {
        selectFile(serial);
      }
    } else {
      clearSelection();
      selectFile(serial);
    }
  }, [selectedFiles, selectFile, deselectFile, clearSelection]);
  
  const handleDeleteSelected = useCallback(() => {
    if (confirm(`Delete ${selectedFiles.length} file(s)?`)) {
      selectedFiles.forEach((serial: string) => deleteFile(serial));
      clearSelection();
    }
  }, [selectedFiles, deleteFile, clearSelection]);
  
  return (
    <div className="workspace-surface flex flex-col min-h-full bg-slate-900 text-white">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            HAMMA File Manager
          </h2>
          
          {/* View Toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-white'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              aria-label="List view"
              className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-white'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Search & Filters */}
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="flex-1 min-w-[200px] relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files by name, serial, label, or tag..."
              aria-label="Search files"
              className="w-full px-4 py-2 pl-10 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          
          {/* Type Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as FileType | 'all')}
            aria-label="Filter by file type"
            className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Types</option>
            <option value="document">Documents</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
            <option value="archive">Archives</option>
            <option value="code">Code</option>
            <option value="data">Data</option>
            <option value="binary">Binary</option>
          </select>
          
          {/* Tag Filter */}
          <select
            value={filterTag || ''}
            onChange={(e) => setFilterTag(e.target.value || null)}
            aria-label="Filter by tag"
            className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">All Tags</option>
            {tags.map((tag: string) => (
              <option key={tag} value={tag}>#{tag}</option>
            ))}
          </select>
          
          {/* Sort */}
          <select
            value={`${sortBy}-${sortDir}`}
            onChange={(e) => {
              const [by, dir] = e.target.value.split('-');
              setSortBy(by as 'date' | 'name' | 'size');
              setSortDir(dir as 'asc' | 'desc');
            }}
            aria-label="Sort files"
            className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="size-desc">Largest First</option>
            <option value="size-asc">Smallest First</option>
          </select>
        </div>
        
        {/* Selection Actions */}
        {selectedFiles.length > 0 && (
          <div className="mt-3 flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <span className="text-emerald-400 font-medium">
              {selectedFiles.length} file(s) selected
            </span>
            <div className="flex-1" />
            <button
              onClick={clearSelection}
              className="px-3 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
            >
              Deselect
            </button>
            <button
              onClick={handleDeleteSelected}
              className="px-3 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
            >
              Delete
            </button>
            <button className="px-3 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">
              Share
            </button>
            <button className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
              Download
            </button>
          </div>
        )}
      </div>
      
      {/* File List */}
      <div className="flex-1 overflow-auto p-4">
        {displayedFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <span className="text-6xl mb-4 text-slate-600">Empty</span>
            <p className="text-lg">No files found</p>
            <p className="text-sm mt-1">
              {searchQuery ? 'Try a different search term' : 'Upload files to get started'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {displayedFiles.map((file) => (
              <FileCard 
                key={file.serial} 
                file={file} 
                selected={selectedFiles.includes(file.serial)}
                onSelect={handleSelect}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {displayedFiles.map((file) => (
              <FileRow 
                key={file.serial} 
                file={file}
                selected={selectedFiles.includes(file.serial)}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// File Card Component (Grid View)
function FileCard({ 
  file, 
  selected, 
  onSelect 
}: { 
  file: CatalogFile; 
  selected: boolean;
  onSelect: (serial: string, e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={(e) => onSelect(file.serial, e)}
      className={`group relative p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
        selected 
          ? 'bg-emerald-500/20 border-emerald-500' 
          : 'bg-slate-800 border-slate-700 hover:border-slate-600'
      }`}
    >
      {/* Selection Checkbox */}
      <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
        selected 
          ? 'bg-emerald-500 border-emerald-500' 
          : 'border-slate-500 opacity-0 group-hover:opacity-100'
      }`}>
        {selected && (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      
      {/* File Icon */}
      <div className="text-4xl text-center mb-3">
        {fileTypeIcons[file.fileType]}
      </div>
      
      {/* File Name */}
      <p className="font-medium text-white truncate text-center" title={file.filename}>
        {file.filename}
      </p>
      
      {/* Serial Number */}
      <p className="text-xs text-slate-500 text-center mt-1 font-mono">
        {file.serial}
      </p>
      
      {/* Label */}
      {file.label && (
        <p className="text-xs text-emerald-400 text-center mt-1 truncate">
          {file.label}
        </p>
      )}
      
      {/* Tags */}
      {file.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center mt-2">
          {file.tags.slice(0, 3).map((tag: string) => (
            <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
              #{tag}
            </span>
          ))}
          {file.tags.length > 3 && (
            <span className="text-xs text-slate-500">+{file.tags.length - 3}</span>
          )}
        </div>
      )}
      
      {/* Size & Compression */}
      <div className="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-400 text-center">
        <span>{formatBytes(file.size)}</span>
        {file.compressionRatio && file.compressionRatio > 1 && (
          <span className="text-emerald-400 ml-2">
            {file.compressionRatio.toFixed(1)}x
          </span>
        )}
      </div>
    </div>
  );
}

// File Row Component (List View)
function FileRow({ 
  file, 
  selected,
  onSelect 
}: { 
  file: CatalogFile; 
  selected: boolean;
  onSelect: (serial: string, e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={(e) => onSelect(file.serial, e)}
      className={`flex items-center gap-4 p-3 rounded-lg border cursor-pointer transition-all ${
        selected 
          ? 'bg-emerald-500/20 border-emerald-500' 
          : 'bg-slate-800 border-slate-700 hover:border-slate-600'
      }`}
    >
      {/* Selection Checkbox */}
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
        selected 
          ? 'bg-emerald-500 border-emerald-500' 
          : 'border-slate-500'
      }`}>
        {selected && (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      
      {/* Icon */}
      <span className="text-2xl flex-shrink-0">
        {fileTypeIcons[file.fileType]}
      </span>
      
      {/* File Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white truncate">{file.filename}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${fileTypeColors[file.fileType]}`}>
            {file.fileType}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
          <span className="font-mono">{file.serial}</span>
          {file.label && <span className="text-emerald-400">{file.label}</span>}
          {file.tags.slice(0, 3).map((tag: string) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </div>
      
      {/* Size */}
      <div className="text-right flex-shrink-0">
        <div className="text-sm text-white">{formatBytes(file.size)}</div>
        {file.compressionRatio && file.compressionRatio > 1 && (
          <div className="text-xs text-emerald-400">{file.compressionRatio.toFixed(1)}x compressed</div>
        )}
      </div>
      
      {/* Date */}
      <div className="text-sm text-slate-400 flex-shrink-0 w-24 text-right">
        {new Date(file.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}
