/**
 * SPK Connection-Aware Streaming
 * 
 * Adapts compression and transmission based on network conditions.
 * Essential for mobile devices on cellular networks.
 * 
 * Features:
 * - Network condition detection
 * - Adaptive chunk sizing
 * - Progressive upload with resumption
 * - Offline queue support
 * - Data saver mode compliance
 * 
 * @module engine/connection-streaming
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export type ConnectionType = '4g' | '3g' | '2g' | 'slow-2g' | 'wifi' | 'ethernet' | 'unknown';
export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'offline';

export interface NetworkInfo {
  /** Connection type (from Navigator.connection API) */
  type: ConnectionType;
  /** Effective connection type */
  effectiveType: ConnectionType;
  /** Downlink speed in Mbps */
  downlink: number;
  /** Round-trip time in ms */
  rtt: number;
  /** Is data saver enabled */
  saveData: boolean;
  /** Is device online */
  online: boolean;
  /** Computed quality level */
  quality: ConnectionQuality;
}

export interface StreamingConfig {
  /** Minimum chunk size (bytes) */
  minChunkSize: number;
  /** Maximum chunk size (bytes) */
  maxChunkSize: number;
  /** Target chunk upload time (ms) */
  targetChunkTime: number;
  /** Enable adaptive chunking */
  adaptiveChunking: boolean;
  /** Enable offline queue */
  enableOfflineQueue: boolean;
  /** Max offline queue size (bytes) */
  maxOfflineQueueSize: number;
  /** Retry count on failure */
  maxRetries: number;
  /** Base retry delay (ms) */
  retryDelay: number;
}

export interface ChunkUploadResult {
  success: boolean;
  chunkIndex: number;
  bytesSent: number;
  duration: number;
  retries: number;
  error?: string;
}

export interface StreamProgress {
  phase: 'queued' | 'uploading' | 'paused' | 'complete' | 'error';
  bytesUploaded: number;
  totalBytes: number;
  chunksUploaded: number;
  totalChunks: number;
  currentSpeed: number;
  averageSpeed: number;
  eta: number;
  quality: ConnectionQuality;
  isOffline: boolean;
}

export type StreamProgressCallback = (progress: StreamProgress) => void;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: StreamingConfig = {
  minChunkSize: 16 * 1024,       // 16KB minimum
  maxChunkSize: 4 * 1024 * 1024, // 4MB maximum
  targetChunkTime: 2000,         // 2 second target upload time
  adaptiveChunking: true,
  enableOfflineQueue: true,
  maxOfflineQueueSize: 50 * 1024 * 1024, // 50MB offline queue
  maxRetries: 3,
  retryDelay: 1000,
};

// Chunk sizes by connection quality
const CHUNK_SIZES: Record<ConnectionQuality, number> = {
  excellent: 4 * 1024 * 1024,  // 4MB
  good: 1 * 1024 * 1024,       // 1MB
  fair: 256 * 1024,            // 256KB
  poor: 64 * 1024,             // 64KB
  offline: 16 * 1024,          // 16KB (for queue)
};

// ============================================================================
// Network Monitor
// ============================================================================

class NetworkMonitor {
  private listeners: ((info: NetworkInfo) => void)[] = [];
  private currentInfo: NetworkInfo | null = null;
  private pollingInterval: number | null = null;

  constructor() {
    this.setupListeners();
  }

  /**
   * Get current network info
   */
  getInfo(): NetworkInfo {
    if (this.currentInfo) return this.currentInfo;
    return this.detectNetwork();
  }

  /**
   * Subscribe to network changes
   */
  onChange(callback: (info: NetworkInfo) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Start monitoring (for environments without events)
   */
  startPolling(interval = 5000): void {
    if (this.pollingInterval) return;
    this.pollingInterval = window.setInterval(() => {
      const info = this.detectNetwork();
      if (this.hasChanged(info)) {
        this.currentInfo = info;
        this.notifyListeners(info);
      }
    }, interval);
  }

  /**
   * Stop monitoring
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private setupListeners(): void {
    // Online/offline events
    window.addEventListener('online', () => this.handleChange());
    window.addEventListener('offline', () => this.handleChange());
    
    // Connection change event (if available)
    const connection = this.getConnection();
    if (connection) {
      connection.addEventListener('change', () => this.handleChange());
    }
  }

  private handleChange(): void {
    const info = this.detectNetwork();
    this.currentInfo = info;
    this.notifyListeners(info);
  }

  private notifyListeners(info: NetworkInfo): void {
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch (e) {
        console.warn('[NetworkMonitor] Listener error:', e);
      }
    }
  }

  private hasChanged(newInfo: NetworkInfo): boolean {
    if (!this.currentInfo) return true;
    return (
      this.currentInfo.online !== newInfo.online ||
      this.currentInfo.effectiveType !== newInfo.effectiveType ||
      Math.abs(this.currentInfo.downlink - newInfo.downlink) > 0.5
    );
  }

  private getConnection(): NetworkConnection | null {
    const nav = navigator as Navigator & {
      connection?: NetworkConnection;
      mozConnection?: NetworkConnection;
      webkitConnection?: NetworkConnection;
    };
    return nav.connection || nav.mozConnection || nav.webkitConnection || null;
  }

  private detectNetwork(): NetworkInfo {
    const connection = this.getConnection();
    const online = navigator.onLine;
    
    if (!online) {
      return {
        type: 'unknown',
        effectiveType: 'unknown',
        downlink: 0,
        rtt: 0,
        saveData: false,
        online: false,
        quality: 'offline',
      };
    }
    
    if (!connection) {
      // Assume good connection if API not available
      return {
        type: 'unknown',
        effectiveType: 'unknown',
        downlink: 10,
        rtt: 100,
        saveData: false,
        online: true,
        quality: 'good',
      };
    }
    
    const effectiveType = (connection.effectiveType || 'unknown') as ConnectionType;
    const downlink = connection.downlink || 0;
    const rtt = connection.rtt || 0;
    const saveData = connection.saveData || false;
    
    // Compute quality
    let quality: ConnectionQuality = 'good';
    if (effectiveType === 'slow-2g' || effectiveType === '2g' || downlink < 0.5) {
      quality = 'poor';
    } else if (effectiveType === '3g' || downlink < 2) {
      quality = 'fair';
    } else if (effectiveType === '4g' && downlink >= 5) {
      quality = 'excellent';
    }
    
    // Data saver mode forces fair quality at best
    if (saveData && quality === 'excellent') {
      quality = 'good';
    }
    
    return {
      type: (connection.type || 'unknown') as ConnectionType,
      effectiveType,
      downlink,
      rtt,
      saveData,
      online,
      quality,
    };
  }
}

// Type for Navigator.connection
interface NetworkConnection extends EventTarget {
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

// ============================================================================
// Offline Queue
// ============================================================================

interface QueuedChunk {
  id: string;
  data: Uint8Array;
  metadata: {
    filename: string;
    chunkIndex: number;
    totalChunks: number;
    timestamp: number;
  };
}

class OfflineQueue {
  private queue: QueuedChunk[] = [];
  private maxSize: number;
  private currentSize = 0;
  private storageKey = 'spk-offline-queue';

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.loadFromStorage();
  }

  /**
   * Add chunk to queue
   */
  enqueue(chunk: QueuedChunk): boolean {
    const chunkSize = chunk.data.length;
    
    if (this.currentSize + chunkSize > this.maxSize) {
      // Try to make room by removing oldest
      while (this.queue.length > 0 && this.currentSize + chunkSize > this.maxSize) {
        const removed = this.queue.shift();
        if (removed) {
          this.currentSize -= removed.data.length;
        }
      }
    }
    
    if (this.currentSize + chunkSize > this.maxSize) {
      return false; // Still not enough room
    }
    
    this.queue.push(chunk);
    this.currentSize += chunkSize;
    this.saveToStorage();
    return true;
  }

  /**
   * Get next chunk from queue
   */
  dequeue(): QueuedChunk | null {
    const chunk = this.queue.shift();
    if (chunk) {
      this.currentSize -= chunk.data.length;
      this.saveToStorage();
    }
    return chunk || null;
  }

  /**
   * Peek at next chunk without removing
   */
  peek(): QueuedChunk | null {
    return this.queue[0] || null;
  }

  /**
   * Get queue size
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Get total bytes in queue
   */
  get bytes(): number {
    return this.currentSize;
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
    this.currentSize = 0;
    this.clearStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        // Convert base64 back to Uint8Array
        this.queue = data.map((item: { id: string; data: string; metadata: QueuedChunk['metadata'] }) => ({
          id: item.id,
          data: this.base64ToUint8Array(item.data),
          metadata: item.metadata,
        }));
        this.currentSize = this.queue.reduce((sum, chunk) => sum + chunk.data.length, 0);
      }
    } catch (e) {
      console.warn('[OfflineQueue] Failed to load from storage:', e);
    }
  }

  private saveToStorage(): void {
    try {
      // Convert Uint8Array to base64 for storage
      const data = this.queue.map(chunk => ({
        id: chunk.id,
        data: this.uint8ArrayToBase64(chunk.data),
        metadata: chunk.metadata,
      }));
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn('[OfflineQueue] Failed to save to storage:', e);
    }
  }

  private clearStorage(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (e) {
      // Ignore
    }
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

// ============================================================================
// Connection-Aware Streamer
// ============================================================================

export class ConnectionStreamer {
  private config: StreamingConfig;
  private networkMonitor: NetworkMonitor;
  private offlineQueue: OfflineQueue;
  private progressCallback?: StreamProgressCallback;
  private aborted = false;
  
  // Adaptive state
  private currentChunkSize: number;
  private speedSamples: number[] = [];
  private uploadStartTime = 0;
  private bytesUploaded = 0;

  constructor(config: Partial<StreamingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.networkMonitor = new NetworkMonitor();
    this.offlineQueue = new OfflineQueue(this.config.maxOfflineQueueSize);
    this.currentChunkSize = this.config.maxChunkSize;
    
    // Listen for network changes
    this.networkMonitor.onChange((info) => this.handleNetworkChange(info));
  }

  /**
   * Set progress callback
   */
  onProgress(callback: StreamProgressCallback): this {
    this.progressCallback = callback;
    return this;
  }

  /**
   * Abort current operation
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Get current network info
   */
  getNetworkInfo(): NetworkInfo {
    return this.networkMonitor.getInfo();
  }

  /**
   * Get optimal chunk size for current conditions
   */
  getOptimalChunkSize(): number {
    if (!this.config.adaptiveChunking) {
      return this.config.maxChunkSize;
    }
    
    const network = this.networkMonitor.getInfo();
    let size = CHUNK_SIZES[network.quality];
    
    // Adjust based on measured speed
    if (this.speedSamples.length >= 3) {
      const avgSpeed = this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length;
      // Target chunk time = size / speed
      const targetSize = avgSpeed * (this.config.targetChunkTime / 1000);
      size = Math.min(size, targetSize);
    }
    
    // Apply bounds
    return Math.max(
      this.config.minChunkSize,
      Math.min(size, this.config.maxChunkSize)
    );
  }

  /**
   * Upload data with connection-awareness
   */
  async upload(
    data: Uint8Array,
    uploadFn: (chunk: Uint8Array, index: number, total: number) => Promise<boolean>,
    filename = 'data.spk'
  ): Promise<{ success: boolean; totalUploaded: number; error?: string }> {
    this.aborted = false;
    this.uploadStartTime = Date.now();
    this.bytesUploaded = 0;
    this.speedSamples = [];
    
    const network = this.networkMonitor.getInfo();
    
    // Handle offline start
    if (!network.online) {
      if (this.config.enableOfflineQueue) {
        return this.queueForOffline(data, filename);
      }
      return { success: false, totalUploaded: 0, error: 'Device is offline' };
    }
    
    // Calculate chunks
    this.currentChunkSize = this.getOptimalChunkSize();
    const totalChunks = Math.ceil(data.length / this.currentChunkSize);
    
    this.reportProgress({
      phase: 'uploading',
      bytesUploaded: 0,
      totalBytes: data.length,
      chunksUploaded: 0,
      totalChunks,
      currentSpeed: 0,
      averageSpeed: 0,
      eta: 0,
      quality: network.quality,
      isOffline: false,
    });
    
    // Upload chunks
    for (let i = 0; i < totalChunks; i++) {
      if (this.aborted) {
        return { success: false, totalUploaded: this.bytesUploaded, error: 'Aborted' };
      }
      
      // Check if we went offline
      const currentNetwork = this.networkMonitor.getInfo();
      if (!currentNetwork.online) {
        // Queue remaining data
        const remaining = data.slice(i * this.currentChunkSize);
        if (this.config.enableOfflineQueue) {
          this.queueForOffline(remaining, filename);
        }
        return { 
          success: false, 
          totalUploaded: this.bytesUploaded, 
          error: 'Connection lost, remaining data queued' 
        };
      }
      
      // Extract chunk
      const start = i * this.currentChunkSize;
      const end = Math.min(start + this.currentChunkSize, data.length);
      const chunk = data.slice(start, end);
      
      // Upload with retries
      const result = await this.uploadChunkWithRetry(chunk, i, totalChunks, uploadFn);
      
      if (!result.success) {
        return { 
          success: false, 
          totalUploaded: this.bytesUploaded, 
          error: result.error 
        };
      }
      
      this.bytesUploaded += chunk.length;
      
      // Update speed samples
      if (result.duration > 0) {
        const speed = chunk.length / (result.duration / 1000);
        this.speedSamples.push(speed);
        if (this.speedSamples.length > 10) {
          this.speedSamples.shift();
        }
      }
      
      // Adapt chunk size
      if (this.config.adaptiveChunking && i % 5 === 0) {
        this.currentChunkSize = this.getOptimalChunkSize();
      }
      
      // Report progress
      const avgSpeed = this.speedSamples.length > 0
        ? this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length
        : 0;
      const remaining = data.length - this.bytesUploaded;
      const eta = avgSpeed > 0 ? (remaining / avgSpeed) * 1000 : 0;
      
      this.reportProgress({
        phase: 'uploading',
        bytesUploaded: this.bytesUploaded,
        totalBytes: data.length,
        chunksUploaded: i + 1,
        totalChunks,
        currentSpeed: this.speedSamples[this.speedSamples.length - 1] || 0,
        averageSpeed: avgSpeed,
        eta,
        quality: currentNetwork.quality,
        isOffline: false,
      });
    }
    
    this.reportProgress({
      phase: 'complete',
      bytesUploaded: data.length,
      totalBytes: data.length,
      chunksUploaded: totalChunks,
      totalChunks,
      currentSpeed: 0,
      averageSpeed: this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length || 0,
      eta: 0,
      quality: network.quality,
      isOffline: false,
    });
    
    return { success: true, totalUploaded: data.length };
  }

  /**
   * Process offline queue when back online
   */
  async processOfflineQueue(
    uploadFn: (chunk: Uint8Array, index: number, total: number) => Promise<boolean>
  ): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    
    while (this.offlineQueue.size > 0) {
      const network = this.networkMonitor.getInfo();
      if (!network.online) {
        break;
      }
      
      const chunk = this.offlineQueue.dequeue();
      if (!chunk) break;
      
      try {
        const success = await uploadFn(
          chunk.data,
          chunk.metadata.chunkIndex,
          chunk.metadata.totalChunks
        );
        
        if (success) {
          processed++;
        } else {
          // Re-queue on failure
          this.offlineQueue.enqueue(chunk);
          failed++;
          break;
        }
      } catch {
        failed++;
        break;
      }
    }
    
    return { processed, failed };
  }

  /**
   * Get pending offline items count
   */
  getOfflineQueueSize(): { count: number; bytes: number } {
    return {
      count: this.offlineQueue.size,
      bytes: this.offlineQueue.bytes,
    };
  }

  /**
   * Clear offline queue
   */
  clearOfflineQueue(): void {
    this.offlineQueue.clear();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async uploadChunkWithRetry(
    chunk: Uint8Array,
    index: number,
    total: number,
    uploadFn: (chunk: Uint8Array, index: number, total: number) => Promise<boolean>
  ): Promise<ChunkUploadResult> {
    let retries = 0;
    let lastError: string | undefined;
    
    while (retries <= this.config.maxRetries) {
      const startTime = Date.now();
      
      try {
        const success = await uploadFn(chunk, index, total);
        
        if (success) {
          return {
            success: true,
            chunkIndex: index,
            bytesSent: chunk.length,
            duration: Date.now() - startTime,
            retries,
          };
        }
        
        lastError = 'Upload returned false';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      
      retries++;
      
      if (retries <= this.config.maxRetries) {
        // Wait before retry with exponential backoff
        await this.sleep(this.config.retryDelay * Math.pow(2, retries - 1));
      }
    }
    
    return {
      success: false,
      chunkIndex: index,
      bytesSent: 0,
      duration: 0,
      retries,
      error: lastError,
    };
  }

  private queueForOffline(
    data: Uint8Array,
    filename: string
  ): { success: boolean; totalUploaded: number; error?: string } {
    const chunkSize = 64 * 1024; // 64KB chunks for queue
    const totalChunks = Math.ceil(data.length / chunkSize);
    let queued = 0;
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      const chunk = data.slice(start, end);
      
      const success = this.offlineQueue.enqueue({
        id: `${filename}-${i}-${Date.now()}`,
        data: chunk,
        metadata: {
          filename,
          chunkIndex: i,
          totalChunks,
          timestamp: Date.now(),
        },
      });
      
      if (!success) {
        return {
          success: false,
          totalUploaded: queued,
          error: 'Offline queue full',
        };
      }
      
      queued += chunk.length;
    }
    
    this.reportProgress({
      phase: 'queued',
      bytesUploaded: 0,
      totalBytes: data.length,
      chunksUploaded: 0,
      totalChunks,
      currentSpeed: 0,
      averageSpeed: 0,
      eta: 0,
      quality: 'offline',
      isOffline: true,
    });
    
    return { success: true, totalUploaded: 0, error: 'Queued for offline upload' };
  }

  private handleNetworkChange(info: NetworkInfo): void {
    // Report network change through progress
    if (this.progressCallback) {
      this.reportProgress({
        phase: info.online ? 'uploading' : 'paused',
        bytesUploaded: this.bytesUploaded,
        totalBytes: 0,
        chunksUploaded: 0,
        totalChunks: 0,
        currentSpeed: 0,
        averageSpeed: 0,
        eta: 0,
        quality: info.quality,
        isOffline: !info.online,
      });
    }
    
    // Adapt chunk size immediately
    if (this.config.adaptiveChunking) {
      this.currentChunkSize = this.getOptimalChunkSize();
    }
  }

  private reportProgress(progress: StreamProgress): void {
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Global network monitor instance
 */
export const networkMonitor = new NetworkMonitor();

/**
 * Create connection-aware streamer
 */
export function createConnectionStreamer(
  config?: Partial<StreamingConfig>
): ConnectionStreamer {
  return new ConnectionStreamer(config);
}

/**
 * Get current network info
 */
export function getNetworkInfo(): NetworkInfo {
  return networkMonitor.getInfo();
}

/**
 * Check if device is online
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Get optimal upload chunk size for current conditions
 */
export function getOptimalUploadChunkSize(): number {
  const info = networkMonitor.getInfo();
  return CHUNK_SIZES[info.quality];
}

export default ConnectionStreamer;
