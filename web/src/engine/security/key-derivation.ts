/**
 * Key Derivation
 * Password-based key derivation using PBKDF2/Argon2
 */

import type {
  EncryptionConfig,
  KeyMaterial,
  KeyDerivationFunction,
} from './types';
import { 
  DEFAULT_ENCRYPTION_CONFIG, 
  SALT_LENGTH, 
  KEY_LENGTH,
} from './types';

/**
 * Generate random bytes
 */
export function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generate a new salt
 */
export function generateSalt(): Uint8Array {
  return generateRandomBytes(SALT_LENGTH);
}

/**
 * Derive key from password using PBKDF2
 */
async function derivePBKDF2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  // Import password as key
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Ensure we have a proper ArrayBuffer for the crypto API (TypeScript strict mode workaround)
  const saltCopy = new Uint8Array(salt);
  const saltForCrypto = new Uint8Array(saltCopy.length);
  saltForCrypto.set(saltCopy);
  
  // Derive AES key
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltForCrypto as Uint8Array<ArrayBuffer>,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    false, // Not exportable
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive key from password using Argon2
 * Note: Web Crypto API doesn't support Argon2, so we fall back to PBKDF2
 * In production, use a WASM Argon2 implementation
 */
async function deriveArgon2(
  password: string,
  salt: Uint8Array,
  memory: number,
  iterations: number,
  parallelism: number
): Promise<CryptoKey> {
  // Fallback to PBKDF2 with higher iterations
  // In production, use argon2-browser or similar WASM lib
  console.warn('Argon2 not available, falling back to PBKDF2');
  return derivePBKDF2(password, salt, iterations * 10);
}

/**
 * Derive encryption key from password
 */
export async function deriveKey(
  password: string,
  salt?: Uint8Array,
  config?: Partial<EncryptionConfig>,
  onProgress?: (progress: number) => void
): Promise<KeyMaterial> {
  const cfg = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };
  const actualSalt = salt || generateSalt();

  // Report progress
  if (onProgress) onProgress(0.1);

  let key: CryptoKey;

  if (cfg.kdf === 'argon2' && cfg.memory && cfg.parallelism) {
    key = await deriveArgon2(
      password,
      actualSalt,
      cfg.memory,
      cfg.iterations,
      cfg.parallelism
    );
  } else {
    key = await derivePBKDF2(password, actualSalt, cfg.iterations);
  }

  if (onProgress) onProgress(1.0);

  return {
    key,
    salt: actualSalt,
    exportable: false,
  };
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): {
  valid: boolean;
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let score = 0;

  // Length check
  if (password.length < 8) {
    issues.push('Password must be at least 8 characters');
  } else if (password.length >= 12) {
    score += 2;
  } else {
    score += 1;
  }

  // Uppercase check
  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    issues.push('Add uppercase letters');
  }

  // Lowercase check
  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    issues.push('Add lowercase letters');
  }

  // Number check
  if (/[0-9]/.test(password)) {
    score += 1;
  } else {
    issues.push('Add numbers');
  }

  // Special character check
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    score += 2;
  } else {
    issues.push('Add special characters');
  }

  // Common patterns
  const commonPatterns = [
    'password', '123456', 'qwerty', 'letmein', 'welcome',
    'admin', 'login', 'abc123', 'master', 'dragon',
  ];

  for (const pattern of commonPatterns) {
    if (password.toLowerCase().includes(pattern)) {
      score -= 2;
      issues.push('Avoid common patterns');
      break;
    }
  }

  return {
    valid: issues.length === 0 && score >= 4,
    score: Math.max(0, Math.min(10, score)),
    issues,
  };
}

/**
 * Generate a secure random password
 */
export function generateSecurePassword(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const bytes = generateRandomBytes(length);
  let password = '';
  
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  
  return password;
}
