// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryPool } from '../../core/wasm/pool';

// Exercise the worker protocol with a deterministic codec fixture. This suite
// covers message handling and transfers independently of the WASM build.
vi.mock('../../core/wasm/loader', () => ({
  loadWasmModule: vi.fn(async () => ({ memory: new WebAssembly.Memory({ initial: 1 }), exports: { reset: vi.fn() } })),
}));

vi.mock('../../core/wasm/wrappers', async () => {
  const { deflateSync, inflateSync } = await import('fflate');
  return {
    compressChunk: vi.fn((_core, pool: MemoryPool, input: Uint8Array) => {
      if (!input.length) throw new Error('Empty fixture input');
      // The one-byte fixture deliberately leaves a live allocation.
      if (input.length === 1 && input[0] === 0xa5) pool.alloc(1);
      const data = deflateSync(input);
      return { data, bytesIn: input.length, bytesOut: data.length, ratio: data.length / input.length };
    }),
    decompressChunk: vi.fn((_core, _pool, input: Uint8Array) => inflateSync(input)),
    flushArchive: vi.fn(() => new Uint8Array()),
    finalizeArchive: vi.fn(() => Uint8Array.of(1, 2, 3)),
    resetCompression: vi.fn(),
    safeWasmCall: (call: () => unknown) => call(),
  };
});

type Message = { type: string } & Record<string, unknown>;
type Reply = Message & { buffer?: ArrayBuffer; footer?: ArrayBuffer };

async function loadWorker(kind: 'compress' | 'decompress') {
  const replies: Reply[] = [];
  const scope = {
    onmessage: undefined as ((event: { data: Message }) => Promise<void>) | undefined,
    postMessage: (message: Reply, transfer: ArrayBuffer[] = []) => {
      replies.push(structuredClone(message, { transfer }));
    },
  };
  vi.stubGlobal('self', scope);
  if (kind === 'compress') await import('../compressionWorker');
  else await import('../decompressionWorker');
  expect(replies.shift()).toMatchObject({ type: 'worker-loaded' });
  const handler = scope.onmessage;
  if (!handler) throw new Error('Worker did not register a message handler');
  return async (data: Message) => {
    vi.stubGlobal('self', scope);
    replies.length = 0;
    await handler({ data });
    return replies.slice();
  };
}

const init = { type: 'init-wasm', blockSize: 4096 };
const chunk = (index: number, buffer: ArrayBuffer, fileId?: string) => ({ type: 'process-chunk', index, buffer, fileId });

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('compression worker messages', () => {
  it('initializes and reports its configured block size', async () => {
    const send = await loadWorker('compress');
    expect(await send(init)).toEqual([expect.objectContaining({ type: 'wasm-ready', blockSize: 4096 })]);
  });

  it.each([1024, 1024 ** 2, 10 * 1024 ** 2])('processes a %i-byte chunk with a transferable result', async size => {
    const send = await loadWorker('compress');
    await send(init);
    const [reply] = await send(chunk(7, new Uint8Array(size).fill(42).buffer, 'sample'));
    expect(reply).toMatchObject({ type: 'chunk-processed', index: 7, bytesIn: size, fileId: 'sample' });
    expect(reply.buffer?.byteLength).toBeGreaterThan(0);
    expect(reply.buffer?.byteLength).toBeLessThan(size);
  });

  it('reports progress, flushes and finalizes with consistent counters', async () => {
    const send = await loadWorker('compress');
    await send(init);
    for (let index = 0; index < 9; index++) await send(chunk(index, new ArrayBuffer(32)));
    expect(await send(chunk(9, new ArrayBuffer(32)))).toContainEqual(expect.objectContaining({ type: 'progress' }));
    expect(await send({ type: 'flush' })).toEqual([expect.objectContaining({ type: 'flush-complete', bytesOut: 0 })]);
    const [final] = await send({ type: 'finalize' });
    expect(final).toMatchObject({ type: 'finalize-complete', table: { totalChunks: 10, totalBytesIn: 320 } });
    expect(new Uint8Array(final.footer!)).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('resets on cancel and processes the same chunk deterministically', async () => {
    const send = await loadWorker('compress');
    await send(init);
    const input = Uint8Array.of(1, 2, 3).buffer;
    const [first] = await send(chunk(1, input));
    expect(await send({ type: 'cancel' })).toEqual([expect.objectContaining({ type: 'cancelled' })]);
    const [second] = await send(chunk(2, input));
    expect(second.buffer).toEqual(first.buffer);
    const [final] = await send({ type: 'finalize' });
    expect(final).toMatchObject({ stats: { chunksProcessed: 1 } });
  });

  it('recovers from a rejected chunk and reports an unknown message', async () => {
    const send = await loadWorker('compress');
    await send(init);
    expect(await send(chunk(1, new ArrayBuffer(0)))).toEqual([
      expect.objectContaining({ type: 'error', index: 1, recoverable: true }),
    ]);
    expect(await send(chunk(2, new ArrayBuffer(32)))).toEqual([
      expect.objectContaining({ type: 'chunk-processed', index: 2 }),
    ]);
    expect(await send({ type: 'invalid-type' })).toEqual([
      expect.objectContaining({ type: 'error', message: expect.stringContaining('Unknown message type') }),
    ]);
  });

  it('warns when a codec call leaves a block allocated', async () => {
    const send = await loadWorker('compress');
    await send(init);
    for (let index = 0; index < 99; index++) await send(chunk(index, new ArrayBuffer(32)));
    expect(await send(chunk(99, Uint8Array.of(0xa5).buffer))).toContainEqual(expect.objectContaining({
      type: 'warning', message: 'Memory leaks detected in worker', stats: expect.objectContaining({ usedBlocks: 1 }),
    }));
  });

  it('preserves chunk IDs and counters across 100 sequential requests', async () => {
    const send = await loadWorker('compress');
    await send(init);
    for (let index = 0; index < 100; index++) {
      const [reply] = await send(chunk(index, new Uint8Array(1024).fill(index).buffer));
      expect(reply).toMatchObject({ type: 'chunk-processed', index, bytesIn: 1024 });
    }
    const [final] = await send({ type: 'finalize' });
    expect(final).toMatchObject({ table: { totalChunks: 100, totalBytesIn: 102400 } });
  });
});

describe('decompression worker messages', () => {
  it('round-trips bytes between the two worker handlers', async () => {
    const compress = await loadWorker('compress');
    const decompress = await loadWorker('decompress');
    await compress(init);
    await decompress(init);
    const original = Uint8Array.of(1, 2, 3, 4, 5);
    const [packed] = await compress(chunk(1, original.buffer));
    const [restored] = await decompress(chunk(1, packed.buffer!));
    expect(restored).toMatchObject({ type: 'chunk-processed', index: 1, bytesOut: original.length });
    expect(new Uint8Array(restored.buffer!)).toEqual(original);
  });

  it('updates selection, excludes unselected chunks and acknowledges prefetch', async () => {
    const send = await loadWorker('decompress');
    await send(init);
    expect(await send({ type: 'set-selection', fileIds: ['selected'] })).toEqual([
      expect.objectContaining({ type: 'selection-updated', selectedCount: 1 }),
    ]);
    expect(await send(chunk(2, new ArrayBuffer(0), 'excluded'))).toEqual([
      expect.objectContaining({ type: 'chunk-skipped', index: 2, reason: 'not-selected' }),
    ]);
    expect(await send({ type: 'prefetch-hint', nextIndex: 3 })).toEqual([
      expect.objectContaining({ type: 'prefetch-acknowledged', nextIndex: 3 }),
    ]);
  });

  it('rejects corrupt compressed data with the failing chunk index', async () => {
    const send = await loadWorker('decompress');
    await send(init);
    expect(await send(chunk(8, Uint8Array.of(255, 255, 255, 255).buffer))).toEqual([
      expect.objectContaining({ type: 'error', index: 8, message: expect.stringContaining('decompression failed') }),
    ]);
  });
});
