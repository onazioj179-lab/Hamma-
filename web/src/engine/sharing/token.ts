/**
 * Share Token Manager
 * Creates and validates share tokens
 */

import type {
  ShareToken,
  ShareMode,
  ShareChunkInfo,
} from './types';
import { DEFAULT_TOKEN_EXPIRY } from './types';

/**
 * Generate unique ID
 */
function generateId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Calculate hash of data
 */
async function calculateHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Share token manager
 */
export class ShareTokenManager {
  private tokens: Map<string, ShareToken> = new Map();

  /**
   * Create a share token for a file
   */
  async createToken(
    file: File | Blob,
    options: {
      mode: ShareMode;
      encrypted?: boolean;
      expiresIn?: number;
      peerId?: string;
      cloudUrl?: string;
    }
  ): Promise<ShareToken> {
    const data = await file.arrayBuffer();
    const hash = await calculateHash(data);

    // Split into chunks for resumable transfer
    const chunkSize = 1024 * 1024; // 1MB chunks
    const chunks: ShareChunkInfo[] = [];
    const chunkHashes: string[] = [];

    for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, data.byteLength);
      const chunkData = data.slice(offset, end);
      const chunkHash = await calculateHash(chunkData);
      
      chunks.push({
        id: `chunk-${chunks.length}`,
        index: chunks.length,
        offset,
        size: end - offset,
        hash: chunkHash,
      });
      
      chunkHashes.push(chunkHash);
    }

    const token: ShareToken = {
      id: generateId(),
      version: 1,
      createdAt: Date.now(),
      expiresAt: options.expiresIn 
        ? Date.now() + options.expiresIn 
        : Date.now() + DEFAULT_TOKEN_EXPIRY,
      
      fileName: file instanceof File ? file.name : 'file',
      fileSize: data.byteLength,
      compressedSize: data.byteLength,
      mimeType: file.type || 'application/octet-stream',
      
      hash,
      chunkHashes,
      
      mode: options.mode,
      peerId: options.peerId,
      cloudUrl: options.cloudUrl,
      
      encrypted: options.encrypted || false,
      
      chunks,
      resumable: true,
    };

    this.tokens.set(token.id, token);
    return token;
  }

  /**
   * Validate a share token
   */
  validateToken(token: ShareToken): { valid: boolean; error?: string } {
    // Check expiry
    if (token.expiresAt && Date.now() > token.expiresAt) {
      return { valid: false, error: 'Token has expired' };
    }

    // Check required fields
    if (!token.id || !token.hash || !token.fileName) {
      return { valid: false, error: 'Token is missing required fields' };
    }

    // Check chunks
    if (token.resumable && (!token.chunks || token.chunks.length === 0)) {
      return { valid: false, error: 'Resumable token must have chunks' };
    }

    return { valid: true };
  }

  /**
   * Verify file against token
   */
  async verifyFile(token: ShareToken, data: ArrayBuffer): Promise<boolean> {
    const hash = await calculateHash(data);
    return hash === token.hash;
  }

  /**
   * Verify a single chunk
   */
  async verifyChunk(chunkInfo: ShareChunkInfo, data: ArrayBuffer): Promise<boolean> {
    const hash = await calculateHash(data);
    return hash === chunkInfo.hash;
  }

  /**
   * Serialize token for sharing
   */
  serializeToken(token: ShareToken): string {
    return btoa(JSON.stringify(token));
  }

  /**
   * Deserialize token from string
   */
  deserializeToken(encoded: string): ShareToken | null {
    try {
      const json = atob(encoded);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /**
   * Get stored token
   */
  getToken(id: string): ShareToken | undefined {
    return this.tokens.get(id);
  }

  /**
   * Remove token
   */
  removeToken(id: string): boolean {
    return this.tokens.delete(id);
  }

  /**
   * Clear expired tokens
   */
  clearExpired(): number {
    let cleared = 0;
    const now = Date.now();
    
    for (const [id, token] of this.tokens) {
      if (token.expiresAt && now > token.expiresAt) {
        this.tokens.delete(id);
        cleared++;
      }
    }
    
    return cleared;
  }

  /**
   * Get all active tokens
   */
  getActiveTokens(): ShareToken[] {
    const now = Date.now();
    return Array.from(this.tokens.values())
      .filter(t => !t.expiresAt || now <= t.expiresAt);
  }
}

// Singleton instance
let tokenManager: ShareTokenManager | null = null;

export function getShareTokenManager(): ShareTokenManager {
  if (!tokenManager) {
    tokenManager = new ShareTokenManager();
  }
  return tokenManager;
}
