import { zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import { inspectZip } from '../processing/zip-inspection';

function fixture() {
  return new Uint8Array(zipSync({ 'folder/世界.txt': new Uint8Array([1, 2, 3]) }, { level: 0 }));
}

function zip64Fixture() {
  const original = fixture();
  const footer = original.length - 22;
  const offset = new DataView(original.buffer).getUint32(footer + 16, true);
  const bytes = new Uint8Array(original.length + 20 + 76);
  bytes.set(original.subarray(0, footer));
  const view = new DataView(bytes.buffer);
  view.setUint32(offset + 20, 0xffffffff, true);
  view.setUint32(offset + 24, 0xffffffff, true);
  view.setUint16(offset + 30, 20, true);
  view.setUint16(footer, 1, true);
  view.setUint16(footer + 2, 16, true);
  view.setBigUint64(footer + 4, 5_000_000_000n, true);
  view.setBigUint64(footer + 12, 3n, true);
  const end = footer + 20;
  const locator = end + 56;
  view.setUint32(end, 0x06064b50, true);
  view.setBigUint64(end + 4, 44n, true);
  view.setBigUint64(end + 24, 1n, true);
  view.setBigUint64(end + 32, 1n, true);
  view.setBigUint64(end + 40, BigInt(end - offset), true);
  view.setBigUint64(end + 48, BigInt(offset), true);
  view.setUint32(locator, 0x07064b50, true);
  view.setBigUint64(locator + 8, BigInt(end), true);
  view.setUint32(locator + 16, 1, true);
  bytes.set(original.subarray(footer), locator + 20);
  return { bytes, end, footer };
}

it('reads ZIP64 sizes and footer even when the classic footer has ordinary fields', async () => {
  const { bytes } = zip64Fixture();
  await expect(inspectZip(new Blob([bytes]))).resolves.toEqual({ comment: '', members: [
    { name: 'folder/世界.txt', size: 5_000_000_000, packedSize: 3, encrypted: false },
  ] });
});

it('rejects truncated ZIP64 member fields and oversized ZIP64 directories', async () => {
  const { bytes, end, footer } = zip64Fixture();
  const view = new DataView(bytes.buffer);
  view.setUint16(footer + 2, 8, true);
  await expect(inspectZip(new Blob([bytes]))).rejects.toThrow('Invalid ZIP directory');
  view.setBigUint64(end + 40, 3n * 1024n * 1024n, true);
  const file = new Blob([bytes]);
  const slice = vi.spyOn(file, 'slice');
  await expect(inspectZip(file)).rejects.toThrow('preview limit');
  expect(slice).toHaveBeenCalledTimes(1);
});

it('reads only the bounded tail and central directory and lists UTF-8 metadata', async () => {
  const bytes = new Uint8Array(zipSync({ 'folder/世界.txt': new Uint8Array(300_000) }, { level: 0 }));
  const file = new Blob([bytes]);
  const slice = vi.spyOn(file, 'slice');
  await expect(inspectZip(file)).resolves.toEqual({
    comment: '', members: [{ name: 'folder/世界.txt', size: 300_000, packedSize: 300_000, encrypted: false }],
  });
  expect(slice.mock.calls[0][0]).toBeGreaterThan(200_000);
  expect(slice.mock.calls[1][0]).toBeGreaterThan(300_000);
});

it('shows a bounded archive comment preview with nonprintable bytes escaped', async () => {
  const bytes = fixture();
  const comment = new Uint8Array(5000).fill(0x61);
  comment.set([0xff, 0x00]);
  new DataView(bytes.buffer).setUint16(bytes.length - 2, comment.length, true);
  const result = await inspectZip(new Blob([bytes, comment]));
  expect(result.comment).toBe('\\xff\\x00' + 'a'.repeat(4094) + '…');
  expect(result.members).toHaveLength(1);
});

it('reads bounded UTF-8 and legacy file comments without opening payloads', async () => {
  const firstComment = 'a'.repeat(4095) + 'é' + 'more';
  const bytes = new Uint8Array(zipSync({
    'folder/世界.txt': [new Uint8Array(300_000), { level: 0, comment: firstComment }],
    'safe.txt': [new Uint8Array([1]), { comment: 'Visiblé\u202e\u0000' }],
    'legacy.txt': [new Uint8Array([2]), { comment: 'é' }],
    'plain.txt': new Uint8Array([3]),
  }));
  const view = new DataView(bytes.buffer);
  const offset = view.getUint32(bytes.length - 6, true);
  // A ZIP writer outside UTF-8 mode can store the same bytes as a legacy comment.
  const second = offset + 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  const third = second + 46 + view.getUint16(second + 28, true) + view.getUint16(second + 30, true) + view.getUint16(second + 32, true);
  view.setUint16(third + 8, view.getUint16(third + 8, true) & ~0x800, true);
  const file = new Blob([bytes]);
  const slice = vi.spyOn(file, 'slice');
  const { members } = await inspectZip(file);
  expect(members.map(member => member.comment)).toEqual([
    'a'.repeat(4095) + '…', 'Visiblé\uFFFD\uFFFD', '\\xc3\\xa9', undefined,
  ]);
  expect(slice).toHaveBeenCalledTimes(2);
  expect(slice.mock.calls[1][0]).toBe(offset);
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
