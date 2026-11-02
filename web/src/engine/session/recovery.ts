/**
 * SPK V38 - Resumable Compression + Recovery
 * 
 * Provides resume support:
 * - Store job session metadata (processed chunks, offsets)
 * - If job interrupted, resume without recompressing completed chunks
 * - Worker + Coordinator restore state on reload
 * - UI shows "resume last job" when available
 */

// ============================================================================
// TYPES
// ============================================================================

export interface SessionChunk {
  index: number;
  offset: number;
  originalSize: number;
  compressedSize: number;
  checksum: number;
  hash: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface SessionMetadata {
  id: string;
  version: number;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileLastModified: number;
  chunkSize: number;
  totalChunks: number;
  mode: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'paused' | 'failed' | 'cancelled';
  chunks: SessionChunk[];
  partialArchive: ArrayBuffer | null;
  error?: string;
}

export interface ResumeInfo {
  canResume: boolean;
  session: SessionMetadata | null;
  completedChunks: number;
  remainingChunks: number;
  estimatedSavedTime: number;
}

export interface RecoveryOptions {
  storageKey: string;
  maxSessions: number;
  autoSaveInterval: number;
  retainDays: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPTIONS: RecoveryOptions = {
  storageKey: 'spk_sessions',
  maxSessions: 5,
  autoSaveInterval: 5000, // 5 seconds
  retainDays: 7,
};

const SESSION_VERSION = 1;

// ============================================================================
// SESSION STORAGE
// ============================================================================

class SessionStorage {
  private options: RecoveryOptions;
  private db: IDBDatabase | null = null;
  private dbReady: Promise<void>;
  
  constructor(options: Partial<RecoveryOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.dbReady = this.initDB();
  }
  
  /**
   * Initialize IndexedDB
   */
  private initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('spk_sessions_db', 1);
      
      request.onerror = () => {
        console.error('Failed to open session database');
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Sessions store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('status', 'status', { unique: false });
          sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        
        // Chunk data store (for large partial archives)
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks', { keyPath: 'key' });
        }
      };
    });
  }
  
  /**
   * Save session metadata
   */
  async saveSession(session: SessionMetadata): Promise<void> {
    await this.dbReady;
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      
      // Don't store large binary data in metadata
      const sessionCopy = { ...session, partialArchive: null };
      
      const request = store.put(sessionCopy);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Get session by ID
   */
  async getSession(id: string): Promise<SessionMetadata | null> {
    await this.dbReady;
    if (!this.db) return null;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.get(id);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Get all active/paused sessions
   */
  async getResumableSessions(): Promise<SessionMetadata[]> {
    await this.dbReady;
    if (!this.db) return [];
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();
      
      request.onsuccess = () => {
        const sessions = request.result as SessionMetadata[];
        // Filter to resumable and not expired
        const cutoff = Date.now() - this.options.retainDays * 24 * 60 * 60 * 1000;
        const resumable = sessions.filter(
          s => (s.status === 'paused' || s.status === 'active') && s.updatedAt > cutoff
        );
        resolve(resumable);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Delete session
   */
  async deleteSession(id: string): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessions', 'chunks'], 'readwrite');
      
      // Delete session
      const sessionStore = transaction.objectStore('sessions');
      sessionStore.delete(id);
      
      // Delete associated chunks
      const chunkStore = transaction.objectStore('chunks');
      const range = IDBKeyRange.bound(`${id}_`, `${id}_\uffff`);
      chunkStore.delete(range);
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  
  /**
   * Save partial archive data
   */
  async saveChunkData(sessionId: string, chunkIndex: number, data: ArrayBuffer): Promise<void> {
    await this.dbReady;
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chunks'], 'readwrite');
      const store = transaction.objectStore('chunks');
      
      const request = store.put({
        key: `${sessionId}_${chunkIndex}`,
        data,
      });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Get chunk data
   */
  async getChunkData(sessionId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
    await this.dbReady;
    if (!this.db) return null;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chunks'], 'readonly');
      const store = transaction.objectStore('chunks');
      const request = store.get(`${sessionId}_${chunkIndex}`);
      
      request.onsuccess = () => {
        resolve(request.result?.data || null);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Get all chunk data for session
   */
  async getAllChunkData(sessionId: string): Promise<Map<number, ArrayBuffer>> {
    await this.dbReady;
    if (!this.db) return new Map();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chunks'], 'readonly');
      const store = transaction.objectStore('chunks');
      const range = IDBKeyRange.bound(`${sessionId}_`, `${sessionId}_\uffff`);
      const request = store.getAll(range);
      
      request.onsuccess = () => {
        const results = new Map<number, ArrayBuffer>();
        for (const item of request.result) {
          const index = parseInt(item.key.split('_')[1], 10);
          results.set(index, item.data);
        }
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Cleanup old sessions
   */
  async cleanup(): Promise<number> {
    await this.dbReady;
    if (!this.db) return 0;
    
    const cutoff = Date.now() - this.options.retainDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();
      
      request.onsuccess = async () => {
        const sessions = request.result as SessionMetadata[];
        const toDelete = sessions.filter(s => s.updatedAt < cutoff);
        
        for (const session of toDelete) {
          await this.deleteSession(session.id);
          deleted++;
        }
        
        resolve(deleted);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// ============================================================================
// SESSION MANAGER
// ============================================================================

export class SessionManager {
  private storage: SessionStorage;
  private activeSession: SessionMetadata | null = null;
  private autoSaveTimer: number | null = null;
  private options: RecoveryOptions;
  
  constructor(options: Partial<RecoveryOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.storage = new SessionStorage(options);
  }
  
  /**
   * Create new session
   */
  async createSession(
    file: File,
    chunkSize: number,
    mode: string
  ): Promise<SessionMetadata> {
    const totalChunks = Math.ceil(file.size / chunkSize);
    
    const session: SessionMetadata = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      version: SESSION_VERSION,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      fileLastModified: file.lastModified,
      chunkSize,
      totalChunks,
      mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'active',
      chunks: Array.from({ length: totalChunks }, (_, i) => ({
        index: i,
        offset: i * chunkSize,
        originalSize: Math.min(chunkSize, file.size - i * chunkSize),
        compressedSize: 0,
        checksum: 0,
        hash: '',
        status: 'pending',
      })),
      partialArchive: null,
    };
    
    await this.storage.saveSession(session);
    this.activeSession = session;
    this.startAutoSave();
    
    return session;
  }
  
  /**
   * Update chunk status
   */
  async updateChunk(
    index: number,
    compressedData: ArrayBuffer,
    checksum: number,
    hash: string
  ): Promise<void> {
    if (!this.activeSession) {
      throw new Error('No active session');
    }
    
    const chunk = this.activeSession.chunks[index];
    if (chunk) {
      chunk.compressedSize = compressedData.byteLength;
      chunk.checksum = checksum;
      chunk.hash = hash;
      chunk.status = 'completed';
      
      this.activeSession.updatedAt = Date.now();
      
      // Store compressed data
      await this.storage.saveChunkData(this.activeSession.id, index, compressedData);
    }
  }
  
  /**
   * Mark chunk as failed
   */
  async markChunkFailed(index: number): Promise<void> {
    if (!this.activeSession) return;
    
    const chunk = this.activeSession.chunks[index];
    if (chunk) {
      chunk.status = 'failed';
      this.activeSession.updatedAt = Date.now();
    }
  }
  
  /**
   * Pause session
   */
  async pauseSession(): Promise<void> {
    if (!this.activeSession) return;
    
    this.activeSession.status = 'paused';
    this.activeSession.updatedAt = Date.now();
    await this.storage.saveSession(this.activeSession);
    this.stopAutoSave();
  }
  
  /**
   * Complete session
   */
  async completeSession(): Promise<void> {
    if (!this.activeSession) return;
    
    this.activeSession.status = 'completed';
    this.activeSession.updatedAt = Date.now();
    await this.storage.saveSession(this.activeSession);
    this.stopAutoSave();
    this.activeSession = null;
  }
  
  /**
   * Cancel session
   */
  async cancelSession(): Promise<void> {
    if (!this.activeSession) return;
    
    this.activeSession.status = 'cancelled';
    this.activeSession.updatedAt = Date.now();
    await this.storage.saveSession(this.activeSession);
    this.stopAutoSave();
    this.activeSession = null;
  }
  
  /**
   * Fail session with error
   */
  async failSession(error: string): Promise<void> {
    if (!this.activeSession) return;
    
    this.activeSession.status = 'failed';
    this.activeSession.error = error;
    this.activeSession.updatedAt = Date.now();
    await this.storage.saveSession(this.activeSession);
    this.stopAutoSave();
  }
  
  /**
   * Get resume info for a file
   */
  async getResumeInfo(file: File): Promise<ResumeInfo> {
    const sessions = await this.storage.getResumableSessions();
    
    // Find matching session
    const matching = sessions.find(
      s => s.fileName === file.name &&
           s.fileSize === file.size &&
           s.fileLastModified === file.lastModified
    );
    
    if (!matching) {
      return {
        canResume: false,
        session: null,
        completedChunks: 0,
        remainingChunks: 0,
        estimatedSavedTime: 0,
      };
    }
    
    const completedChunks = matching.chunks.filter(c => c.status === 'completed').length;
    const remainingChunks = matching.totalChunks - completedChunks;
    
    // Estimate saved time based on average chunk time
    const completedSize = matching.chunks
      .filter(c => c.status === 'completed')
      .reduce((s, c) => s + c.originalSize, 0);
    const avgSpeed = completedSize / ((matching.updatedAt - matching.createdAt) / 1000);
    const estimatedSavedTime = avgSpeed > 0 ? completedSize / avgSpeed : 0;
    
    return {
      canResume: true,
      session: matching,
      completedChunks,
      remainingChunks,
      estimatedSavedTime,
    };
  }
  
  /**
   * Resume a session
   */
  async resumeSession(sessionId: string): Promise<{
    session: SessionMetadata;
    completedChunks: Map<number, ArrayBuffer>;
  }> {
    const session = await this.storage.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Get all completed chunk data
    const completedChunks = await this.storage.getAllChunkData(sessionId);
    
    // Update session status
    session.status = 'active';
    session.updatedAt = Date.now();
    await this.storage.saveSession(session);
    
    this.activeSession = session;
    this.startAutoSave();
    
    return { session, completedChunks };
  }
  
  /**
   * Get pending chunk indices
   */
  getPendingChunks(): number[] {
    if (!this.activeSession) return [];
    
    return this.activeSession.chunks
      .filter(c => c.status === 'pending')
      .map(c => c.index);
  }
  
  /**
   * Get session progress
   */
  getProgress(): { completed: number; total: number; percentage: number } {
    if (!this.activeSession) {
      return { completed: 0, total: 0, percentage: 0 };
    }
    
    const completed = this.activeSession.chunks.filter(c => c.status === 'completed').length;
    const total = this.activeSession.totalChunks;
    
    return {
      completed,
      total,
      percentage: total > 0 ? (completed / total) * 100 : 0,
    };
  }
  
  /**
   * Get current session
   */
  getCurrentSession(): SessionMetadata | null {
    return this.activeSession;
  }
  
  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) return;
    
    this.autoSaveTimer = window.setInterval(async () => {
      if (this.activeSession) {
        await this.storage.saveSession(this.activeSession);
      }
    }, this.options.autoSaveInterval);
  }
  
  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
  
  /**
   * Cleanup old sessions
   */
  async cleanup(): Promise<number> {
    return this.storage.cleanup();
  }
  
  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.deleteSession(sessionId);
    if (this.activeSession?.id === sessionId) {
      this.activeSession = null;
      this.stopAutoSave();
    }
  }
  
  /**
   * Get all resumable sessions
   */
  async getResumableSessions(): Promise<SessionMetadata[]> {
    return this.storage.getResumableSessions();
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let sessionManager: SessionManager | null = null;

export function getSessionManager(options?: Partial<RecoveryOptions>): SessionManager {
  if (!sessionManager || options) {
    sessionManager = new SessionManager(options);
  }
  return sessionManager;
}

export function resetSessionManager(): void {
  sessionManager = null;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export async function canResumeFile(file: File): Promise<boolean> {
  const manager = getSessionManager();
  const info = await manager.getResumeInfo(file);
  return info.canResume;
}

export async function getResumeSessions(): Promise<SessionMetadata[]> {
  const manager = getSessionManager();
  return manager.getResumableSessions();
}
