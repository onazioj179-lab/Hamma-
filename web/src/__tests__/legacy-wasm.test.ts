import { describe, expect, it } from 'vitest';
import { getSpkWasm, isWasmLoaded, loadSpkWasm } from '../wasm/loader';

describe('retired V24 engine', () => {
  it('rejects requests instead of producing a lossy mock archive', async () => {
    await expect(loadSpkWasm()).rejects.toThrow('legacy V24');
    expect(() => getSpkWasm()).toThrow('legacy V24');
    expect(isWasmLoaded()).toBe(false);
  });
});
