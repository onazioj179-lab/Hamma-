/**
 * WASM Provider Component
 * Initializes WASM and provides status to app
 */

import { useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import { getWorkerManager, type WorkerManager } from '../../engine/worker';
import { useAppStore } from '../../store/app';

interface WasmContextValue {
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  manager: WorkerManager | null;
  capabilities: {
    hasSharedArrayBuffer: boolean;
    hasRealWasm: boolean;
    maxMemory: number;
  } | null;
}

const WasmContext = createContext<WasmContextValue>({
  isReady: false,
  isLoading: true,
  error: null,
  manager: null,
  capabilities: null,
});

export function useWasm() {
  return useContext(WasmContext);
}

interface WasmProviderProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function WasmProvider({ children, fallback }: WasmProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manager, setManager] = useState<WorkerManager | null>(null);
  const [capabilities, setCapabilities] = useState<WasmContextValue['capabilities']>(null);
  
  const setWasmReady = useAppStore((s) => s.setWasmReady);

  useEffect(() => {
    let mounted = true;
    
    async function init() {
      try {
        const workerManager = getWorkerManager({
          onReady: () => {
            if (mounted) {
              const caps = workerManager.getCapabilities();
              setCapabilities(caps);
              setWasmReady(true, caps || undefined);
            }
          },
          onError: (_, err) => {
            console.error('[WasmProvider] Worker error:', err.message);
          },
        });
        
        await workerManager.initialize();
        
        if (mounted) {
          setManager(workerManager);
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : 'WASM initialization failed';
          setError(message);
          setIsLoading(false);
          console.error('[WasmProvider] Init error:', err);
        }
      }
    }
    
    init();
    
    return () => {
      mounted = false;
    };
  }, [setWasmReady]);

  const isReady = !isLoading && !error && manager?.isReady();

  const value: WasmContextValue = {
    isReady: isReady || false,
    isLoading,
    error,
    manager,
    capabilities,
  };

  // Show fallback while loading
  if (isLoading && fallback) {
    return <>{fallback}</>;
  }

  return (
    <WasmContext.Provider value={value}>
      {children}
    </WasmContext.Provider>
  );
}

/**
 * Loading indicator for WASM initialization
 */
export function WasmLoadingIndicator() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4">
        <div className="relative w-16 h-16 mx-auto">
          <div className="absolute inset-0 border-4 border-primary-200 dark:border-primary-900 rounded-full" />
          <div className="absolute inset-0 border-4 border-transparent border-t-primary-500 rounded-full animate-spin" />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium text-foreground">Initializing SPK Engine</p>
          <p className="text-sm text-muted">Loading WASM compression module...</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Error display for WASM failures
 */
export function WasmErrorDisplay({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4 max-w-md px-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Engine Initialization Failed</h2>
          <p className="text-sm text-muted">{error}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}
