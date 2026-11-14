// @vitest-environment node
import { BlobReader, BlobWriter, SplitDataReader, ZipReader } from '@zip.js/zip.js';
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSplitZip, joinSplitZip } from '../processing/split-zip';

it('creates a native split ZIP and joins its volumes in filename order', async () => {
  const data = new Uint8Array(2 * 1024 * 1024 + 15);
  data[0] = 13;
  data[data.length - 1] = 254;
  const signal = new AbortController().signal;
  const volumes = await createSplitZip([
    { name: 'folder/file.bin', file: new Blob([data]), directory: false },
    { name: 'empty/', file: null, directory: true },
  ], 1, signal);
  expect(volumes.map(volume => volume.name)).toEqual(['archive.z01', 'archive.z02', 'archive.zip']);
  expect(volumes.every(volume => volume.blob.size <= 1024 * 1024)).toBe(true);
  const files = volumes.map(({ blob, name }) => new File([blob], name));
  await expect(joinSplitZip([files[0], files[2]], signal)).rejects.toThrow('does not match');
  await expect(joinSplitZip([files[0], files[0], files[2]], signal)).rejects.toThrow('duplicate');
  const joined = await joinSplitZip([...files].reverse(), signal);
  const reader = new ZipReader(new BlobReader(joined));
  try {
    const entries = await reader.getEntries();
    expect(entries.map(entry => entry.filename)).toEqual(['folder/file.bin', 'empty/']);
    const [entry] = entries;
    if (entry.directory) throw new Error('Expected a file');
    const blob = await entry.getData(new BlobWriter());
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data);
  } finally {
    await reader.close();
  }
});

it('creates AES-256 split volumes and requires a valid password before joining', async () => {
  const data = new Uint8Array(1024 * 1024 + 19);
  data.set([0, 255, 13]);
  data[data.length - 1] = 254;
  const password = 'split archive fixture password';
  const signal = new AbortController().signal;
  const volumes = await createSplitZip([
    { name: 'folder/file.bin', file: new Blob([data]), directory: false },
    { name: 'empty/', file: null, directory: true },
  ], 1, signal, password);
  expect(volumes.map(volume => volume.name)).toEqual(['archive.z01', 'archive.zip']);
  const reader = new ZipReader(new SplitDataReader(volumes.map(({ blob }) => new BlobReader(blob))));
  try {
    const [entry, directory] = await reader.getEntries();
    expect(entry).toMatchObject({ encrypted: true, zipCrypto: false, extraFieldAES: { strength: 3 } });
    expect(directory).toMatchObject({ directory: true, encrypted: false });
  } finally {
    await reader.close();
  }
  const files = volumes.map(({ blob, name }) => new File([blob], name));
  await expect(joinSplitZip(files, signal)).rejects.toThrow('Enter the password');
  await expect(joinSplitZip(files, signal, 'incorrect')).rejects.toThrow('password is incorrect');

  const damaged = new Uint8Array(await files[0].arrayBuffer());
  damaged[512] ^= 1;
  await expect(joinSplitZip([new File([damaged], files[0].name), files[1]], signal, password))
    .rejects.toThrow('ZIP data is damaged');

  const joined = await joinSplitZip([...files].reverse(), signal, password);
  const joinedReader = new ZipReader(new BlobReader(joined));
  try {
    const entries = await joinedReader.getEntries();
    expect(entries.map(entry => entry.filename)).toEqual(['folder/file.bin', 'empty/']);
    expect(entries.every(entry => !entry.encrypted)).toBe(true);
    const [entry] = entries;
    if (entry.directory) throw new Error('Expected a file');
    const blob = await entry.getData(new BlobWriter(), { checkCrc32: true });
    expect(Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(data))).toBe(true);
  } finally {
    await joinedReader.close();
  }
});

const infoZipAvailable = spawnSync('zip', ['-v']).status === 0 && spawnSync('unzip', ['-v']).status === 0;
it.skipIf(!infoZipAvailable)('interoperates with Info-ZIP split and join in both directions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hamma-split-'));
  const data = new Uint8Array(1024 * 1024 + 19);
  data[0] = 13;
  data[data.length - 1] = 254;
  const signal = new AbortController().signal;
  function run(command: string, args: string[]) {
    const result = spawnSync(command, args, { cwd: directory, maxBuffer: 4 * 1024 * 1024 });
    expect(result.status, result.stderr?.toString()).toBe(0);
    return result.stdout;
  }
  try {
    writeFileSync(join(directory, 'input.bin'), data);
    run('zip', ['-0', '-s', '512k', 'external.zip', 'input.bin']);
    const files = readdirSync(directory).filter(name => name.startsWith('external.'));
    const joined = await joinSplitZip(files.map(name => new File([new Uint8Array(readFileSync(join(directory, name)))], name)), signal);
    writeFileSync(join(directory, 'joined.zip'), new Uint8Array(await joined.arrayBuffer()));
    expect(new Uint8Array(run('unzip', ['-p', 'joined.zip', 'input.bin']))).toEqual(data);
    const volumes = await createSplitZip([{ name: 'input.bin', file: new Blob([data]), directory: false }], 1, signal);
    for (const { name, blob } of volumes) {
      writeFileSync(join(directory, name), new Uint8Array(await blob.arrayBuffer()));
    }
    run('zip', ['-s', '0', 'archive.zip', '--out', 'combined.zip']);
    expect(new Uint8Array(run('unzip', ['-p', 'combined.zip', 'input.bin']))).toEqual(data);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);


it.skipIf(!infoZipAvailable)('joins and unlocks a legacy split archive created by Info-ZIP', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hamma-legacy-split-'));
  const data = new Uint8Array(1024 * 1024 + 19);
  data.set([19, 0, 255]);
  data[data.length - 1] = 29;
  const password = 'legacy split fixture password';
  try {
    writeFileSync(join(directory, 'input.bin'), data);
    const packed = spawnSync('zip', ['-0', '-s', '512k', '-P', password, 'legacy.zip', 'input.bin'], {
      cwd: directory,
    });
    expect(packed.status, packed.stderr?.toString()).toBe(0);
    const files = readdirSync(directory).filter(name => name.startsWith('legacy.')).map(name =>
      new File([Uint8Array.from(readFileSync(join(directory, name)))], name));
    expect(files.length).toBeGreaterThan(1);
    const output = await joinSplitZip(files, new AbortController().signal, password);
    writeFileSync(join(directory, 'joined.zip'), new Uint8Array(await output.arrayBuffer()));
    const verified = spawnSync('unzip', ['-p', 'joined.zip', 'input.bin'], {
      cwd: directory, maxBuffer: 4 * 1024 * 1024,
    });
    expect(verified.status, verified.stderr?.toString()).toBe(0);
    expect(verified.stdout.equals(Buffer.from(data))).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
