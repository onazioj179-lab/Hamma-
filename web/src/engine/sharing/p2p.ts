/**
 * P2P Connection Manager
 * WebRTC-based peer-to-peer file sharing
 */

import type {
  ShareToken,
  P2PConnectionState,
  P2PStatus,
  TransferProgress,
  SharingCallbacks,
  IceServerConfig,
  ResumeState,
} from './types';
import { DEFAULT_ICE_SERVERS, TRANSFER_CHUNK_SIZE, MAX_P2P_CONNECTIONS } from './types';
import { getShareTokenManager } from './token';

/**
 * P2P connection for file transfer
 */
export class P2PConnection {
  readonly id: string;
  readonly peerId: string;
  
  private connection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private status: P2PStatus = 'connecting';
  private callbacks: Partial<SharingCallbacks> = {};
  
  // Transfer state
  private transferId: string | null = null;
  private direction: 'send' | 'receive' = 'send';
  private fileData: ArrayBuffer | null = null;
  private receivedChunks: Map<number, ArrayBuffer> = new Map();
  private token: ShareToken | null = null;
  private bytesTransferred = 0;
  private startTime = 0;

  constructor(id: string, peerId: string, iceServers?: IceServerConfig[]) {
    this.id = id;
    this.peerId = peerId;
    
    // Create RTCPeerConnection
    this.connection = new RTCPeerConnection({
      iceServers: iceServers || DEFAULT_ICE_SERVERS,
    });

    this.setupConnectionHandlers();
  }

  /**
   * Set up connection event handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.onicecandidate = (event) => {
      if (event.candidate) {
        // Signal ice candidate to peer (via signaling server)
        this.onIceCandidate(event.candidate);
      }
    };

    this.connection.onconnectionstatechange = () => {
      const state = this.connection?.connectionState;
      
      if (state === 'connected') {
        this.setStatus('connected');
      } else if (state === 'disconnected' || state === 'failed') {
        this.setStatus('disconnected');
      }
    };

    this.connection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannelHandlers();
    };
  }

  /**
   * Set up data channel handlers
   */
  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      this.setStatus('connected');
    };

    this.dataChannel.onclose = () => {
      this.setStatus('disconnected');
    };

    this.dataChannel.onerror = (error) => {
      this.setStatus('failed');
      if (this.callbacks.onError) {
        this.callbacks.onError(new Error('Data channel error'));
      }
    };

    this.dataChannel.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  /**
   * Create offer (for initiating peer)
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    // Create data channel for file transfer
    this.dataChannel = this.connection.createDataChannel('file-transfer', {
      ordered: true,
    });
    this.setupDataChannelHandlers();

    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    
    return offer;
  }

  /**
   * Handle incoming offer (for receiving peer)
   */
  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    await this.connection.setRemoteDescription(offer);
    
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    
    return answer;
  }

  /**
   * Handle incoming answer
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    await this.connection.setRemoteDescription(answer);
  }

  /**
   * Add ICE candidate
   */
  async addIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    if (!this.connection) return;
    await this.connection.addIceCandidate(candidate);
  }

  /**
   * Handle ICE candidate (to be signaled)
   */
  private onIceCandidate(candidate: RTCIceCandidate): void {
    // In production, send via signaling server
    // For now, store for manual exchange
  }

  /**
   * Send file to peer
   */
  async sendFile(
    file: File | Blob,
    token: ShareToken,
    callbacks?: Partial<SharingCallbacks>
  ): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    if (callbacks) {
      this.callbacks = callbacks;
    }

    this.direction = 'send';
    this.token = token;
    this.transferId = token.id;
    this.fileData = await file.arrayBuffer();
    this.bytesTransferred = 0;
    this.startTime = Date.now();
    this.setStatus('transferring');

    // Send token first
    this.dataChannel.send(JSON.stringify({
      type: 'token',
      token: getShareTokenManager().serializeToken(token),
    }));

    // Send file in chunks
    await this.sendChunks();
  }

  /**
   * Send file data in chunks
   */
  private async sendChunks(): Promise<void> {
    if (!this.dataChannel || !this.fileData) return;

    const data = new Uint8Array(this.fileData);
    const totalChunks = Math.ceil(data.length / TRANSFER_CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      // Wait for buffer to clear if needed
      while (this.dataChannel.bufferedAmount > TRANSFER_CHUNK_SIZE * 10) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const start = i * TRANSFER_CHUNK_SIZE;
      const end = Math.min(start + TRANSFER_CHUNK_SIZE, data.length);
      const chunk = data.slice(start, end);

      // Send chunk with header
      const header = new ArrayBuffer(8);
      const headerView = new DataView(header);
      headerView.setUint32(0, i, true); // Chunk index
      headerView.setUint32(4, chunk.length, true); // Chunk size

      // Combine header and chunk
      const message = new Uint8Array(8 + chunk.length);
      message.set(new Uint8Array(header), 0);
      message.set(chunk, 8);

      this.dataChannel.send(message);

      this.bytesTransferred = end;
      this.reportProgress(i + 1, totalChunks);
    }

    // Send completion message
    this.dataChannel.send(JSON.stringify({ type: 'complete' }));
    this.setStatus('completed');
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      // JSON control message
      try {
        const message = JSON.parse(data);
        this.handleControlMessage(message);
      } catch {
        // Ignore invalid JSON
      }
    } else {
      // Binary chunk data
      this.handleChunkData(data);
    }
  }

  /**
   * Handle control message
   */
  private handleControlMessage(message: any): void {
    if (message.type === 'token') {
      // Receiving file token
      const token = getShareTokenManager().deserializeToken(message.token);
      if (token) {
        this.token = token;
        this.transferId = token.id;
        this.direction = 'receive';
        this.startTime = Date.now();
        this.setStatus('transferring');
      }
    } else if (message.type === 'complete') {
      // Transfer complete
      this.assembleFile();
    } else if (message.type === 'resume') {
      // Resume request
      this.handleResumeRequest(message);
    }
  }

  /**
   * Handle incoming chunk data
   */
  private handleChunkData(data: ArrayBuffer): void {
    const view = new DataView(data);
    const chunkIndex = view.getUint32(0, true);
    const chunkSize = view.getUint32(4, true);
    const chunkData = data.slice(8, 8 + chunkSize);

    this.receivedChunks.set(chunkIndex, chunkData);
    this.bytesTransferred += chunkSize;

    const totalChunks = this.token?.chunks.length || 
      Math.ceil((this.token?.fileSize || 0) / TRANSFER_CHUNK_SIZE);
    
    this.reportProgress(this.receivedChunks.size, totalChunks);
  }

  /**
   * Assemble received chunks into file
   */
  private async assembleFile(): Promise<void> {
    if (!this.token) return;

    // Sort chunks by index
    const sortedChunks = Array.from(this.receivedChunks.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, data]) => data);

    // Combine chunks
    const totalSize = sortedChunks.reduce((sum, c) => sum + c.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;

    for (const chunk of sortedChunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    // Verify integrity
    const tokenManager = getShareTokenManager();
    const verified = await tokenManager.verifyFile(this.token, combined.buffer);

    if (verified) {
      this.setStatus('completed');
      if (this.callbacks.onComplete) {
        this.callbacks.onComplete({
          success: true,
          shareToken: this.token,
          duration: Date.now() - this.startTime,
          bytesTransferred: this.bytesTransferred,
        });
      }
    } else {
      this.setStatus('failed');
      if (this.callbacks.onError) {
        this.callbacks.onError(new Error('File verification failed'));
      }
    }
  }

  /**
   * Handle resume request
   */
  private handleResumeRequest(message: any): void {
    const completedChunks = new Set<number>(message.completedChunks || []);
    // Resume sending from where we left off
  }

  /**
   * Report transfer progress
   */
  private reportProgress(chunksCompleted: number, totalChunks: number): void {
    if (!this.callbacks.onProgress || !this.token) return;

    const elapsed = (Date.now() - this.startTime) / 1000;
    const speed = elapsed > 0 ? this.bytesTransferred / elapsed : 0;
    const remaining = this.token.fileSize - this.bytesTransferred;
    const eta = speed > 0 ? remaining / speed : 0;

    const progress: TransferProgress = {
      transferId: this.transferId || '',
      direction: this.direction,
      fileName: this.token.fileName,
      bytesTransferred: this.bytesTransferred,
      totalBytes: this.token.fileSize,
      chunksCompleted,
      totalChunks,
      speed,
      eta,
      status: this.status === 'transferring' ? 'transferring' : 'pending',
    };

    this.callbacks.onProgress(progress);
  }

  /**
   * Set connection status
   */
  private setStatus(status: P2PStatus): void {
    this.status = status;
    
    if (this.callbacks.onConnectionChange) {
      this.callbacks.onConnectionChange(this.getState());
    }
  }

  /**
   * Get connection state
   */
  getState(): P2PConnectionState {
    const elapsed = (Date.now() - this.startTime) / 1000;
    
    return {
      id: this.id,
      peerId: this.peerId,
      status: this.status,
      dataChannel: this.dataChannel,
      connection: this.connection,
      bytesTransferred: this.bytesTransferred,
      speed: elapsed > 0 ? this.bytesTransferred / elapsed : 0,
      startTime: this.startTime,
    };
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    
    this.setStatus('disconnected');
  }
}

/**
 * P2P connection manager
 */
export class P2PManager {
  private connections: Map<string, P2PConnection> = new Map();
  private iceServers: IceServerConfig[];

  constructor(iceServers?: IceServerConfig[]) {
    this.iceServers = iceServers || DEFAULT_ICE_SERVERS;
  }

  /**
   * Create new connection
   */
  createConnection(peerId: string): P2PConnection {
    if (this.connections.size >= MAX_P2P_CONNECTIONS) {
      throw new Error('Maximum concurrent connections reached');
    }

    const id = `conn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const connection = new P2PConnection(id, peerId, this.iceServers);
    
    this.connections.set(id, connection);
    return connection;
  }

  /**
   * Get connection by ID
   */
  getConnection(id: string): P2PConnection | undefined {
    return this.connections.get(id);
  }

  /**
   * Close connection
   */
  closeConnection(id: string): void {
    const connection = this.connections.get(id);
    if (connection) {
      connection.close();
      this.connections.delete(id);
    }
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
  }

  /**
   * Get active connection count
   */
  get activeConnections(): number {
    return this.connections.size;
  }
}

// Singleton instance
let p2pManager: P2PManager | null = null;

export function getP2PManager(iceServers?: IceServerConfig[]): P2PManager {
  if (!p2pManager) {
    p2pManager = new P2PManager(iceServers);
  }
  return p2pManager;
}
