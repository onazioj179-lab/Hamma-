// Compatibility entry point for the retired V24 worker.
// Its former mock discarded input bytes and could not produce restorable archives.
import type { SpkWasm } from './types';

export const loadSpkWasm = async (): Promise<SpkWasm> => {
  throw new Error('The legacy V24 compression engine is unavailable. Use AdaptiveEngine from engine/adaptive-engine.');
};

export const getSpkWasm = (): SpkWasm => {
  throw new Error('The legacy V24 compression engine is unavailable. Use AdaptiveEngine from engine/adaptive-engine.');
};

export const isWasmLoaded = (): boolean => false;
export const isWasmSupported = (): boolean =>
  typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
