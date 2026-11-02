// ============================================================================
// SPK Engine - Central Export
// ============================================================================
// Use named namespace imports to avoid conflicts

// Core Modules
export * as core from './core';
export * as wasm from './wasm';
export * as protocol from './protocol';

// Workers & Processing
export * as workers from './worker';
export * as pipeline from './pipeline';
export * as streaming from './streaming';
export * as decompression from './decompression';

// Advanced Engines
export * as massive from './massive';      // Large file handler (>100MB)
export * as lowmem from './lowmem';        // Low memory optimization
export * as integrity from './integrity';  // Data integrity verification
export * as parallel from './parallel';    // Parallel processing
export * as redundancy from './redundancy'; // Dynamic redundancy detection
export * as refinement from './refinement'; // Multi-pass entropy refinement

// Optimization & Performance
export * as optimizer from './optimizer';
export * as performance from './performance';
export * as memory from './memory';
export * as distributed from './distributed';

// Features
export * as media from './media';
export * as preview from './preview';
export * as sharing from './sharing';
export * as security from './security';
export * as session from './session';
export * as folder from './folder';
export * as verification from './verification';

// Integration (UnifiedSPK, FailSafeSPK)
export * from './integration';

// Master Coordinator & Engine Selection
export { MasterCoordinator, getMasterCoordinator } from './master-coordinator';
export type { CompressionOptions, CompressionResult, CompressionProgress } from './master-coordinator';
export { EngineSelector, detectDeviceProfile, detectMemoryPressure, getAvailableMemory } from './selector';
export type { EnginePipeline, EngineSelectionCriteria, DeviceProfile, UserPreference } from './selector';

// Unified Memory Controller
export { UnifiedMemoryController, getUnifiedMemoryController, resetUnifiedMemoryController } from './memory/unified-memory';
export type { MemorySubsystem, PressureLevel, MemoryAllocation, MemoryBudget, MemoryStats } from './memory/unified-memory';
