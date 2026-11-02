/**
 * SPK Multi-Pass Entropy Refinement Engine - Range Coder
 * Creator: OJ Treasure Onazi
 * 
 * Mode A: High-precision arithmetic coding for entropy refinement.
 * Best for data with moderate entropy (0.3-0.8).
 */

import {
  RangeCoderConfig,
  RangeCoderState,
  PassResult,
  DEFAULT_RANGE_CODER_CONFIG,
  MB,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const TOP = 0x01000000;       // 2^24 - normalization threshold
const BOTTOM = 0x00010000;    // 2^16 - range minimum
const MAX_FREQ = 0x3FFF;      // Maximum frequency value (14 bits)

// ============================================================================
// RANGE CODER
// ============================================================================

export class RangeCoder {
  private config: RangeCoderConfig;
  
  // State for encoding/decoding
  private low = 0;
  private range = 0xFFFFFFFF;
  private code = 0; // For decoding
  
  // Frequency tables
  private frequencies: Uint32Array;
  private cumulative: Uint32Array;
  private total = 0;
  
  // Context model (order-1)
  private contextFreqs: Map<number, Uint32Array> = new Map();
  private contextTotals: Map<number, number> = new Map();
  
  // Output buffer
  private output: number[] = [];
  private inputPos = 0;
  
  // Stats
  private bytesProcessed = 0;
  private startTime = 0;

  constructor(config: Partial<RangeCoderConfig> = {}) {
    this.config = { ...DEFAULT_RANGE_CODER_CONFIG, ...config };
    this.frequencies = new Uint32Array(256);
    this.cumulative = new Uint32Array(257);
    this.initializeFrequencies();
  }

  /**
   * Initialize frequency table with uniform distribution
   */
  private initializeFrequencies(): void {
    for (let i = 0; i < 256; i++) {
      this.frequencies[i] = 1;
    }
    this.total = 256;
    this.updateCumulative();
  }

  /**
   * Update cumulative frequency table
   */
  private updateCumulative(): void {
    this.cumulative[0] = 0;
    for (let i = 0; i < 256; i++) {
      this.cumulative[i + 1] = this.cumulative[i] + this.frequencies[i];
    }
  }

  /**
   * Get context-specific frequency table
   */
  private getContextFreqs(context: number): { freqs: Uint32Array; total: number } {
    let freqs = this.contextFreqs.get(context);
    let ctxTotal = this.contextTotals.get(context);
    
    if (!freqs) {
      freqs = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        freqs[i] = 1;
      }
      ctxTotal = 256;
      this.contextFreqs.set(context, freqs);
      this.contextTotals.set(context, ctxTotal);
    }
    
    return { freqs: freqs, total: ctxTotal! };
  }

  // ==========================================================================
  // ENCODING
  // ==========================================================================

  /**
   * Encode data using range coding
   */
  encode(data: Uint8Array): Uint8Array {
    this.reset();
    this.startTime = performance.now();
    
    const useContext = this.config.contextOrder > 0 && data.length > 100;
    let prevSymbol = 0;
    
    for (let i = 0; i < data.length; i++) {
      const symbol = data[i];
      
      if (useContext && i > 0) {
        this.encodeSymbolWithContext(symbol, prevSymbol);
      } else {
        this.encodeSymbol(symbol);
      }
      
      prevSymbol = symbol;
      this.bytesProcessed++;
      
      // Update frequency table periodically
      if (!this.config.staticModel && i % this.config.updateInterval === 0) {
        this.updateFrequency(symbol);
        if (useContext) {
          this.updateContextFrequency(prevSymbol, symbol);
        }
      }
    }
    
    // Flush remaining bits
    this.flush();
    
    return new Uint8Array(this.output);
  }

  /**
   * Encode a single symbol (order-0)
   */
  private encodeSymbol(symbol: number): void {
    const cumLow = this.cumulative[symbol];
    const cumHigh = this.cumulative[symbol + 1];
    const rangeSize = Math.floor(this.range / this.total);
    
    this.low += cumLow * rangeSize;
    this.range = (cumHigh - cumLow) * rangeSize;
    
    this.normalize();
  }

  /**
   * Encode with context (order-1)
   */
  private encodeSymbolWithContext(symbol: number, context: number): void {
    const { freqs, total } = this.getContextFreqs(context);
    
    // Build cumulative for context
    let cumLow = 0;
    for (let i = 0; i < symbol; i++) {
      cumLow += freqs[i];
    }
    const cumHigh = cumLow + freqs[symbol];
    
    const rangeSize = Math.floor(this.range / total);
    
    this.low += cumLow * rangeSize;
    this.range = (cumHigh - cumLow) * rangeSize;
    
    this.normalize();
  }

  /**
   * Normalize range and output bytes
   */
  private normalize(): void {
    while (this.range < BOTTOM) {
      if (this.low < 0xFF000000) {
        this.output.push((this.low >>> 24) & 0xFF);
      } else if ((this.low & 0xFF000000) === 0xFF000000) {
        this.output.push(0xFF);
      } else {
        this.output.push(((this.low >>> 24) + 1) & 0xFF);
      }
      
      this.low = (this.low << 8) >>> 0;
      this.range = (this.range << 8) >>> 0;
    }
  }

  /**
   * Flush final bytes
   */
  private flush(): void {
    for (let i = 0; i < 4; i++) {
      this.output.push((this.low >>> 24) & 0xFF);
      this.low = (this.low << 8) >>> 0;
    }
  }

  // ==========================================================================
  // DECODING
  // ==========================================================================

  /**
   * Decode range-coded data
   */
  decode(encoded: Uint8Array, originalSize: number): Uint8Array {
    this.reset();
    this.startTime = performance.now();
    
    const output = new Uint8Array(originalSize);
    this.inputPos = 0;
    
    // Initialize decoder
    this.code = 0;
    for (let i = 0; i < 4 && i < encoded.length; i++) {
      this.code = (this.code << 8) | encoded[this.inputPos++];
    }
    
    const useContext = this.config.contextOrder > 0 && originalSize > 100;
    let prevSymbol = 0;
    
    for (let i = 0; i < originalSize; i++) {
      let symbol: number;
      
      if (useContext && i > 0) {
        symbol = this.decodeSymbolWithContext(encoded, prevSymbol);
      } else {
        symbol = this.decodeSymbol(encoded);
      }
      
      output[i] = symbol;
      prevSymbol = symbol;
      this.bytesProcessed++;
      
      // Update frequency table
      if (!this.config.staticModel && i % this.config.updateInterval === 0) {
        this.updateFrequency(symbol);
        if (useContext) {
          this.updateContextFrequency(prevSymbol, symbol);
        }
      }
    }
    
    return output;
  }

  /**
   * Decode a single symbol
   */
  private decodeSymbol(encoded: Uint8Array): number {
    const rangeSize = Math.floor(this.range / this.total);
    const cumValue = Math.floor((this.code - this.low) / rangeSize);
    
    // Find symbol from cumulative value
    let symbol = 0;
    while (this.cumulative[symbol + 1] <= cumValue && symbol < 255) {
      symbol++;
    }
    
    const cumLow = this.cumulative[symbol];
    const cumHigh = this.cumulative[symbol + 1];
    
    this.low += cumLow * rangeSize;
    this.range = (cumHigh - cumLow) * rangeSize;
    
    this.normalizeDecoder(encoded);
    
    return symbol;
  }

  /**
   * Decode with context
   */
  private decodeSymbolWithContext(encoded: Uint8Array, context: number): number {
    const { freqs, total } = this.getContextFreqs(context);
    
    const rangeSize = Math.floor(this.range / total);
    const cumValue = Math.floor((this.code - this.low) / rangeSize);
    
    // Find symbol
    let symbol = 0;
    let cumSum = 0;
    while (cumSum + freqs[symbol] <= cumValue && symbol < 255) {
      cumSum += freqs[symbol];
      symbol++;
    }
    
    const cumLow = cumSum;
    const cumHigh = cumSum + freqs[symbol];
    
    this.low += cumLow * rangeSize;
    this.range = (cumHigh - cumLow) * rangeSize;
    
    this.normalizeDecoder(encoded);
    
    return symbol;
  }

  /**
   * Normalize decoder
   */
  private normalizeDecoder(encoded: Uint8Array): void {
    while (this.range < BOTTOM) {
      this.code = (this.code << 8) >>> 0;
      if (this.inputPos < encoded.length) {
        this.code |= encoded[this.inputPos++];
      }
      
      this.low = (this.low << 8) >>> 0;
      this.range = (this.range << 8) >>> 0;
    }
  }

  // ==========================================================================
  // FREQUENCY MANAGEMENT
  // ==========================================================================

  /**
   * Update symbol frequency (adaptive model)
   */
  private updateFrequency(symbol: number): void {
    this.frequencies[symbol]++;
    this.total++;
    
    // Rescale if total gets too large
    if (this.total >= MAX_FREQ) {
      this.rescaleFrequencies();
    }
    
    this.updateCumulative();
  }

  /**
   * Update context-specific frequency
   */
  private updateContextFrequency(context: number, symbol: number): void {
    const { freqs, total } = this.getContextFreqs(context);
    
    freqs[symbol]++;
    const newTotal = total + 1;
    
    if (newTotal >= MAX_FREQ) {
      // Rescale context frequencies
      let rescaledTotal = 0;
      for (let i = 0; i < 256; i++) {
        freqs[i] = Math.max(1, freqs[i] >> 1);
        rescaledTotal += freqs[i];
      }
      this.contextTotals.set(context, rescaledTotal);
    } else {
      this.contextTotals.set(context, newTotal);
    }
  }

  /**
   * Rescale frequencies to prevent overflow
   */
  private rescaleFrequencies(): void {
    this.total = 0;
    for (let i = 0; i < 256; i++) {
      this.frequencies[i] = Math.max(1, this.frequencies[i] >> 1);
      this.total += this.frequencies[i];
    }
  }

  // ==========================================================================
  // PASS INTERFACE
  // ==========================================================================

  /**
   * Execute range coder refinement pass
   */
  executePass(data: Uint8Array): PassResult {
    const startTime = performance.now();
    const inputSize = data.length;
    const entropyBefore = this.estimateEntropy(data);
    
    try {
      const encoded = this.encode(data);
      const timeMs = performance.now() - startTime;
      
      // Verify by decoding
      const decoded = this.decode(encoded, inputSize);
      
      // Verify correctness
      let correct = true;
      for (let i = 0; i < inputSize; i++) {
        if (data[i] !== decoded[i]) {
          correct = false;
          break;
        }
      }
      
      if (!correct) {
        return {
          mode: 'mode-a',
          status: 'failed',
          inputSize,
          outputSize: inputSize,
          ratio: 1.0,
          timeMs,
          memoryUsed: this.estimateMemoryUsed(),
          wasSignificant: false,
          entropyBefore,
          entropyAfter: entropyBefore,
          error: 'Decode verification failed',
        };
      }
      
      const outputSize = encoded.length;
      const ratio = outputSize / inputSize;
      const entropyAfter = this.estimateEntropy(encoded);
      const wasSignificant = ratio < 0.98; // At least 2% improvement
      
      return {
        mode: 'mode-a',
        status: 'success',
        inputSize,
        outputSize,
        ratio,
        timeMs,
        memoryUsed: this.estimateMemoryUsed(),
        wasSignificant,
        entropyBefore,
        entropyAfter,
      };
    } catch (error) {
      return {
        mode: 'mode-a',
        status: 'failed',
        inputSize,
        outputSize: inputSize,
        ratio: 1.0,
        timeMs: performance.now() - startTime,
        memoryUsed: this.estimateMemoryUsed(),
        wasSignificant: false,
        entropyBefore,
        entropyAfter: entropyBefore,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================

  /**
   * Get current state for checkpointing
   */
  getState(): RangeCoderState {
    return {
      low: this.low,
      range: this.range,
      frequencies: new Uint32Array(this.frequencies),
      totalFreq: this.total,
      outputSize: this.output.length,
      inputProcessed: this.bytesProcessed,
    };
  }

  /**
   * Restore from checkpoint
   */
  restoreState(state: RangeCoderState): void {
    this.low = state.low;
    this.range = state.range;
    this.frequencies = new Uint32Array(state.frequencies);
    this.total = state.totalFreq;
    this.bytesProcessed = state.inputProcessed;
    this.updateCumulative();
  }

  /**
   * Reset encoder state
   */
  reset(): void {
    this.low = 0;
    this.range = 0xFFFFFFFF;
    this.code = 0;
    this.output = [];
    this.inputPos = 0;
    this.bytesProcessed = 0;
    this.contextFreqs.clear();
    this.contextTotals.clear();
    this.initializeFrequencies();
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Estimate entropy of data
   */
  private estimateEntropy(data: Uint8Array): number {
    if (data.length === 0) return 0;
    
    const counts = new Uint32Array(256);
    for (let i = 0; i < data.length; i++) {
      counts[data[i]]++;
    }
    
    let entropy = 0;
    const total = data.length;
    
    for (let i = 0; i < 256; i++) {
      if (counts[i] > 0) {
        const p = counts[i] / total;
        entropy -= p * Math.log2(p);
      }
    }
    
    return entropy / 8; // Normalize to 0-1
  }

  /**
   * Estimate memory used
   */
  private estimateMemoryUsed(): number {
    let memory = 0;
    
    // Frequency tables
    memory += 256 * 4 * 2; // frequencies + cumulative
    
    // Context tables
    memory += this.contextFreqs.size * 256 * 4;
    
    // Output buffer
    memory += this.output.length;
    
    return memory;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createRangeCoder(config?: Partial<RangeCoderConfig>): RangeCoder {
  return new RangeCoder(config);
}
