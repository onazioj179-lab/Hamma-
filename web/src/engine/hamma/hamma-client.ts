/**
 * HAMMA Client - TypeScript Integration
 * 
 * Client for communicating with the HAMMA AI acceleration engine.
 * Supports HTTP, WebSocket, and embedded modes.
 * 
 * Creator: Onazi Treasure (OJ)
 */

// ============================================================================
// Types
// ============================================================================

export interface ChunkMetadata {
  chunk_index: number;
  chunk_size: number;
  compressed_size?: number;
  entropy_score: number;
  redundancy_signature: string;
  histogram: number[];
}

export interface WorkerStats {
  worker_id: number;
  last_chunk_time_ms: number;
  avg_chunk_time_ms: number;
  chunks_processed: number;
  error_count: number;
  pass_success_rate: number;
}

export interface DeviceProfile {
  cpu_cores: number;
  ram_total_mb: number;
  ram_available_mb: number;
  ram_pressure: number;
  is_throttled: boolean;
  is_mobile: boolean;
  is_low_power: boolean;
}

export interface PartitionInfo {
  partition_index: number;
  total_partitions: number;
  partition_size_bytes: number;
  chunks_in_partition: number;
}

export interface HistoricalPerformance {
  avg_compression_ratio: number;
  avg_throughput_mbps: number;
  refinement_success_rate: number;
  total_chunks_processed: number;
  total_bytes_saved: number;
}

export interface PredictionRequest {
  chunk: ChunkMetadata;
  worker_stats?: WorkerStats;
  device_profile?: DeviceProfile;
  partition_info?: PartitionInfo;
  history?: HistoricalPerformance;
  batch_size?: number;
  batch_index?: number;
}

export interface MemoryTarget {
  chunk_size: number;
  concurrency: number;
}

export interface PredictionResponse {
  chunk_mode: 'fast' | 'strong' | 'auto' | 'skip-refine';
  refinement_level: 0 | 1 | 2;
  lane_boost: boolean;
  expected_ratio: number;
  stability_flag: 'safe' | 'warning' | 'critical';
  memory_target: MemoryTarget;
  anomaly_detected: boolean;
  confidence?: number;
  redundancy_cluster?: number | null;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime_seconds: number;
  requests_processed: number;
  avg_latency_ms: number;
  models_loaded: string[];
}

export interface HammaClientConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  useWebSocket: boolean;
}

// ============================================================================
// HAMMA Client
// ============================================================================

const DEFAULT_CONFIG: HammaClientConfig = {
  baseUrl: 'http://127.0.0.1:8765',
  timeout: 5000,
  retries: 2,
  useWebSocket: false,
};

export class HammaClient {
  private config: HammaClientConfig;
  private ws: WebSocket | null = null;
  private wsPromises: Map<number, {
    resolve: (value: PredictionResponse) => void;
    reject: (reason: Error) => void;
  }> = new Map();
  private wsMessageId = 0;
  private isConnected = false;
  
  constructor(config: Partial<HammaClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Get prediction for a single chunk
   */
  async predict(request: PredictionRequest): Promise<PredictionResponse> {
    if (this.config.useWebSocket && this.isConnected) {
      return this.predictWS(request);
    }
    return this.predictHTTP(request);
  }
  
  /**
   * Get predictions for multiple chunks
   */
  async predictBatch(
    chunks: ChunkMetadata[],
    context?: {
      worker_stats?: WorkerStats;
      device_profile?: DeviceProfile;
      partition_info?: PartitionInfo;
      history?: HistoricalPerformance;
    }
  ): Promise<PredictionResponse[]> {
    const response = await fetch(`${this.config.baseUrl}/predict/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunks,
        ...context,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    });
    
    if (!response.ok) {
      throw new Error(`HAMMA batch prediction failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.predictions;
  }
  
  /**
   * HTTP prediction
   */
  private async predictHTTP(request: PredictionRequest): Promise<PredictionResponse> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await fetch(`${this.config.baseUrl}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.config.timeout),
        });
        
        if (!response.ok) {
          throw new Error(`HAMMA prediction failed: ${response.status}`);
        }
        
        return await response.json();
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.config.retries) {
          // Wait before retry
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }
    
    throw lastError || new Error('HAMMA prediction failed');
  }
  
  /**
   * WebSocket prediction
   */
  private predictWS(request: PredictionRequest): Promise<PredictionResponse> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      const id = this.wsMessageId++;
      
      // Set timeout
      const timeout = setTimeout(() => {
        this.wsPromises.delete(id);
        reject(new Error('WebSocket prediction timeout'));
      }, this.config.timeout);
      
      this.wsPromises.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      
      this.ws.send(JSON.stringify({ ...request, _id: id }));
    });
  }
  
  /**
   * Connect WebSocket for real-time streaming
   */
  async connectWebSocket(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    
    const wsUrl = this.config.baseUrl.replace(/^http/, 'ws') + '/ws/predict';
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        this.isConnected = true;
        resolve();
      };
      
      this.ws.onerror = (error) => {
        this.isConnected = false;
        reject(new Error('WebSocket connection failed'));
      };
      
      this.ws.onclose = () => {
        this.isConnected = false;
      };
      
      this.ws.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          const id = response._id;
          
          if (id !== undefined && this.wsPromises.has(id)) {
            const { resolve } = this.wsPromises.get(id)!;
            this.wsPromises.delete(id);
            resolve(response);
          }
        } catch (error) {
          console.error('HAMMA WS message parse error:', error);
        }
      };
    });
  }
  
  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
  
  /**
   * Check HAMMA health
   */
  async checkHealth(): Promise<HealthResponse> {
    const response = await fetch(`${this.config.baseUrl}/health`, {
      signal: AbortSignal.timeout(this.config.timeout),
    });
    
    if (!response.ok) {
      throw new Error(`HAMMA health check failed: ${response.status}`);
    }
    
    return response.json();
  }
  
  /**
   * Check if HAMMA is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.checkHealth();
      return health.status !== 'unhealthy';
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let hammaClientInstance: HammaClient | null = null;

export function getHammaClient(): HammaClient {
  if (!hammaClientInstance) {
    hammaClientInstance = new HammaClient();
  }
  return hammaClientInstance;
}

export function configureHammaClient(config: Partial<HammaClientConfig>): void {
  hammaClientInstance = new HammaClient(config);
}

export function resetHammaClient(): void {
  if (hammaClientInstance) {
    hammaClientInstance.disconnectWebSocket();
  }
  hammaClientInstance = null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build chunk metadata from raw data
 */
export function buildChunkMetadata(
  data: Uint8Array,
  chunkIndex: number,
  redundancySignature: string,
): ChunkMetadata {
  // Calculate entropy
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) {
    histogram[data[i]]++;
  }
  
  let entropy = 0;
  const len = data.length;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > 0) {
      const p = histogram[i] / len;
      entropy -= p * Math.log2(p);
    }
  }
  
  return {
    chunk_index: chunkIndex,
    chunk_size: data.length,
    entropy_score: entropy,
    redundancy_signature: redundancySignature,
    histogram,
  };
}

/**
 * Get device profile
 */
export function getDeviceProfile(): DeviceProfile {
  const cores = navigator.hardwareConcurrency || 4;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  
  // Estimate memory (not directly available in browsers)
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  const ramTotal = memory ? memory * 1024 : 4096;
  const ramAvailable = ramTotal * 0.5; // Conservative estimate
  
  return {
    cpu_cores: cores,
    ram_total_mb: ramTotal,
    ram_available_mb: ramAvailable,
    ram_pressure: 0.5,
    is_throttled: false,
    is_mobile: isMobile,
    is_low_power: isMobile,
  };
}
