// @vitest-environment node
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { createEncryptedZip, unlockEncryptedZip, ENCRYPTED_ZIP_LIMIT } from '../processing/encrypted-zip';
import { inspectZip } from '../processing/zip-inspection';

const signal = new AbortController().signal;
const password = 'workspace test password';
const bytes = new Uint8Array([0, 255, 19, 128, 0]);

it('creates AES ZIPs and verifies exact content before unlocking to a portable ZIP', async () => {
  const file = new File([bytes], 'file.bin');
  const archive = await createEncryptedZip([
    { id: 'file', name: 'nested/file.bin', size: file.size, directory: false, file },
    { id: 'dir', name: 'empty/', size: 0, directory: true, file: null },
  ], password, signal);
  const directory = await inspectZip(archive);
  expect(directory.members.map(entry => [entry.name, entry.encrypted])).toEqual([
    ['nested/file.bin', true], ['empty/', false],
  ]);
  await expect(unlockEncryptedZip(archive, 'incorrect password', signal)).rejects.toThrow('password is incorrect');
  const unlocked = await unlockEncryptedZip(archive, password, signal);
  const reader = new ZipReader(new BlobReader(unlocked), { useWebWorkers: false });
  const [entry, empty] = await reader.getEntries();
  expect(empty.directory).toBe(true);
  expect(entry.encrypted).toBe(false);
  if (entry.directory) throw new Error('Expected file');
  const restored = await entry.getData(new BlobWriter(), { checkCrc32: true });
  expect(new Uint8Array(await restored.arrayBuffer())).toEqual(bytes);
  await reader.close();
});

it('rejects unsafe paths, legacy ZIP encryption, and oversized archives', async () => {
  const file = new File([bytes], 'file.bin');
  await expect(createEncryptedZip([{ id: 'file', name: '../file.bin', size: file.size, directory: false, file }],
    password, signal)).rejects.toThrow('unsafe path');
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  await writer.add('file.bin', new BlobReader(file), { password, zipCrypto: true, level: 0 });
  await expect(unlockEncryptedZip(await writer.close(), password, signal)).rejects.toThrow('unsupported entry type');
  await expect(unlockEncryptedZip({ size: ENCRYPTED_ZIP_LIMIT + 1 } as Blob, password, signal)).rejects.toThrow('64 MiB');
});

const tar = process.platform === 'win32' ? 'tar' : 'bsdtar';
const libarchive = spawnSync(tar, ['--version'], { encoding: 'utf8' }).stdout?.includes('libarchive');

it.skipIf(!libarchive)('exchanges AES ZIP files with libarchive', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hamma-aes-zip-'));
  const original = new File([bytes], 'file.bin');
  const source = { id: 'file', name: original.name, size: original.size, directory: false, file: original };
  try {
    const encrypted = await createEncryptedZip([source], password, signal);
    writeFileSync(join(root, 'hamma.zip'), new Uint8Array(await encrypted.arrayBuffer()));
    const extracted = spawnSync(tar, ['-xOf', 'hamma.zip', '--passphrase', password, 'file.bin'], { cwd: root });
    expect(extracted.status, extracted.stderr.toString()).toBe(0);
    expect(new Uint8Array(extracted.stdout)).toEqual(bytes);

    writeFileSync(join(root, 'file.bin'), bytes);
    const packed = spawnSync(tar, ['-acf', 'external.zip', '--options', 'zip:encryption=aes256', '--passphrase', password, 'file.bin'], { cwd: root });
    expect(packed.status, packed.stderr.toString()).toBe(0);
    const restored = await unlockEncryptedZip(new Blob([readFileSync(join(root, 'external.zip'))]), password, signal);
    writeFileSync(join(root, 'unlocked.zip'), new Uint8Array(await restored.arrayBuffer()));
    const verified = spawnSync(tar, ['-xOf', 'unlocked.zip', 'file.bin'], { cwd: root });
    expect(verified.status, verified.stderr.toString()).toBe(0);
    expect(new Uint8Array(verified.stdout)).toEqual(bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
