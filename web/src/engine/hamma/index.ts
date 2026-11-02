/**
 * HAMMA Module Index - TypeScript Client Exports
 * 
 * High-speed AI-powered compression prediction for SPK.
 * 
 * Creator: Onazi Treasure (OJ)
 */

export { HammaClient } from './hamma-client';
export { predictFallback, resetRedundancyCache } from './hamma-fallback';

export type {
  ChunkMetadata,
  WorkerStats,
  DeviceProfile,
  HistoricalPerformance,
  PredictionResponse,
  MemoryTarget,
  HammaClientConfig,
  PredictionRequest,
  PartitionInfo,
  HealthResponse,
} from './hamma-client';
