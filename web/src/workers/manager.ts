// SPK V24 - Worker Manager
// Manages communication with compression web worker

import type { ProgressEvent, CompressionMode } from '../wasm';

export interface OperationResult {
  originalSize: number;
  resultSize: number;
  ratio: number;
  duration: number;
  speedMbps: number;
  data: ArrayBuffer;
}

export interface OperationCallbacks {
  onProgress?: (progress: ProgressEvent) => void;
  onComplete?: (result: OperationResult) => void;
  onError?: (error: string) => void;
  onCancelled?: () => void;
}

class WorkerManager {
  private worker: Worker | null = null;
  private pendingOperations = new Map<string, OperationCallbacks>();
  private operationCounter = 0;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./compression.worker.ts', import.meta.url),
        { type: 'module' }
      );
      
      this.worker.onmessage = (e) => {
        const { id, type, progress, result, stats, error } = e.data;
        const callbacks = this.pendingOperations.get(id);
        
        if (!callbacks) return;
        
        switch (type) {
          case 'progress':
            callbacks.onProgress?.(progress);
            break;
          case 'complete':
            callbacks.onComplete?.({
              ...stats,
              data: result,
            });
            this.pendingOperations.delete(id);
            break;
          case 'error':
            callbacks.onError?.(error);
            this.pendingOperations.delete(id);
            break;
          case 'cancelled':
            callbacks.onCancelled?.();
            this.pendingOperations.delete(id);
            break;
        }
      };
      
      this.worker.onerror = (e) => {
        console.error('Worker error:', e);
        // Notify all pending operations
        this.pendingOperations.forEach((callbacks) => {
          callbacks.onError?.('Worker error occurred');
        });
        this.pendingOperations.clear();
      };
    }
    
    return this.worker;
  }

  private generateId(): string {
    return `op-${++this.operationCounter}-${Date.now()}`;
  }

  async compress(
    file: File,
    options: { mode: CompressionMode },
    callbacks: OperationCallbacks
  ): Promise<string> {
    const id = this.generateId();
    const worker = this.getWorker();
    
    this.pendingOperations.set(id, callbacks);
    
    const data = await file.arrayBuffer();
    
    worker.postMessage({
      id,
      type: 'compress',
      data,
      fileName: file.name,
      options,
    }, [data]);
    
    return id;
  }

  async decompress(
    file: File,
    callbacks: OperationCallbacks
  ): Promise<string> {
    const id = this.generateId();
    const worker = this.getWorker();
    
    this.pendingOperations.set(id, callbacks);
    
    const data = await file.arrayBuffer();
    
    worker.postMessage({
      id,
      type: 'decompress',
      data,
      fileName: file.name,
    }, [data]);
    
    return id;
  }

  cancel(operationId: string): void {
    const worker = this.getWorker();
    worker.postMessage({ id: operationId, type: 'cancel' });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.pendingOperations.clear();
    }
  }
}

// Singleton instance
export const workerManager = new WorkerManager();
