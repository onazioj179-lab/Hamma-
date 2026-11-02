/**
 * SPK Platform Index
 * Central export for all platform modules
 */

// ============================================================================
// VERSION (Internal Only)
// ============================================================================
export {
  // Internal version info (DO NOT EXPOSE TO UI)
  INTERNAL_VERSION,
  INTERNAL_CODENAME,
  INTERNAL_VERSION_DATE,
  
  // Public info (safe to use)
  FORMAT_VERSION,
  PRODUCT_NAME,
  PRODUCT_SHORT_NAME,
  
  // Component registry
  PLATFORM_COMPONENTS,
  type ComponentStatus,
  
  // Requirements
  VERSION_1_0_REQUIREMENTS,
  PERFORMANCE_TARGETS,
  
  // Utilities
  checkVersion1Requirements,
  getStableComponents,
  VERSION_1_0_DECLARED,
} from './version';

// ============================================================================
// STATUS
// ============================================================================
export {
  // Health
  type PlatformHealth,
  type ComponentHealthStatus,
  getPlatformHealth,
  
  // Capabilities
  type PlatformCapabilities,
  checkCapabilities,
  
  // Metrics
  type RuntimeMetrics,
  getMetricsTracker,
  getRuntimeMetrics,
  
  // Validation
  type PerformanceValidation,
  validatePerformance,
} from './status';

// ============================================================================
// API (V44 - Unified API Surface)
// ============================================================================
export * from './api';

// ============================================================================
// AI (V46 - AI Optimization Layer)
// ============================================================================
export * from './ai';
