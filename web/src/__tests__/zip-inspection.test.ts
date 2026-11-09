import { zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import { inspectZip } from '../processing/zip-inspection';

function fixture() {
  return new Uint8Array(zipSync({ 'folder/世界.txt': new Uint8Array([1, 2, 3]) }, { level: 0 }));
}

it('reads only the bounded tail and central directory and lists UTF-8 metadata', async () => {
  const bytes = new Uint8Array(zipSync({ 'folder/世界.txt': new Uint8Array(300_000) }, { level: 0 }));
  const file = new Blob([bytes]);
  const slice = vi.spyOn(file, 'slice');
  await expect(inspectZip(file)).resolves.toEqual([{ name: 'folder/世界.txt', size: 300_000, packedSize: 300_000, encrypted: false }]);
  expect(slice.mock.calls[0][0]).toBeGreaterThan(200_000);
  expect(slice.mock.calls[1][0]).toBeGreaterThan(300_000);
});

it('rejects forged counts and truncated records', async () => {
  const bytes = fixture();
  const footer = bytes.length - 22;
  const view = new DataView(bytes.buffer);
  view.setUint16(footer + 8, 0, true);
  view.setUint16(footer + 10, 0, true);
  await expect(inspectZip(new Blob([bytes]))).rejects.toThrow('Invalid ZIP directory');
  await expect(inspectZip(new Blob([fixture().slice(0, -1)]))).rejects.toThrow('Invalid ZIP directory');
});

it('rejects an over-budget directory before reading it', async () => {
  const bytes = fixture();
  const footer = bytes.length - 22;
  new DataView(bytes.buffer).setUint32(footer + 12, 3 * 1024 * 1024, true);
  const file = new Blob([bytes]);
  const slice = vi.spyOn(file, 'slice');
  await expect(inspectZip(file)).rejects.toThrow('preview limit');
  expect(slice).toHaveBeenCalledTimes(1);
});
