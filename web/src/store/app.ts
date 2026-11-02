/**
 * SPK V43 - Global State Store (Zustand)
 * Production-grade state management with persistence
 */

import { create } from 'zustand';
import { usePreferences } from './preferences';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_CHUNK_SIZE } from '../engine/wasm/types';
import type { DetailedProgress, LaneState } from '../engine/performance/types';
import type { ShareToken, TransferProgress } from '../engine/sharing/types';

// Extend TransferProgress with id for local state tracking
export interface P2PTransfer extends TransferProgress {
  id: string;
}

// ============================================================================
// Types
// ============================================================================

export type CompressionMode = 'fast' | 'balanced' | 'strong' | 'maximum' | 'extreme' | 'auto';
export type Theme = 'light' | 'dark' | 'system';

export type OperationStatus = 
  | 'idle' 
  | 'initializing'
  | 'preparing' 
  | 'processing' 
  | 'finalizing' 
  | 'completed' 
  | 'cancelled' 
  | 'error';

// File info
export interface FileInfo {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

// Progress with speed/ETA
export interface ProgressState {
  bytesProcessed: number;
  totalBytes: number;
  chunksProcessed: number;
  totalChunks: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
  compressionRatio: number;
  startTime: number;
  phase: string;
}

// Lane-level progress (V43)
export interface LaneProgressState extends ProgressState {
  lanes: LaneState[];
  activeLanes: number;
  throughputTarget: number; // 100GB/min target
  throughputPercent: number;
}

// Recent archive
export interface RecentArchive {
  id: string;
  fileName: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  date: number;
  type: 'compress' | 'decompress';
  mode: CompressionMode;
}

// Compression history entry (V43)
export interface HistoryEntry {
  id: string;
  name: string;
  createdAt: number;
  status: 'completed' | 'shared' | 'pending' | 'failed';
  inputFiles: number;
  inputSize: number;
  outputSize: number;
  compressionRatio: number;
  duration: number;
  outputPath?: string;
  shareToken?: string;
  encrypted: boolean;
  signed: boolean;
}

// Security settings (V43)
export interface SecuritySettings {
  enableEncryption: boolean;
  encryptionAlgorithm: 'aes-256-gcm' | 'chacha20-poly1305';
  enableSigning: boolean;
  publicKey?: string;
}

// Sharing state (V43)
export interface SharingState {
  activeTokens: ShareToken[];
  activeTransfers: P2PTransfer[];
  connectedPeers: string[];
}

// Account state (V26 - Wallet-style)
export interface AccountState {
  isLoggedIn: boolean;
  accountId: string | null;
  displayName: string | null;
  storageUsed: number;
  storageQuota: number;
  tier: 'free' | 'basic' | 'pro' | 'enterprise';
  fileCount: number;
  recoveryPhraseShown: boolean;
}

// Catalog file entry (V26)
export interface CatalogFile {
  serial: string;
  filename: string;
  fileType: string;
  label: string | null;
  tags: string[];
  size: number;
  compressedSize: number | null;
  status: 'active' | 'processing' | 'archived' | 'deleted';
  createdAt: number;
  modifiedAt: number;
}

// Compression settings
export interface CompressionSettings {
  mode: CompressionMode;
  chunkSize: number;
  enableDedup: boolean;
  enableEncryption: boolean;
}

// WASM capabilities
export interface WasmCapabilities {
  hasSharedArrayBuffer: boolean;
  hasRealWasm: boolean;
  maxMemory: number;
}

// App state
interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  
  // Settings
  compressionMode: CompressionMode;
  setCompressionMode: (mode: CompressionMode) => void;
  chunkSize: number;
  setChunkSize: (size: number) => void;
  enableDedup: boolean;
  setEnableDedup: (enabled: boolean) => void;
  enableEncryption: boolean;
  setEnableEncryption: (enabled: boolean) => void;
  autoDownload: boolean;
  setAutoDownload: (enabled: boolean) => void;
  showAdvanced: boolean;
  setShowAdvanced: (show: boolean) => void;
  
  // Security settings (V43)
  securitySettings: SecuritySettings;
  setSecuritySettings: (settings: Partial<SecuritySettings>) => void;
  
  // Current file
  selectedFile: FileInfo | null;
  setSelectedFile: (file: FileInfo | null) => void;
  
  // Multi-file selection (V43)
  selectedFiles: FileInfo[];
  setSelectedFiles: (files: FileInfo[]) => void;
  addSelectedFile: (file: FileInfo) => void;
  removeSelectedFile: (name: string) => void;
  clearSelectedFiles: () => void;
  
  // Operation state
  operationType: 'compress' | 'decompress' | null;
  operationId: string | null;
  operationStatus: OperationStatus;
  progress: ProgressState;
  laneProgress: LaneProgressState | null;
  startOperation: (type: 'compress' | 'decompress', id: string, file: FileInfo) => void;
  updateProgress: (progress: Partial<ProgressState>) => void;
  updateLaneProgress: (progress: Partial<LaneProgressState>) => void;
  completeOperation: () => void;
  cancelOperation: () => void;
  setOperationError: (error: string) => void;
  resetOperation: () => void;
  
  // Results
  result: {
    originalSize: number;
    resultSize: number;
    ratio: number;
    duration: number;
    speedMbps: number;
    outputName: string;
    historyId?: string;
    historyCreated?: number;
    downloadUrl: string | null;
  } | null;
  setResult: (result: AppState['result']) => void;
  clearResult: () => void;
  
  // Error
  error: string | null;
  errorCode: string | null;
  setError: (error: string, code?: string) => void;
  clearError: () => void;
  
  // WASM state
  wasmReady: boolean;
  wasmCapabilities: WasmCapabilities | null;
  setWasmReady: (ready: boolean, capabilities?: WasmCapabilities) => void;
  
  // Recent archives
  recentArchives: RecentArchive[];
  addRecentArchive: (archive: Omit<RecentArchive, 'id' | 'date'>) => void;
  removeRecentArchive: (id: string) => void;
  clearRecentArchives: () => void;
  
  // Compression history (V43)
  history: HistoryEntry[];
  addHistoryEntry: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => void;
  updateHistoryEntry: (id: string, updates: Partial<HistoryEntry>) => void;
  removeHistoryEntry: (id: string) => void;
  clearHistory: () => void;
  
  // Sharing state (V43)
  sharing: SharingState;
  addShareToken: (token: ShareToken) => void;
  removeShareToken: (tokenId: string) => void;
  addActiveTransfer: (transfer: P2PTransfer) => void;
  updateActiveTransfer: (transferId: string, updates: Partial<P2PTransfer>) => void;
  removeActiveTransfer: (transferId: string) => void;
  addConnectedPeer: (peerId: string) => void;
  removeConnectedPeer: (peerId: string) => void;
  
  // Settings panel
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  
  // Preview panel (V43)
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
  
  // History panel (V43)
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  
  // Helpers
  getCompressionSettings: () => CompressionSettings;
  isProcessing: () => boolean;
  getProgressPercent: () => number;
}

// Default progress state
const defaultProgress: ProgressState = {
  bytesProcessed: 0,
  totalBytes: 0,
  chunksProcessed: 0,
  totalChunks: 0,
  speed: 0,
  eta: 0,
  compressionRatio: 1,
  startTime: 0,
  phase: 'idle',
};

// Default lane progress state (V43)
const defaultLaneProgress: LaneProgressState = {
  ...defaultProgress,
  lanes: [],
  activeLanes: 0,
  throughputTarget: 1.67 * 1024 * 1024 * 1024, // 100GB/min
  throughputPercent: 0,
};

// Default security settings (V43)
const defaultSecuritySettings: SecuritySettings = {
  enableEncryption: false,
  encryptionAlgorithm: 'aes-256-gcm',
  enableSigning: false,
};

// Default sharing state (V43)
const defaultSharingState: SharingState = {
  activeTokens: [],
  activeTransfers: [],
  connectedPeers: [],
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Theme
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      
      // Settings
      compressionMode: 'balanced',
      setCompressionMode: (compressionMode) => set({ compressionMode }),
      chunkSize: DEFAULT_CHUNK_SIZE,
      setChunkSize: (chunkSize) => set({ chunkSize }),
      enableDedup: false,
      setEnableDedup: (enableDedup) => set({ enableDedup }),
      enableEncryption: false,
      setEnableEncryption: (enableEncryption) => set({ enableEncryption }),
      autoDownload: false,
      setAutoDownload: (autoDownload) => set({ autoDownload }),
      showAdvanced: false,
      setShowAdvanced: (showAdvanced) => set({ showAdvanced }),
      
      // Security settings (V43)
      securitySettings: defaultSecuritySettings,
      setSecuritySettings: (settings) => set((state) => ({
        securitySettings: { ...state.securitySettings, ...settings },
      })),
      
      // Current file
      selectedFile: null,
      setSelectedFile: (selectedFile) => set({ selectedFile }),
      
      // Multi-file selection (V43)
      selectedFiles: [],
      setSelectedFiles: (selectedFiles) => set({ selectedFiles }),
      addSelectedFile: (file) => set((state) => ({
        selectedFiles: [...state.selectedFiles, file],
      })),
      removeSelectedFile: (name) => set((state) => ({
        selectedFiles: state.selectedFiles.filter(f => f.name !== name),
      })),
      clearSelectedFiles: () => set({ selectedFiles: [] }),
      
      // Operation state
      operationType: null,
      operationId: null,
      operationStatus: 'idle',
      progress: defaultProgress,
      laneProgress: null,
      startOperation: (type, id, file) => set({
        operationType: type,
        operationId: id,
        operationStatus: 'preparing',
        selectedFile: file,
        progress: {
          ...defaultProgress,
          totalBytes: file.size,
          startTime: Date.now(),
          phase: 'preparing',
        },
        laneProgress: {
          ...defaultLaneProgress,
          totalBytes: file.size,
          startTime: Date.now(),
          phase: 'preparing',
        },
        error: null,
        errorCode: null,
      }),
      updateProgress: (progress) => set((state) => ({
        progress: { ...state.progress, ...progress },
        operationStatus: 'processing',
      })),
      updateLaneProgress: (laneProgress) => set((state) => ({
        laneProgress: state.laneProgress 
          ? { ...state.laneProgress, ...laneProgress }
          : { ...defaultLaneProgress, ...laneProgress },
      })),
      completeOperation: () => set({ operationStatus: 'completed' }),
      cancelOperation: () => set({ operationStatus: 'cancelled' }),
      setOperationError: (error) => set({ operationStatus: 'error', error }),
      resetOperation: () => set({
        operationType: null,
        operationId: null,
        operationStatus: 'idle',
        progress: defaultProgress,
        laneProgress: null,
        result: null,
        error: null,
        errorCode: null,
      }),
      
      // Results
      result: null,
      setResult: (result) => set({ result }),
      clearResult: () => set({ result: null }),
      
      // Error
      error: null,
      errorCode: null,
      setError: (error, code) => set({ error, errorCode: code || null, operationStatus: 'error' }),
      clearError: () => set({ error: null, errorCode: null }),
      
      // WASM state
      wasmReady: false,
      wasmCapabilities: null,
      setWasmReady: (wasmReady, capabilities) => set({ 
        wasmReady, 
        wasmCapabilities: capabilities || null 
      }),
      
      // Recent archives
      recentArchives: [],
      addRecentArchive: (archive) => {
        const newArchive: RecentArchive = {
          ...archive,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          date: Date.now(),
        };
        set((state) => ({
          result: state.result ? { ...state.result, historyId: newArchive.id, historyCreated: newArchive.date } : null,
          recentArchives: usePreferences.getState().rememberHistory ? [newArchive, ...state.recentArchives].slice(0, 20) : state.recentArchives,
        }));
      },
      removeRecentArchive: (id) => set((state) => ({
        recentArchives: state.recentArchives.filter(a => a.id !== id),
      })),
      clearRecentArchives: () => set({ recentArchives: [], history: [] }),
      
      // Compression history (V43)
      history: [],
      addHistoryEntry: (entry) => {
        if (!usePreferences.getState().rememberHistory) return;
        const newEntry: HistoryEntry = {
          ...entry,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          createdAt: Date.now(),
        };
        set((state) => ({
          history: [newEntry, ...state.history].slice(0, 100),
        }));
      },
      updateHistoryEntry: (id, updates) => set((state) => ({
        history: state.history.map(e => e.id === id ? { ...e, ...updates } : e),
      })),
      removeHistoryEntry: (id) => set((state) => ({
        history: state.history.filter(e => e.id !== id),
      })),
      clearHistory: () => set({ history: [] }),
      
      // Sharing state (V43)
      sharing: defaultSharingState,
      addShareToken: (token) => set((state) => ({
        sharing: {
          ...state.sharing,
          activeTokens: [...state.sharing.activeTokens, token],
        },
      })),
      removeShareToken: (tokenId) => set((state) => ({
        sharing: {
          ...state.sharing,
          activeTokens: state.sharing.activeTokens.filter(t => t.id !== tokenId),
        },
      })),
      addActiveTransfer: (transfer) => set((state) => ({
        sharing: {
          ...state.sharing,
          activeTransfers: [...state.sharing.activeTransfers, transfer],
        },
      })),
      updateActiveTransfer: (transferId, updates) => set((state) => ({
        sharing: {
          ...state.sharing,
          activeTransfers: state.sharing.activeTransfers.map(t => 
            t.id === transferId ? { ...t, ...updates } : t
          ),
        },
      })),
      removeActiveTransfer: (transferId) => set((state) => ({
        sharing: {
          ...state.sharing,
          activeTransfers: state.sharing.activeTransfers.filter(t => t.id !== transferId),
        },
      })),
      addConnectedPeer: (peerId) => set((state) => ({
        sharing: {
          ...state.sharing,
          connectedPeers: [...state.sharing.connectedPeers, peerId],
        },
      })),
      removeConnectedPeer: (peerId) => set((state) => ({
        sharing: {
          ...state.sharing,
          connectedPeers: state.sharing.connectedPeers.filter(id => id !== peerId),
        },
      })),
      
      // Settings panel
      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      
      // Preview panel (V43)
      previewOpen: false,
      setPreviewOpen: (previewOpen) => set({ previewOpen }),
      
      // History panel (V43)
      historyOpen: false,
      setHistoryOpen: (historyOpen) => set({ historyOpen }),
      
      // Helpers
      getCompressionSettings: () => {
        const state = get();
        return {
          mode: state.compressionMode,
          chunkSize: state.chunkSize,
          enableDedup: state.enableDedup,
          enableEncryption: state.enableEncryption,
        };
      },
      isProcessing: () => {
        const status = get().operationStatus;
        return status === 'initializing' || status === 'preparing' || status === 'processing' || status === 'finalizing';
      },
      getProgressPercent: () => {
        const { bytesProcessed, totalBytes } = get().progress;
        return totalBytes > 0 ? (bytesProcessed / totalBytes) * 100 : 0;
      },
    }),
    {
      name: 'spk-v43-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        compressionMode: state.compressionMode,
        chunkSize: state.chunkSize,
        enableDedup: state.enableDedup,
        enableEncryption: state.enableEncryption,
        autoDownload: state.autoDownload,
        showAdvanced: state.showAdvanced,
        securitySettings: state.securitySettings,
        recentArchives: state.recentArchives,
        history: state.history,
      }),
    }
  )
);

// Apply theme to document
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark = 
    theme === 'dark' || 
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  
  localStorage.setItem('spk-theme', theme);
}

// Initialize theme on load
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('spk-theme') as Theme | null;
  applyTheme(stored || 'system');
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = useAppStore.getState().theme;
    if (current === 'system') {
      applyTheme('system');
    }
  });
}

// ============================================================================
// Selectors (for optimized re-renders)
// ============================================================================

export const selectTheme = (state: AppState) => state.theme;
export const selectCompressionMode = (state: AppState) => state.compressionMode;
export const selectOperationStatus = (state: AppState) => state.operationStatus;
export const selectProgress = (state: AppState) => state.progress;
export const selectLaneProgress = (state: AppState) => state.laneProgress;
export const selectResult = (state: AppState) => state.result;
export const selectError = (state: AppState) => state.error;
export const selectWasmReady = (state: AppState) => state.wasmReady;
export const selectRecentArchives = (state: AppState) => state.recentArchives;
export const selectHistory = (state: AppState) => state.history;
export const selectSharing = (state: AppState) => state.sharing;
export const selectSecuritySettings = (state: AppState) => state.securitySettings;
export const selectSelectedFiles = (state: AppState) => state.selectedFiles;
export const selectIsProcessing = (state: AppState) => 
  state.operationStatus === 'preparing' || 
  state.operationStatus === 'processing' || 
  state.operationStatus === 'finalizing';
export const selectProgressPercent = (state: AppState) => 
  state.progress.totalBytes > 0 
    ? (state.progress.bytesProcessed / state.progress.totalBytes) * 100 
    : 0;
export const selectThroughputPercent = (state: AppState) =>
  state.laneProgress?.throughputPercent ?? 0;
