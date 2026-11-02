/**
 * Archive Signing
 * Digital signatures for archive integrity
 */

import type {
  ArchiveSignature,
  SigningKeyPair,
  VerificationResult,
} from './types';

/**
 * Generate ECDSA P-256 signing key pair
 */
async function generateECDSAKeyPair(): Promise<SigningKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, // Exportable
    ['sign', 'verify']
  );

  // Export public key for sharing
  const exportedPublic = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPublic)));

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    exportedPublicKey: publicKeyBase64,
  };
}

/**
 * Sign data with ECDSA
 */
async function signECDSA(data: ArrayBuffer, privateKey: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    data
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Verify ECDSA signature
 */
async function verifyECDSA(
  data: ArrayBuffer,
  signature: string,
  publicKey: CryptoKey
): Promise<boolean> {
  try {
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signatureBytes,
      data
    );
  } catch {
    return false;
  }
}

/**
 * Import public key from base64
 */
async function importPublicKey(keyBase64: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
  
  return crypto.subtle.importKey(
    'spki',
    keyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

/**
 * Signing engine
 */
export class SigningEngine {
  private keyPair: SigningKeyPair | null = null;

  /**
   * Generate new key pair
   */
  async generateKeyPair(): Promise<SigningKeyPair> {
    this.keyPair = await generateECDSAKeyPair();
    return this.keyPair;
  }

  /**
   * Set existing key pair
   */
  setKeyPair(keyPair: SigningKeyPair): void {
    this.keyPair = keyPair;
  }

  /**
   * Sign archive data
   */
  async sign(
    data: ArrayBuffer,
    signedBy?: string
  ): Promise<ArchiveSignature> {
    if (!this.keyPair) {
      throw new Error('No signing key pair available');
    }

    const signature = await signECDSA(data, this.keyPair.privateKey);

    return {
      algorithm: 'ecdsa-p256',
      publicKey: this.keyPair.exportedPublicKey,
      signature,
      signedAt: Date.now(),
      signedBy,
    };
  }

  /**
   * Verify archive signature
   */
  async verify(
    data: ArrayBuffer,
    signature: ArchiveSignature
  ): Promise<VerificationResult> {
    try {
      if (signature.algorithm !== 'ecdsa-p256') {
        return {
          valid: false,
          error: `Unsupported algorithm: ${signature.algorithm}`,
        };
      }

      const publicKey = await importPublicKey(signature.publicKey);
      const valid = await verifyECDSA(data, signature.signature, publicKey);

      return {
        valid,
        signedAt: signature.signedAt,
        signedBy: signature.signedBy,
        error: valid ? undefined : 'Signature verification failed',
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification error',
      };
    }
  }

  /**
   * Export public key for sharing
   */
  getPublicKey(): string | null {
    return this.keyPair?.exportedPublicKey || null;
  }

  /**
   * Check if key pair is available
   */
  hasKeyPair(): boolean {
    return this.keyPair !== null;
  }
}

/**
 * Calculate content hash
 */
export async function calculateHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calculate integrity table
 */
export async function calculateIntegrityTable(
  chunks: Array<{ id: string; offset: number; data: ArrayBuffer; encrypted: boolean }>
): Promise<Array<{ chunkId: string; offset: number; size: number; hash: string; encrypted: boolean }>> {
  const entries = [];
  
  for (const chunk of chunks) {
    const hash = await calculateHash(chunk.data);
    entries.push({
      chunkId: chunk.id,
      offset: chunk.offset,
      size: chunk.data.byteLength,
      hash,
      encrypted: chunk.encrypted,
    });
  }
  
  return entries;
}

/**
 * Create signing engine instance
 */
export function createSigningEngine(): SigningEngine {
  return new SigningEngine();
}
