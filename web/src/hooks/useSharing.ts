/**
 * Sharing Hook
 * React integration for P2P and cloud sharing
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ShareTokenManager, P2PConnectionManager, CloudProviderManager } from '../engine/sharing';
import type { 
  ShareToken, 
  ShareTokenConfig,
  P2PTransfer,
  CloudProvider,
  TransferProgress 
} from '../engine/sharing/types';

interface UseSharingOptions {
  onTransferProgress?: (progress: TransferProgress) => void;
  onPeerConnected?: (peerId: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
}

interface UseSharingReturn {
  // Token management
  createShareToken: (data: Uint8Array, config?: Partial<ShareTokenConfig>) => Promise<ShareToken>;
  validateToken: (tokenString: string) => Promise<ShareToken | null>;
  revokeToken: (tokenId: string) => void;

  // P2P sharing
  startP2PTransfer: (peerId: string, data: Uint8Array) => Promise<string>;
  acceptP2PTransfer: (transferId: string) => Promise<Uint8Array>;
  cancelP2PTransfer: (transferId: string) => void;

  // Cloud sharing
  uploadToCloud: (provider: CloudProvider['id'], data: Uint8Array, filename: string) => Promise<string>;
  downloadFromCloud: (provider: CloudProvider['id'], url: string) => Promise<Uint8Array>;

  // State
  activeTransfers: P2PTransfer[];
  connectedPeers: string[];
  isTransferring: boolean;
  transferProgress: TransferProgress | null;
  error: Error | null;
}

/**
 * Hook for sharing archives via P2P or cloud
 */
export function useSharing(options: UseSharingOptions = {}): UseSharingReturn {
  const { onTransferProgress, onPeerConnected, onPeerDisconnected } = options;

  const [activeTransfers, setActiveTransfers] = useState<P2PTransfer[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const tokenManagerRef = useRef<ShareTokenManager | null>(null);
  const p2pManagerRef = useRef<P2PConnectionManager | null>(null);
  const cloudManagerRef = useRef<CloudProviderManager | null>(null);

  /**
   * Initialize managers
   */
  useEffect(() => {
    tokenManagerRef.current = new ShareTokenManager();
    p2pManagerRef.current = new P2PConnectionManager();
    cloudManagerRef.current = new CloudProviderManager();

    // Set up P2P event listeners
    const p2p = p2pManagerRef.current;
    
    const handlePeerConnect = (peerId: string) => {
      setConnectedPeers(prev => [...prev, peerId]);
      onPeerConnected?.(peerId);
    };

    const handlePeerDisconnect = (peerId: string) => {
      setConnectedPeers(prev => prev.filter(id => id !== peerId));
      onPeerDisconnected?.(peerId);
    };

    // Note: Real implementation would add event listeners to p2p manager

    return () => {
      p2pManagerRef.current?.shutdown();
      tokenManagerRef.current = null;
      p2pManagerRef.current = null;
      cloudManagerRef.current = null;
    };
  }, [onPeerConnected, onPeerDisconnected]);

  /**
   * Create share token
   */
  const createShareToken = useCallback(async (
    data: Uint8Array,
    config?: Partial<ShareTokenConfig>
  ): Promise<ShareToken> => {
    if (!tokenManagerRef.current) {
      throw new Error('Token manager not initialized');
    }

    try {
      return await tokenManagerRef.current.createToken(data, config);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, []);

  /**
   * Validate share token
   */
  const validateToken = useCallback(async (
    tokenString: string
  ): Promise<ShareToken | null> => {
    if (!tokenManagerRef.current) {
      throw new Error('Token manager not initialized');
    }

    try {
      return await tokenManagerRef.current.validateToken(tokenString);
    } catch (err) {
      return null;
    }
  }, []);

  /**
   * Revoke share token
   */
  const revokeToken = useCallback((tokenId: string) => {
    tokenManagerRef.current?.revokeToken(tokenId);
  }, []);

  /**
   * Start P2P transfer
   */
  const startP2PTransfer = useCallback(async (
    peerId: string,
    data: Uint8Array
  ): Promise<string> => {
    if (!p2pManagerRef.current) {
      throw new Error('P2P manager not initialized');
    }

    setIsTransferring(true);
    setError(null);

    try {
      const transferId = await p2pManagerRef.current.initiateTransfer(
        peerId,
        data,
        (progress) => {
          setTransferProgress(progress);
          onTransferProgress?.(progress);
        }
      );

      // Update active transfers
      const transfer = p2pManagerRef.current.getTransfer(transferId);
      if (transfer) {
        setActiveTransfers(prev => [...prev, transfer]);
      }

      return transferId;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsTransferring(false);
    }
  }, [onTransferProgress]);

  /**
   * Accept P2P transfer
   */
  const acceptP2PTransfer = useCallback(async (
    transferId: string
  ): Promise<Uint8Array> => {
    if (!p2pManagerRef.current) {
      throw new Error('P2P manager not initialized');
    }

    setIsTransferring(true);
    setError(null);

    try {
      const data = await p2pManagerRef.current.acceptTransfer(
        transferId,
        (progress) => {
          setTransferProgress(progress);
          onTransferProgress?.(progress);
        }
      );

      // Remove from active transfers
      setActiveTransfers(prev => prev.filter(t => t.id !== transferId));

      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsTransferring(false);
    }
  }, [onTransferProgress]);

  /**
   * Cancel P2P transfer
   */
  const cancelP2PTransfer = useCallback((transferId: string) => {
    p2pManagerRef.current?.cancelTransfer(transferId);
    setActiveTransfers(prev => prev.filter(t => t.id !== transferId));
  }, []);

  /**
   * Upload to cloud provider
   */
  const uploadToCloud = useCallback(async (
    providerId: CloudProvider['id'],
    data: Uint8Array,
    filename: string
  ): Promise<string> => {
    if (!cloudManagerRef.current) {
      throw new Error('Cloud manager not initialized');
    }

    setIsTransferring(true);
    setError(null);

    try {
      return await cloudManagerRef.current.upload(
        providerId,
        data,
        filename,
        (progress) => {
          setTransferProgress(progress);
          onTransferProgress?.(progress);
        }
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsTransferring(false);
    }
  }, [onTransferProgress]);

  /**
   * Download from cloud provider
   */
  const downloadFromCloud = useCallback(async (
    providerId: CloudProvider['id'],
    url: string
  ): Promise<Uint8Array> => {
    if (!cloudManagerRef.current) {
      throw new Error('Cloud manager not initialized');
    }

    setIsTransferring(true);
    setError(null);

    try {
      return await cloudManagerRef.current.download(
        providerId,
        url,
        (progress) => {
          setTransferProgress(progress);
          onTransferProgress?.(progress);
        }
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsTransferring(false);
    }
  }, [onTransferProgress]);

  return {
    createShareToken,
    validateToken,
    revokeToken,
    startP2PTransfer,
    acceptP2PTransfer,
    cancelP2PTransfer,
    uploadToCloud,
    downloadFromCloud,
    activeTransfers,
    connectedPeers,
    isTransferring,
    transferProgress,
    error,
  };
}
