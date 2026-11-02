/**
 * SPK Multi-Pass Entropy Refinement Engine - Huffman Rebalancer
 * Creator: OJ Treasure Onazi
 * 
 * Mode B: Adaptive Huffman tree optimization for improved encoding.
 * Best for data with low entropy and uneven symbol distribution.
 */

import {
  HuffmanConfig,
  HuffmanNode,
  HuffmanCode,
  HuffmanAnalysis,
  PassResult,
  DEFAULT_HUFFMAN_CONFIG,
} from './types';

// ============================================================================
// HUFFMAN REBALANCER
// ============================================================================

export class HuffmanRebalancer {
  private config: HuffmanConfig;
  
  // Code tables
  private codes: HuffmanCode[] = [];
  private decodeTable: Map<string, number> = new Map();
  
  // Tree
  private root: HuffmanNode | null = null;
  
  // Analysis
  private lastAnalysis: HuffmanAnalysis | null = null;
  
  // Stats
  private bytesProcessed = 0;

  constructor(config: Partial<HuffmanConfig> = {}) {
    this.config = { ...DEFAULT_HUFFMAN_CONFIG, ...config };
  }

  // ==========================================================================
  // TREE BUILDING
  // ==========================================================================

  /**
   * Build Huffman tree from frequency counts
   */
  buildTree(frequencies: Uint32Array): HuffmanNode {
    // Create leaf nodes for symbols with non-zero frequency
    const nodes: HuffmanNode[] = [];
    
    for (let i = 0; i < 256; i++) {
      if (frequencies[i] >= this.config.minFrequency) {
        nodes.push({
          symbol: i,
          weight: frequencies[i],
        });
      }
    }

    // Handle edge case: no symbols
    if (nodes.length === 0) {
      return { weight: 0 };
    }

    // Handle edge case: single symbol
    if (nodes.length === 1) {
      return {
        weight: nodes[0].weight,
        left: nodes[0],
      };
    }

    // Build tree using min-heap approach
    while (nodes.length > 1) {
      // Sort by weight (simple approach - could use heap for large alphabets)
      nodes.sort((a, b) => a.weight - b.weight);
      
      // Take two smallest
      const left = nodes.shift()!;
      const right = nodes.shift()!;
      
      // Create parent node
      const parent: HuffmanNode = {
        weight: left.weight + right.weight,
        left,
        right,
      };
      
      nodes.push(parent);
    }

    this.root = nodes[0];
    return this.root;
  }

  /**
   * Generate codes from tree
   */
  generateCodes(root: HuffmanNode): HuffmanCode[] {
    this.codes = [];
    this.decodeTable.clear();
    
    const traverse = (node: HuffmanNode, code: number, length: number): void => {
      if (node.symbol !== undefined) {
        // Leaf node
        const huffCode: HuffmanCode = {
          symbol: node.symbol,
          code,
          length,
        };
        this.codes.push(huffCode);
        
        // Build decode string
        const codeStr = code.toString(2).padStart(length, '0');
        this.decodeTable.set(codeStr, node.symbol);
        
        node.code = code;
        node.codeLength = length;
      } else {
        // Internal node
        if (node.left) {
          traverse(node.left, code << 1, length + 1);
        }
        if (node.right) {
          traverse(node.right, (code << 1) | 1, length + 1);
        }
      }
    };

    if (root.symbol !== undefined) {
      // Single symbol tree
      this.codes.push({ symbol: root.symbol, code: 0, length: 1 });
      this.decodeTable.set('0', root.symbol);
    } else {
      traverse(root, 0, 0);
    }

    // Convert to canonical codes if configured
    if (this.config.canonical) {
      this.convertToCanonical();
    }

    return this.codes;
  }

  /**
   * Convert to canonical Huffman codes
   */
  private convertToCanonical(): void {
    // Sort by length, then by symbol
    this.codes.sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return a.symbol - b.symbol;
    });

    // Assign canonical codes
    let code = 0;
    let prevLength = 0;

    this.decodeTable.clear();

    for (const hc of this.codes) {
      if (hc.length > prevLength) {
        code <<= (hc.length - prevLength);
      }
      
      hc.code = code;
      
      const codeStr = code.toString(2).padStart(hc.length, '0');
      this.decodeTable.set(codeStr, hc.symbol);
      
      code++;
      prevLength = hc.length;
    }
  }

  // ==========================================================================
  // ANALYSIS
  // ==========================================================================

  /**
   * Analyze current Huffman tree
   */
  analyzeTree(frequencies: Uint32Array, totalSymbols: number): HuffmanAnalysis {
    if (this.codes.length === 0) {
      return {
        avgCodeLength: 8,
        maxCodeLength: 8,
        symbolCount: 0,
        entropyLimit: 1,
        efficiency: 0,
        isBalanced: true,
        shouldRebalance: false,
      };
    }

    // Calculate average code length
    let weightedLength = 0;
    let maxLength = 0;
    
    for (const code of this.codes) {
      const freq = frequencies[code.symbol] || 0;
      weightedLength += code.length * freq;
      maxLength = Math.max(maxLength, code.length);
    }
    
    const avgCodeLength = totalSymbols > 0 ? weightedLength / totalSymbols : 8;

    // Calculate theoretical entropy limit
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (frequencies[i] > 0) {
        const p = frequencies[i] / totalSymbols;
        entropy -= p * Math.log2(p);
      }
    }

    // Calculate efficiency
    const efficiency = entropy > 0 ? entropy / avgCodeLength : 0;

    // Check if tree is balanced
    const isBalanced = maxLength <= this.config.maxCodeLength;

    // Determine if rebalancing would help
    const inefficiency = avgCodeLength - entropy;
    const shouldRebalance = inefficiency > this.config.rebalanceThreshold * avgCodeLength;

    this.lastAnalysis = {
      avgCodeLength,
      maxCodeLength: maxLength,
      symbolCount: this.codes.length,
      entropyLimit: entropy,
      efficiency,
      isBalanced,
      shouldRebalance,
    };

    return this.lastAnalysis;
  }

  /**
   * Rebalance tree to limit code lengths
   */
  rebalanceTree(frequencies: Uint32Array): HuffmanCode[] {
    // Package-merge algorithm for length-limited codes
    // Simplified version: adjust frequencies to create more balanced tree
    
    const adjustedFreqs = new Uint32Array(frequencies);
    const maxLen = this.config.maxCodeLength;
    
    // Iteratively adjust until codes fit within limit
    for (let attempt = 0; attempt < 10; attempt++) {
      const tree = this.buildTree(adjustedFreqs);
      const codes = this.generateCodes(tree);
      
      let maxCodeLen = 0;
      for (const code of codes) {
        maxCodeLen = Math.max(maxCodeLen, code.length);
      }
      
      if (maxCodeLen <= maxLen) {
        return codes;
      }
      
      // Boost low-frequency symbols to reduce their code length
      for (let i = 0; i < 256; i++) {
        if (adjustedFreqs[i] > 0 && adjustedFreqs[i] < 10) {
          adjustedFreqs[i] = Math.min(adjustedFreqs[i] * 2, frequencies[i] + 10);
        }
      }
    }
    
    return this.codes;
  }

  // ==========================================================================
  // ENCODING
  // ==========================================================================

  /**
   * Encode data using current Huffman codes
   */
  encode(data: Uint8Array): Uint8Array {
    // Build frequency table
    const frequencies = new Uint32Array(256);
    for (let i = 0; i < data.length; i++) {
      frequencies[data[i]]++;
    }

    // Build tree and codes
    const tree = this.buildTree(frequencies);
    this.generateCodes(tree);

    // Check if rebalancing needed
    const analysis = this.analyzeTree(frequencies, data.length);
    if (analysis.shouldRebalance) {
      this.rebalanceTree(frequencies);
    }

    // Create lookup for fast encoding
    const codeLookup: { code: number; length: number }[] = new Array(256);
    for (let i = 0; i < 256; i++) {
      codeLookup[i] = { code: 0, length: 0 };
    }
    for (const hc of this.codes) {
      codeLookup[hc.symbol] = { code: hc.code, length: hc.length };
    }

    // Calculate output size in bits
    let totalBits = 0;
    for (let i = 0; i < data.length; i++) {
      totalBits += codeLookup[data[i]].length;
    }

    // Encode
    const outputBytes = Math.ceil(totalBits / 8);
    const headerSize = this.calculateHeaderSize();
    const output = new Uint8Array(headerSize + outputBytes);
    
    // Write header (code table)
    let pos = this.writeHeader(output, frequencies);

    // Write encoded data
    let bitBuffer = 0;
    let bitsInBuffer = 0;

    for (let i = 0; i < data.length; i++) {
      const { code, length } = codeLookup[data[i]];
      
      if (length === 0) {
        // Symbol not in table (shouldn't happen)
        continue;
      }

      bitBuffer = (bitBuffer << length) | code;
      bitsInBuffer += length;

      while (bitsInBuffer >= 8) {
        bitsInBuffer -= 8;
        output[pos++] = (bitBuffer >> bitsInBuffer) & 0xFF;
      }
    }

    // Flush remaining bits
    if (bitsInBuffer > 0) {
      output[pos++] = (bitBuffer << (8 - bitsInBuffer)) & 0xFF;
    }

    this.bytesProcessed = data.length;
    return output.slice(0, pos);
  }

  /**
   * Calculate header size for code table
   */
  private calculateHeaderSize(): number {
    // Format: 
    // 4 bytes: original size
    // 1 byte: number of symbols
    // For each symbol: 1 byte symbol + 1 byte length
    return 4 + 1 + this.codes.length * 2;
  }

  /**
   * Write header with code table
   */
  private writeHeader(output: Uint8Array, frequencies: Uint32Array): number {
    let pos = 0;
    
    // Original size (4 bytes)
    let total = 0;
    for (let i = 0; i < 256; i++) total += frequencies[i];
    
    output[pos++] = (total >> 24) & 0xFF;
    output[pos++] = (total >> 16) & 0xFF;
    output[pos++] = (total >> 8) & 0xFF;
    output[pos++] = total & 0xFF;
    
    // Number of symbols
    output[pos++] = this.codes.length & 0xFF;
    
    // Symbol-length pairs (for canonical codes, we only need lengths)
    for (const code of this.codes) {
      output[pos++] = code.symbol;
      output[pos++] = code.length;
    }
    
    return pos;
  }

  // ==========================================================================
  // DECODING
  // ==========================================================================

  /**
   * Decode Huffman-encoded data
   */
  decode(encoded: Uint8Array): Uint8Array {
    let pos = 0;

    // Read header
    const originalSize = 
      (encoded[pos++] << 24) |
      (encoded[pos++] << 16) |
      (encoded[pos++] << 8) |
      encoded[pos++];

    const numSymbols = encoded[pos++];

    // Read code table
    const symbols: number[] = [];
    const lengths: number[] = [];
    
    for (let i = 0; i < numSymbols; i++) {
      symbols.push(encoded[pos++]);
      lengths.push(encoded[pos++]);
    }

    // Rebuild canonical codes
    this.codes = [];
    for (let i = 0; i < numSymbols; i++) {
      this.codes.push({
        symbol: symbols[i],
        code: 0, // Will be set by canonical conversion
        length: lengths[i],
      });
    }
    
    if (this.config.canonical) {
      this.convertToCanonical();
    }

    // Build decode tree
    this.buildDecodeTree();

    // Decode data
    const output = new Uint8Array(originalSize);
    let outPos = 0;
    let bitBuffer = 0;
    let bitsInBuffer = 0;

    while (outPos < originalSize && pos < encoded.length) {
      // Fill bit buffer
      while (bitsInBuffer < 24 && pos < encoded.length) {
        bitBuffer = (bitBuffer << 8) | encoded[pos++];
        bitsInBuffer += 8;
      }

      // Decode symbol
      const symbol = this.decodeSymbol(bitBuffer, bitsInBuffer);
      if (symbol.symbol < 0) break;
      
      output[outPos++] = symbol.symbol;
      bitBuffer &= (1 << (bitsInBuffer - symbol.bitsUsed)) - 1;
      bitsInBuffer -= symbol.bitsUsed;
    }

    return output.slice(0, outPos);
  }

  /**
   * Build decode tree from codes
   */
  private buildDecodeTree(): void {
    this.decodeTable.clear();
    
    for (const code of this.codes) {
      const codeStr = code.code.toString(2).padStart(code.length, '0');
      this.decodeTable.set(codeStr, code.symbol);
    }
  }

  /**
   * Decode a single symbol from bit buffer
   */
  private decodeSymbol(bitBuffer: number, bitsAvailable: number): { symbol: number; bitsUsed: number } {
    // Try progressively longer prefixes
    let codeStr = '';
    
    for (let len = 1; len <= Math.min(bitsAvailable, this.config.maxCodeLength); len++) {
      const bit = (bitBuffer >> (bitsAvailable - len)) & 1;
      codeStr += bit.toString();
      
      const symbol = this.decodeTable.get(codeStr);
      if (symbol !== undefined) {
        return { symbol, bitsUsed: len };
      }
    }

    return { symbol: -1, bitsUsed: 0 };
  }

  // ==========================================================================
  // PASS INTERFACE
  // ==========================================================================

  /**
   * Execute Huffman rebalancing pass
   */
  executePass(data: Uint8Array): PassResult {
    const startTime = performance.now();
    const inputSize = data.length;
    const entropyBefore = this.estimateEntropy(data);

    try {
      const encoded = this.encode(data);
      const timeMs = performance.now() - startTime;

      // Verify by decoding
      const decoded = this.decode(encoded);

      // Verify correctness
      let correct = decoded.length === data.length;
      if (correct) {
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== decoded[i]) {
            correct = false;
            break;
          }
        }
      }

      if (!correct) {
        return {
          mode: 'mode-b',
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
      const wasSignificant = ratio < 0.98;

      return {
        mode: 'mode-b',
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
        mode: 'mode-b',
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

    return entropy / 8;
  }

  /**
   * Estimate memory used
   */
  private estimateMemoryUsed(): number {
    let memory = 0;
    
    // Code table
    memory += this.codes.length * 12;
    
    // Decode table (string keys)
    memory += this.decodeTable.size * 20;
    
    return memory;
  }

  /**
   * Get current codes
   */
  getCodes(): HuffmanCode[] {
    return [...this.codes];
  }

  /**
   * Get last analysis
   */
  getLastAnalysis(): HuffmanAnalysis | null {
    return this.lastAnalysis;
  }

  /**
   * Reset state
   */
  reset(): void {
    this.codes = [];
    this.decodeTable.clear();
    this.root = null;
    this.lastAnalysis = null;
    this.bytesProcessed = 0;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createHuffmanRebalancer(config?: Partial<HuffmanConfig>): HuffmanRebalancer {
  return new HuffmanRebalancer(config);
}
