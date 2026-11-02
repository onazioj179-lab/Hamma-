/**
 * SPK V26 - Account Store (Zustand)
 * Wallet-style account management with HAMMA integration
 * Real API integration - Production Ready
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { API_BASE } from '../config';

// ============================================================================
// Types
// ============================================================================

export type StorageTier = 'free' | 'basic' | 'pro' | 'enterprise';
export type FileType = 'document' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'data' | 'binary' | 'unknown';
export type FileStatus = 'active' | 'processing' | 'archived' | 'transferring' | 'deleted' | 'error';

// Account info
export interface AccountInfo {
  accountId: string;
  displayName: string;
  tier: StorageTier;
  storageUsed: number;
  storageQuota: number;
  fileCount: number;
  archiveCount: number;
  createdAt: number;
  lastActive: number;
}

// Catalog file entry
export interface CatalogFile {
  serial: string;
  filename: string;
  extension: string;
  fileType: FileType;
  label: string | null;
  tags: string[];
  description: string | null;
  status: FileStatus;
  size: number;
  compressedSize: number | null;
  compressionRatio: number | null;
  contentHash: string;
  storagePath: string;
  createdAt: number;
  modifiedAt: number;
  accessedAt: number;
}

// HAMMA preferences
export interface HammaPreferences {
  speedMode: 'fast' | 'balanced' | 'max' | 'auto';
  codec: 'zstd' | 'lz4' | 'brotli';
  enableDedup: boolean;
  enableDelta: boolean;
  enableDictionary: boolean;
  autoOrganize: boolean;
  autoLabel: boolean;
}

// Storage statistics
export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  compressedSize: number;
  savings: number;
  compressionRatio: number;
  byType: Record<string, number>;
}

// Account state
interface AccountState {
  // Auth state
  isLoggedIn: boolean;
  isLoading: boolean;
  
  // Account info
  account: AccountInfo | null;
  
  // Recovery phrase (only shown once on creation!)
  recoveryPhrase: string[] | null;
  recoveryPhraseShown: boolean;
  
  // HAMMA preferences
  hammaPrefs: HammaPreferences;
  
  // Catalog
  files: CatalogFile[];
  selectedFiles: string[]; // serials
  
  // Storage stats
  stats: StorageStats;
  
  // UI state
  showCreateAccount: boolean;
  showLogin: boolean;
  showRecoveryPhrase: boolean;
  showRecoverAccount: boolean;
  showFileManager: boolean;
  
  // Actions - Auth
  createAccount: (displayName: string, password: string) => Promise<{ success: boolean; phrase?: string[]; error?: string }>;
  login: (accountId: string, password: string) => Promise<{ success: boolean; error?: string }>;
  quickDemoLogin: () => void;
  logout: () => void;
  recoverAccount: (phrase: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  
  // Actions - Recovery phrase
  showRecoveryPhraseOnce: () => void;
  confirmRecoveryPhraseSaved: () => void;
  
  // Actions - HAMMA preferences
  setHammaPrefs: (prefs: Partial<HammaPreferences>) => void;
  
  // Actions - Files
  addFile: (file: CatalogFile) => void;
  updateFile: (serial: string, updates: Partial<CatalogFile>) => void;
  deleteFile: (serial: string) => void;
  selectFile: (serial: string) => void;
  deselectFile: (serial: string) => void;
  clearSelection: () => void;
  
  // Actions - Tags & Labels
  addTag: (serial: string, tag: string) => void;
  removeTag: (serial: string, tag: string) => void;
  setLabel: (serial: string, label: string) => void;
  
  // Actions - Search & Filter
  searchFiles: (query: string) => CatalogFile[];
  filterByType: (type: FileType) => CatalogFile[];
  filterByTag: (tag: string) => CatalogFile[];
  
  // Actions - UI
  setShowCreateAccount: (show: boolean) => void;
  setShowLogin: (show: boolean) => void;
  setShowRecoverAccount: (show: boolean) => void;
  setShowFileManager: (show: boolean) => void;
  
  // Helpers
  getStoragePercent: () => number;
  canStore: (bytes: number) => boolean;
  getAllTags: () => string[];
  
  // Internal - File loading
  loadFiles: () => Promise<void>;
}

// Default HAMMA preferences
const defaultHammaPrefs: HammaPreferences = {
  speedMode: 'auto',
  codec: 'zstd',
  enableDedup: true,
  enableDelta: true,
  enableDictionary: true,
  autoOrganize: true,
  autoLabel: true,
};

// Default stats
const defaultStats: StorageStats = {
  totalFiles: 0,
  totalSize: 0,
  compressedSize: 0,
  savings: 0,
  compressionRatio: 1,
  byType: {},
};

// Storage tier quotas (bytes)
const TIER_QUOTAS: Record<StorageTier, number> = {
  free: 10 * 1024 * 1024 * 1024,      // 10GB
  basic: 50 * 1024 * 1024 * 1024,     // 50GB
  pro: 100 * 1024 * 1024 * 1024,      // 100GB
  enterprise: Number.MAX_SAFE_INTEGER, // Unlimited
};

// API base URL - connects to backend server

// Format bytes for display
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.max(0, Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k))));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Generate serial number
function generateSerial(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `SPK-${date}-${rand}`;
}

// Detect file type
function detectFileType(filename: string): FileType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  const types: Record<string, FileType> = {
    // Documents
    pdf: 'document', doc: 'document', docx: 'document', txt: 'document',
    rtf: 'document', odt: 'document', xls: 'document', xlsx: 'document',
    ppt: 'document', pptx: 'document', csv: 'document',
    
    // Images
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
    bmp: 'image', svg: 'image', webp: 'image', ico: 'image',
    tiff: 'image', raw: 'image',
    
    // Video
    mp4: 'video', avi: 'video', mkv: 'video', mov: 'video',
    wmv: 'video', flv: 'video', webm: 'video', m4v: 'video',
    
    // Audio
    mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio',
    ogg: 'audio', wma: 'audio', m4a: 'audio',
    
    // Archives
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
    gz: 'archive', bz2: 'archive', xz: 'archive', spk: 'archive',
    
    // Code
    js: 'code', ts: 'code', py: 'code', java: 'code',
    cpp: 'code', c: 'code', h: 'code', rs: 'code',
    go: 'code', rb: 'code', php: 'code', html: 'code',
    css: 'code', json: 'code', xml: 'code', yaml: 'code',
    
    // Data
    sql: 'data', db: 'data', sqlite: 'data', mdb: 'data',
    
    // Binary
    exe: 'binary', dll: 'binary', so: 'binary', dylib: 'binary',
    bin: 'binary', dat: 'binary',
  };
  
  return types[ext] || 'unknown';
}

// Calculate storage stats from files
function calculateStats(files: CatalogFile[]): StorageStats {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const compressedSize = files.reduce((sum, f) => sum + (f.compressedSize ?? f.size), 0);
  
  const byType: Record<string, number> = {};
  files.forEach((f) => {
    byType[f.fileType] = (byType[f.fileType] || 0) + 1;
  });
  
  return {
    totalFiles: files.length,
    totalSize,
    compressedSize,
    savings: totalSize - compressedSize,
    compressionRatio: compressedSize > 0 ? totalSize / compressedSize : 1,
    byType,
  };
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      // Initial state
      isLoggedIn: false,
      isLoading: false,
      account: null,
      recoveryPhrase: null,
      recoveryPhraseShown: false,
      hammaPrefs: defaultHammaPrefs,
      files: [],
      selectedFiles: [],
      stats: defaultStats,
      showCreateAccount: false,
      showLogin: false,
      showRecoveryPhrase: false,
      showRecoverAccount: false,
      showFileManager: false,
      
      // ========================================================================
      // Auth Actions - Real API
      // ========================================================================
      
      createAccount: async (displayName, password) => {
        set({ isLoading: true });
        
        try {
          const response = await fetch(`${API_BASE}/account/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name: displayName, password }),
          });
          
          const data = await response.json();
          
          if (!data.success) {
            set({ isLoading: false });
            return { success: false, error: data.error || 'Failed to create account' };
          }
          
          set({
            isLoggedIn: true,
            isLoading: false,
            account: {
              accountId: data.account_id,
              displayName: data.display_name,
              tier: (data.tier || 'free') as StorageTier,
              storageUsed: 0,
              storageQuota: TIER_QUOTAS[(data.tier || 'free') as StorageTier],
              fileCount: 0,
              archiveCount: 0,
              createdAt: Date.now(),
              lastActive: Date.now(),
            },
            recoveryPhrase: data.recovery_phrase,
            recoveryPhraseShown: false,
            files: [],
            selectedFiles: [],
            stats: defaultStats,
            showCreateAccount: false,
            showRecoveryPhrase: true,
          });
          
          return { success: true, phrase: data.recovery_phrase };
        } catch (error) {
          set({ isLoading: false });
          return { success: false, error: 'Connection failed. Make sure the backend server is running on port 3000.' };
        }
      },
      
      login: async (accountId, password) => {
        set({ isLoading: true });
        
        try {
          const response = await fetch(`${API_BASE}/account/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id: accountId, password }),
          });
          
          const data = await response.json();
          
          if (!data.success) {
            set({ isLoading: false });
            return { success: false, error: data.error || 'Invalid credentials' };
          }
          
          set({
            isLoggedIn: true,
            isLoading: false,
            account: {
              accountId: data.account_id,
              displayName: data.display_name,
              tier: (data.tier || 'free') as StorageTier,
              storageUsed: data.storage_used || 0,
              storageQuota: data.storage_quota ?? TIER_QUOTAS[(data.tier || 'free') as StorageTier],
              fileCount: data.file_count || 0,
              archiveCount: data.archive_count || 0,
              createdAt: data.created_at ? data.created_at * 1000 : Date.now(),
              lastActive: Date.now(),
            },
            showLogin: false,
            ...(get().account?.accountId !== data.account_id ? { files: [], selectedFiles: [], stats: defaultStats } : {}),
          });
          
          // Load files for this account
          get().loadFiles();
          
          return { success: true };
        } catch (error) {
          set({ isLoading: false });
          return { success: false, error: 'Connection failed. Make sure the backend server is running on port 3000.' };
        }
      },
      
      // Quick login for testing - uses persisted account data
      quickDemoLogin: () => {
        // Persisted account metadata does not establish an authenticated session.
        set({ showLogin: true });
      },
      
      logout: () => {
        set({
          isLoggedIn: false,
          isLoading: false,
          account: null,
          recoveryPhrase: null,
          showRecoveryPhrase: false,
          recoveryPhraseShown: false,
          files: [],
          selectedFiles: [],
          stats: defaultStats,
        });
      },
      
      recoverAccount: async (phrase, newPassword) => {
        set({ isLoading: true });
        
        try {
          const response = await fetch(`${API_BASE}/account/recover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recovery_phrase: phrase, new_password: newPassword }),
          });
          
          const data = await response.json();
          
          if (!data.success) {
            set({ isLoading: false });
            return { success: false, error: data.error || 'Invalid recovery phrase' };
          }
          
          set({
            isLoggedIn: true,
            isLoading: false,
            account: {
              accountId: data.account_id,
              displayName: data.display_name,
              tier: (data.tier || 'free') as StorageTier,
              storageUsed: data.storage_used || 0,
              storageQuota: data.storage_quota ?? TIER_QUOTAS[(data.tier || 'free') as StorageTier],
              fileCount: data.file_count || 0,
              archiveCount: data.archive_count || 0,
              createdAt: data.created_at ? data.created_at * 1000 : Date.now(),
              lastActive: Date.now(),
            },
            showRecoverAccount: false,
            ...(get().account?.accountId !== data.account_id ? { files: [], selectedFiles: [], stats: defaultStats } : {}),
          });
          
          return { success: true };
        } catch (error) {
          set({ isLoading: false });
          return { success: false, error: 'Connection failed. Make sure the backend server is running.' };
        }
      },
      
      changePassword: async (_oldPassword, _newPassword) => {
        // TODO: Implement password change API
        return { success: false, error: 'Not implemented yet' };
      },
      
      // ========================================================================
      // Recovery Phrase Actions
      // ========================================================================
      
      showRecoveryPhraseOnce: () => {
        if (!get().recoveryPhraseShown) {
          set({ showRecoveryPhrase: true });
        }
      },
      
      confirmRecoveryPhraseSaved: () => {
        set({
          recoveryPhraseShown: true,
          showRecoveryPhrase: false,
          recoveryPhrase: null, // Clear phrase after confirmation
        });
      },
      
      // ========================================================================
      // HAMMA Preferences
      // ========================================================================
      
      setHammaPrefs: (prefs) => {
        set((state) => ({
          hammaPrefs: { ...state.hammaPrefs, ...prefs },
        }));
      },
      
      // ========================================================================
      // File Actions
      // ========================================================================
      
      addFile: (file) => {
        set((state) => {
          const newFiles = [...state.files, file];
          const newStats = calculateStats(newFiles);
          return { 
            files: newFiles,
            stats: newStats,
          };
        });
      },
      
      updateFile: (serial, updates) => {
        set((state) => {
          const newFiles = state.files.map((f) =>
            f.serial === serial ? { ...f, ...updates, modifiedAt: Date.now() } : f
          );
          const newStats = calculateStats(newFiles);
          return { 
            files: newFiles,
            stats: newStats,
          };
        });
      },
      
      deleteFile: (serial) => {
        set((state) => {
          const newFiles = state.files.filter((f) => f.serial !== serial);
          const newStats = calculateStats(newFiles);
          return {
            files: newFiles,
            selectedFiles: state.selectedFiles.filter((s) => s !== serial),
            stats: newStats,
          };
        });
      },
      
      selectFile: (serial) => {
        set((state) => ({
          selectedFiles: state.selectedFiles.includes(serial)
            ? state.selectedFiles
            : [...state.selectedFiles, serial],
        }));
      },
      
      deselectFile: (serial) => {
        set((state) => ({
          selectedFiles: state.selectedFiles.filter((s) => s !== serial),
        }));
      },
      
      clearSelection: () => {
        set({ selectedFiles: [] });
      },
      
      // ========================================================================
      // Tags & Labels
      // ========================================================================
      
      addTag: (serial, tag) => {
        set((state) => ({
          files: state.files.map((f) =>
            f.serial === serial && !f.tags.includes(tag)
              ? { ...f, tags: [...f.tags, tag] }
              : f
          ),
        }));
      },
      
      removeTag: (serial, tag) => {
        set((state) => ({
          files: state.files.map((f) =>
            f.serial === serial
              ? { ...f, tags: f.tags.filter((t) => t !== tag) }
              : f
          ),
        }));
      },
      
      setLabel: (serial, label) => {
        set((state) => ({
          files: state.files.map((f) =>
            f.serial === serial ? { ...f, label } : f
          ),
        }));
      },
      
      // ========================================================================
      // Search & Filter
      // ========================================================================
      
      searchFiles: (query) => {
        const q = query.toLowerCase();
        return get().files.filter(
          (f) =>
            f.filename.toLowerCase().includes(q) ||
            f.serial.toLowerCase().includes(q) ||
            f.label?.toLowerCase().includes(q) ||
            f.tags.some((t) => t.toLowerCase().includes(q))
        );
      },
      
      filterByType: (type) => {
        return get().files.filter((f) => f.fileType === type);
      },
      
      filterByTag: (tag) => {
        return get().files.filter((f) => f.tags.includes(tag));
      },
      
      // ========================================================================
      // UI Actions
      // ========================================================================
      
      setShowCreateAccount: (show) => set({ showCreateAccount: show }),
      setShowLogin: (show) => set({ showLogin: show }),
      setShowRecoverAccount: (show) => set({ showRecoverAccount: show }),
      setShowFileManager: (show) => set({ showFileManager: show }),
      
      // ========================================================================
      // Helpers
      // ========================================================================
      
      getStoragePercent: () => {
        const { account } = get();
        if (!account) return 0;
        return Math.min((account.storageUsed / account.storageQuota) * 100, 100);
      },
      
      canStore: (bytes) => {
        if (!Number.isSafeInteger(bytes) || bytes < 0) return false;
        const { account } = get();
        if (!account) return false;
        return account.storageUsed + bytes <= account.storageQuota;
      },
      
      getAllTags: () => {
        const tags = new Set<string>();
        get().files.forEach((f) => f.tags.forEach((t) => tags.add(t)));
        return Array.from(tags).sort();
      },
      
      // ========================================================================
      // File Loading
      // ========================================================================
      
      loadFiles: async () => {
        // TODO: Load files from backend API
        // For now, files are stored locally via persist
      },
    }),
    {
      name: 'spk-account-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Persist these values
        account: state.account,
        hammaPrefs: state.hammaPrefs,
        files: state.files,
        stats: state.stats,
        // Don't persist auth state - require re-login for security
      }),
    }
  )
);
