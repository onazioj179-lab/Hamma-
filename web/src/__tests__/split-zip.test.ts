// @vitest-environment node
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
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
