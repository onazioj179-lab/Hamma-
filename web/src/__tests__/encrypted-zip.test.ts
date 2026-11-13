// @vitest-environment node
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

it('rejects encrypted symbolic links and reports an incorrect password', async () => {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  await writer.add('link', new BlobReader(new Blob(['target'])), { password, unixMode: 0o120777 });
  const archive = await writer.close();
  await expect(unlockEncryptedZip(archive, password, signal)).rejects.toThrow('symbolic link');
  const regular = await createEncryptedZip([{ name: 'file.txt', file: new Blob(['data']), directory: false }], password, signal);
  await expect(unlockEncryptedZip(regular, 'incorrect', signal)).rejects.toThrow('password is incorrect');
});

const tar = process.platform === 'win32' ? 'tar' : 'bsdtar';
const libarchive = spawnSync(tar, ['--version'], { encoding: 'utf8' }).stdout?.includes('libarchive');

it.skipIf(!libarchive)('exchanges AES ZIP files with libarchive', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hamma-aes-zip-'));
  const data = new Uint8Array([0, 255, 19, 128, 0]);
  const input = { name: 'file.bin', file: new Blob([data]), directory: false };
  try {
    const encrypted = await createEncryptedZip([input], password, signal);
    writeFileSync(join(root, 'hamma.zip'), new Uint8Array(await encrypted.arrayBuffer()));
    const extracted = spawnSync(tar, ['-xOf', 'hamma.zip', '--passphrase', password, 'file.bin'], { cwd: root });
    expect(extracted.status, extracted.stderr.toString()).toBe(0);
    expect(new Uint8Array(extracted.stdout)).toEqual(data);
    writeFileSync(join(root, 'file.bin'), data);
    const packed = spawnSync(tar, ['-acf', 'external.zip', '--options', 'zip:encryption=aes256', '--passphrase', password, 'file.bin'], { cwd: root });
    expect(packed.status, packed.stderr.toString()).toBe(0);
    const restored = await unlockEncryptedZip(new Blob([readFileSync(join(root, 'external.zip'))]), password, signal);
    writeFileSync(join(root, 'unlocked.zip'), new Uint8Array(await restored.arrayBuffer()));
    const verified = spawnSync(tar, ['-xOf', 'unlocked.zip', 'file.bin'], { cwd: root });
    expect(verified.status, verified.stderr.toString()).toBe(0);
    expect(new Uint8Array(verified.stdout)).toEqual(data);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
