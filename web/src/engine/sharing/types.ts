/**
 * Sharing Module Types
 * P2P and cloud sharing infrastructure
 */

// Share token containing file metadata
export interface ShareToken {
  id: string;
  version: number;
  createdAt: number;
  expiresAt?: number;
  
  // File metadata
  fileName: string;
  fileSize: number;
  compressedSize: number;
  mimeType: string;
  
  // Integrity
  hash: string;
  chunkHashes: string[];
  
  // Sharing info
  mode: ShareMode;
  peerId?: string;
  cloudUrl?: string;
  
  // Encryption (if enabled)
  encrypted: boolean;
  encryptionHint?: string;
  
  // Resume support
  chunks: ShareChunkInfo[];
  resumable: boolean;
}

export type ShareMode = 'p2p' | 'cloud' | 'link';

// Chunk info for resumable transfers
export interface ShareChunkInfo {
  id: string;
  index: number;
  offset: number;
  size: number;
  hash: string;
}

// P2P connection state
export interface P2PConnectionState {
  id: string;
  peerId: string;
  status: P2PStatus;
  dataChannel: RTCDataChannel | null;
  connection: RTCPeerConnection | null;
  bytesTransferred: number;
  speed: number;
  startTime: number;
}

export type P2PStatus = 
  | 'connecting' 
  | 'connected' 
  | 'transferring' 
  | 'paused' 
  | 'completed' 
  | 'failed' 
  | 'disconnected';

// Transfer progress
export interface TransferProgress {
  transferId: string;
  direction: 'send' | 'receive';
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
  chunksCompleted: number;
  totalChunks: number;
  speed: number;
  eta: number;
  status: TransferStatus;
  error?: string;
}

export type TransferStatus = 
  | 'pending' 
  | 'connecting' 
  | 'transferring' 
  | 'verifying' 
  | 'completed' 
  | 'paused' 
  | 'cancelled' 
  | 'failed';

// Cloud provider configuration
export interface CloudProvider {
  id: string;
  name: string;
  type: CloudProviderType;
  enabled: boolean;
  config: CloudProviderConfig;
}

export type CloudProviderType = 
  | 'custom' 
  | 's3' 
  | 'gcs' 
  | 'azure' 
  | 'webdav';

export interface CloudProviderConfig {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKey?: string;
  secretKey?: string;
  // Never store actual secrets - use secure storage
}

// Cloud upload result
export interface CloudUploadResult {
  success: boolean;
  url?: string;
  expiresAt?: number;
  error?: string;
}

// Resume state for interrupted transfers
export interface ResumeState {
  shareToken: ShareToken;
  completedChunks: Set<string>;
  lastChunkIndex: number;
  bytesTransferred: number;
  savedAt: number;
}

// Sharing callbacks
export interface SharingCallbacks {
  onProgress: (progress: TransferProgress) => void;
  onComplete: (result: ShareResult) => void;
  onError: (error: Error) => void;
  onConnectionChange: (state: P2PConnectionState) => void;
}

// Share result
export interface ShareResult {
  success: boolean;
  shareToken?: ShareToken;
  error?: string;
  duration: number;
  bytesTransferred: number;
}

// Receive result
export interface ReceiveResult {
  success: boolean;
  fileName: string;
  fileSize: number;
  blob?: Blob;
  verified: boolean;
  error?: string;
}

// ICE server configuration
export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

// Default ICE servers (public STUN)
export const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: ['stun:stun.l.google.com:19302'] },
  { urls: ['stun:stun1.l.google.com:19302'] },
  { urls: ['stun:stun2.l.google.com:19302'] },
];

// Transfer chunk size (16KB for WebRTC)
export const TRANSFER_CHUNK_SIZE = 16 * 1024;

// Maximum concurrent P2P connections
export const MAX_P2P_CONNECTIONS = 5;

// Share token expiry (24 hours default)
export const DEFAULT_TOKEN_EXPIRY = 24 * 60 * 60 * 1000;
