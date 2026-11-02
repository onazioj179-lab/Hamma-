/**
 * Cloud Provider Hooks
 * Optional cloud upload/download integration
 */

import type {
  CloudProvider,
  CloudProviderType,
  CloudProviderConfig,
  CloudUploadResult,
  ShareToken,
  TransferProgress,
} from './types';

/**
 * Cloud provider interface
 */
export interface CloudProviderInterface {
  id: string;
  name: string;
  type: CloudProviderType;
  
  /**
   * Check if provider is configured
   */
  isConfigured(): boolean;
  
  /**
   * Upload file to cloud
   */
  upload(
    file: File | Blob,
    token: ShareToken,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<CloudUploadResult>;
  
  /**
   * Download file from cloud
   */
  download(
    url: string,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<Blob>;
  
  /**
   * Delete file from cloud
   */
  delete(url: string): Promise<boolean>;
  
  /**
   * Get signed URL for sharing
   */
  getSignedUrl(url: string, expiresIn: number): Promise<string>;
}

/**
 * Custom HTTP provider (user's own endpoint)
 */
export class CustomCloudProvider implements CloudProviderInterface {
  readonly id = 'custom';
  readonly name = 'Custom Endpoint';
  readonly type: CloudProviderType = 'custom';
  
  private config: CloudProviderConfig;

  constructor(config: CloudProviderConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config.endpoint;
  }

  async upload(
    file: File | Blob,
    token: ShareToken,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<CloudUploadResult> {
    if (!this.config.endpoint) {
      return { success: false, error: 'Endpoint not configured' };
    }

    try {
      const formData = new FormData();
      formData.append('file', file, token.fileName);
      formData.append('token', JSON.stringify(token));

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        body: formData,
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const result = await response.json();
      
      return {
        success: true,
        url: result.url,
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  async download(
    url: string,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<Blob> {
    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    return response.blob();
  }

  async delete(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getSignedUrl(url: string, expiresIn: number): Promise<string> {
    // For custom endpoints, assume URL is already accessible
    return url;
  }

  private getAuthHeaders(): HeadersInit {
    const headers: HeadersInit = {};
    
    if (this.config.accessKey) {
      headers['Authorization'] = `Bearer ${this.config.accessKey}`;
    }
    
    return headers;
  }
}

/**
 * S3-compatible provider
 */
export class S3CloudProvider implements CloudProviderInterface {
  readonly id = 's3';
  readonly name = 'S3 Compatible';
  readonly type: CloudProviderType = 's3';
  
  private config: CloudProviderConfig;

  constructor(config: CloudProviderConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!(
      this.config.endpoint &&
      this.config.bucket &&
      this.config.accessKey &&
      this.config.secretKey
    );
  }

  async upload(
    file: File | Blob,
    token: ShareToken,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<CloudUploadResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'S3 not configured' };
    }

    // In production, use proper S3 SDK or presigned URLs
    // This is a simplified implementation
    try {
      const key = `spk/${token.id}/${token.fileName}`;
      const url = `${this.config.endpoint}/${this.config.bucket}/${key}`;

      const response = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': token.mimeType,
          // Add S3 auth headers in production
        },
      });

      if (!response.ok) {
        throw new Error(`S3 upload failed: ${response.status}`);
      }

      return {
        success: true,
        url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'S3 upload failed',
      };
    }
  }

  async download(
    url: string,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`S3 download failed: ${response.status}`);
    }
    return response.blob();
  }

  async delete(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: 'DELETE' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getSignedUrl(url: string, expiresIn: number): Promise<string> {
    // In production, generate presigned URL
    return url;
  }
}

/**
 * Cloud provider manager
 */
export class CloudManager {
  private providers: Map<string, CloudProviderInterface> = new Map();

  /**
   * Register a cloud provider
   */
  registerProvider(provider: CloudProviderInterface): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Get provider by ID
   */
  getProvider(id: string): CloudProviderInterface | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all configured providers
   */
  getConfiguredProviders(): CloudProviderInterface[] {
    return Array.from(this.providers.values())
      .filter(p => p.isConfigured());
  }

  /**
   * Upload to specific provider
   */
  async upload(
    providerId: string,
    file: File | Blob,
    token: ShareToken,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<CloudUploadResult> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }
    
    if (!provider.isConfigured()) {
      return { success: false, error: 'Provider not configured' };
    }

    return provider.upload(file, token, onProgress);
  }

  /**
   * Download from URL (auto-detect provider)
   */
  async download(
    url: string,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<Blob> {
    // Simple fetch for now
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    return response.blob();
  }
}

// Singleton instance
let cloudManager: CloudManager | null = null;

export function getCloudManager(): CloudManager {
  if (!cloudManager) {
    cloudManager = new CloudManager();
    
    // Register default providers (unconfigured)
    cloudManager.registerProvider(new CustomCloudProvider({}));
    cloudManager.registerProvider(new S3CloudProvider({}));
  }
  return cloudManager;
}

/**
 * Configure cloud provider
 */
export function configureCloudProvider(
  type: CloudProviderType,
  config: CloudProviderConfig
): void {
  const manager = getCloudManager();
  
  switch (type) {
    case 'custom':
      manager.registerProvider(new CustomCloudProvider(config));
      break;
    case 's3':
      manager.registerProvider(new S3CloudProvider(config));
      break;
    // Add more providers as needed
  }
}
