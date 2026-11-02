/**
 * Security Hook
 * React integration for encryption and archive signing
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  KeyDerivation, 
  EncryptionEngine, 
  ArchiveSigner, 
  SecureFooterBuilder 
} from '../engine/security';
import type { 
  DerivedKey,
  EncryptedData,
  ArchiveSignature,
  SecureFooter,
  EncryptionAlgorithm,
  KeyDerivationConfig 
} from '../engine/security/types';

interface UseSecurityOptions {
  defaultAlgorithm?: EncryptionAlgorithm;
  keyDerivationConfig?: Partial<KeyDerivationConfig>;
}

interface UseSecurityReturn {
  // Key derivation
  deriveKey: (password: string, salt?: Uint8Array) => Promise<DerivedKey>;

  // Encryption
  encrypt: (data: Uint8Array, key: DerivedKey, algorithm?: EncryptionAlgorithm) => Promise<EncryptedData>;
  decrypt: (encrypted: EncryptedData, key: DerivedKey) => Promise<Uint8Array>;

  // Signing
  generateKeyPair: () => Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }>;
  sign: (data: Uint8Array, privateKey: Uint8Array) => Promise<ArchiveSignature>;
  verify: (data: Uint8Array, signature: ArchiveSignature, publicKey: Uint8Array) => Promise<boolean>;

  // Secure footer
  buildSecureFooter: (
    encrypted: EncryptedData,
    signature?: ArchiveSignature
  ) => Promise<SecureFooter>;
  parseSecureFooter: (data: Uint8Array) => Promise<SecureFooter>;

  // State
  isProcessing: boolean;
  error: Error | null;
}

/**
 * Hook for archive encryption and signing
 */
export function useSecurity(options: UseSecurityOptions = {}): UseSecurityReturn {
  const { defaultAlgorithm = 'aes-256-gcm', keyDerivationConfig } = options;

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const keyDerivationRef = useRef<KeyDerivation | null>(null);
  const encryptionRef = useRef<EncryptionEngine | null>(null);
  const signerRef = useRef<ArchiveSigner | null>(null);
  const footerBuilderRef = useRef<SecureFooterBuilder | null>(null);

  /**
   * Initialize security components
   */
  useEffect(() => {
    keyDerivationRef.current = new KeyDerivation(keyDerivationConfig);
    encryptionRef.current = new EncryptionEngine();
    signerRef.current = new ArchiveSigner();
    footerBuilderRef.current = new SecureFooterBuilder();

    return () => {
      keyDerivationRef.current = null;
      encryptionRef.current = null;
      signerRef.current = null;
      footerBuilderRef.current = null;
    };
  }, [keyDerivationConfig]);

  /**
   * Derive encryption key from password
   */
  const deriveKey = useCallback(async (
    password: string,
    salt?: Uint8Array
  ): Promise<DerivedKey> => {
    if (!keyDerivationRef.current) {
      throw new Error('Key derivation not initialized');
    }

    setIsProcessing(true);
    setError(null);

    try {
      return await keyDerivationRef.current.deriveKey(password, salt);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Encrypt data
   */
  const encrypt = useCallback(async (
    data: Uint8Array,
    key: DerivedKey,
    algorithm: EncryptionAlgorithm = defaultAlgorithm
  ): Promise<EncryptedData> => {
    if (!encryptionRef.current) {
      throw new Error('Encryption engine not initialized');
    }

    setIsProcessing(true);
    setError(null);

    try {
      return await encryptionRef.current.encrypt(data, key, algorithm);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [defaultAlgorithm]);

  /**
   * Decrypt data
   */
  const decrypt = useCallback(async (
    encrypted: EncryptedData,
    key: DerivedKey
  ): Promise<Uint8Array> => {
    if (!encryptionRef.current) {
      throw new Error('Encryption engine not initialized');
    }

    setIsProcessing(true);
    setError(null);

    try {
      return await encryptionRef.current.decrypt(encrypted, key);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Generate key pair for signing
   */
  const generateKeyPair = useCallback(async (): Promise<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  }> => {
    if (!signerRef.current) {
      throw new Error('Signer not initialized');
    }

    setIsProcessing(true);
    setError(null);

    try {
      return await signerRef.current.generateKeyPair();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Sign archive data
   */
  const sign = useCallback(async (
    data: Uint8Array,
    privateKey: Uint8Array
  ): Promise<ArchiveSignature> => {
    if (!signerRef.current) {
      throw new Error('Signer not initialized');
    }

    setIsProcessing(true);
    setError(null);

    try {
      return await signerRef.current.sign(data, privateKey);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Verify archive signature
   */
  const verify = useCallback(async (
    data: Uint8Array,
    signature: ArchiveSignature,
    publicKey: Uint8Array
  ): Promise<boolean> => {
    if (!signerRef.current) {
      throw new Error('Signer not initialized');
    }

    setIsProcessing(true);
    setError(null);

    try {
      return await signerRef.current.verify(data, signature, publicKey);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Build secure footer
   */
  const buildSecureFooter = useCallback(async (
    encrypted: EncryptedData,
    signature?: ArchiveSignature
  ): Promise<SecureFooter> => {
    if (!footerBuilderRef.current) {
      throw new Error('Footer builder not initialized');
    }

    setIsProcessing(true);
    setError(null);

    try {
      return await footerBuilderRef.current.build(encrypted, signature);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Parse secure footer from archive
   */
  const parseSecureFooter = useCallback(async (
    data: Uint8Array
  ): Promise<SecureFooter> => {
    if (!footerBuilderRef.current) {
      throw new Error('Footer builder not initialized');
    }

    setIsProcessing(true);
    setError(null);

    try {
      return await footerBuilderRef.current.parse(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return {
    deriveKey,
    encrypt,
    decrypt,
    generateKeyPair,
    sign,
    verify,
    buildSecureFooter,
    parseSecureFooter,
    isProcessing,
    error,
  };
}
