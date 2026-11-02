// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AdaptiveEngine } from '../engine/adaptive-engine';
import type { CompressionStrategy } from '../engine/capability-detector';

const samples = [
  new Uint8Array(),
  new Uint8Array([255]),
  new TextEncoder().encode('Round-trip integrity — 日本語\n'.repeat(300)),
  Uint8Array.from({ length: 8193 }, (_, i) => (i * 73 + (i >> 3)) & 255),
];

describe('public archive API integrity', () => {
  it.each([1, 6, 10])('restores every byte at compression level %s', async level => {
    for (const source of samples) {
      const engine = new AdaptiveEngine({ forceStrategy: 'main-js', compressionLevel: level });
      const compressed = await engine.compress(source, 'fixture.bin');
      expect(compressed.success, compressed.error).toBe(true);
      const restored = await new AdaptiveEngine().decompress(compressed.data!);
      expect(restored.success, restored.error).toBe(true);
      expect(restored.data).toEqual(source);
    }
  });

  it.each(['main-js', 'worker-js', 'main-wasm', 'worker-wasm', 'streaming', 'minimal'] as CompressionStrategy[])(
    'produces restorable archives using %s', async strategy => {
      const engine = new AdaptiveEngine({ forceStrategy: strategy });
      const source = samples[2];
      const compressed = await engine.compress(source);
      expect(compressed.success, compressed.error).toBe(true);
      const restored = await new AdaptiveEngine().decompress(compressed.data!);
      expect(restored.success, restored.error).toBe(true);
      expect(restored.data).toEqual(source);
    },
  );

  it('rejects unknown and truncated archives', async () => {
    for (const bytes of [new Uint8Array(), new Uint8Array([1, 2, 3]), new TextEncoder().encode('SPKX')]) {
      expect((await new AdaptiveEngine().decompress(bytes)).success).toBe(false);
    }
  });

  it.each([6, 10])('rejects corrupted, truncated, and oversized metadata at level %s', async compressionLevel => {
    const compressed = await new AdaptiveEngine({ forceStrategy: 'main-js', compressionLevel }).compress(samples[2]);
    const archive = compressed.data as Uint8Array;
    const corrupt = archive.slice(); corrupt[64] ^= 1;
    const oversized = archive.slice(); new DataView(oversized.buffer).setBigUint64(8, 2n ** 60n, true);
    const wrongVersion = archive.slice(); wrongVersion[4] = 255;
    for (const invalid of [corrupt, archive.slice(0, -1), oversized, wrongVersion]) {
      expect((await new AdaptiveEngine().decompress(invalid)).success).toBe(false);
    }
  });
});
