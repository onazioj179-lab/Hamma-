// @vitest-environment node
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { expect, it } from 'vitest';
import { createEncryptedZip, unlockEncryptedZip } from '../processing/encrypted-zip';

const password = 'test fixture password';
const signal = new AbortController().signal;

it('creates authenticated AES ZIP entries and restores exact bytes and folders', async () => {
  const data = new Uint8Array([0, 1, 128, 255]);
  const encrypted = await createEncryptedZip([
    { name: 'nested/data.bin', file: new Blob([data]), directory: false },
    { name: 'empty/', file: null, directory: true },
  ], password, signal);
  const reader = new ZipReader(new BlobReader(encrypted));
  try {
    const [entry] = await reader.getEntries();
    expect(entry.encrypted).toBe(true);
    expect(entry.zipCrypto).toBe(false);
  } finally {
    await reader.close();
  }
  await expect(unlockEncryptedZip(encrypted, 'wrong password', signal)).rejects.toThrow();
  const damaged = new Uint8Array(await encrypted.arrayBuffer());
  const header = new DataView(damaged.buffer);
  const payloadStart = 30 + header.getUint16(26, true) + header.getUint16(28, true);
  damaged[payloadStart + 18] ^= 1; // First ciphertext byte after the AES-256 salt and verifier.
  await expect(unlockEncryptedZip(new Blob([damaged]), password, signal)).rejects.toThrow();
  const unlocked = await unlockEncryptedZip(encrypted, password, signal);
  const restored = new ZipReader(new BlobReader(unlocked));
  try {
    const entries = await restored.getEntries();
    expect(entries.map(entry => entry.filename)).toEqual(['nested/data.bin', 'empty/']);
    const [entry] = entries;
    if (entry.directory) throw new Error('Expected a file');
    expect(entry.encrypted).toBe(false);
    expect(new Uint8Array(await (await entry.getData(new BlobWriter())).arrayBuffer())).toEqual(data);
  } finally {
    await restored.close();
  }
});

it('rejects ZIPs with case-insensitive path collisions', async () => {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const name of ['Data.txt', 'data.txt']) {
    await writer.add(name, new BlobReader(new Blob(['fixture'])), { password });
  }
  await expect(unlockEncryptedZip(await writer.close(), password, signal)).rejects.toThrow('duplicate path');
});
