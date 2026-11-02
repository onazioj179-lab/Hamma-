// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { archivePath, restoreFileArchive, validateFilePaths } from '../utils/archiveFiles';
import { AdaptiveEngine } from '../engine/adaptive-engine';

function container(type: string, files: { name: string; data: Uint8Array }[], payload?: Uint8Array) {
  let offset = 0;
  const entries = files.map(file => { const entry = { name: file.name, size: file.data.length, offset }; offset += file.data.length; return entry; });
  const manifest = new TextEncoder().encode(JSON.stringify({ version: 1, type, fileCount: files.length, files: entries }));
  const body = payload ?? Uint8Array.from(files.flatMap(file => Array.from(file.data)));
  const output = new Uint8Array(4 + manifest.length + body.length);
  new DataView(output.buffer).setUint32(0, manifest.length, true);
  output.set(manifest, 4); output.set(body, 4 + manifest.length);
  return output;
}
const files = [{ name: 'folder/日本語.txt', data: new TextEncoder().encode('lossless content') }, { name: 'empty.bin', data: new Uint8Array() }];
const decode = async (bytes: Uint8Array) => {
  const result = await new AdaptiveEngine().decompress(bytes);
  if (!result.success) throw Error(result.error);
  return result.data as Uint8Array;
};

describe('multi-file restoration', () => {
  it('restores names, folders, empty files and exact bytes to ZIP', async () => {
    const zip = await restoreFileArchive(container('multi-file', files), decode);
    const restored = unzipSync(zip!);
    for (const file of files) expect(restored[file.name]).toEqual(file.data);
  });
  it('restores independently compressed streaming chunks', async () => {
    const frames: number[] = [];
    for (const file of files) {
      const compressed = await new AdaptiveEngine({ compressionLevel: 10 }).compress(file.data);
      const data = compressed.data as Uint8Array;
      const header = new Uint8Array(4); new DataView(header.buffer).setUint32(0, data.length, true);
      frames.push(...header, ...data);
    }
    frames.push(...new TextEncoder().encode('SPK_END'));
    const zip = await restoreFileArchive(container('multi-file-stream', files, new Uint8Array(frames)), decode);
    const restored = unzipSync(zip!);
    for (const file of files) expect(restored[file.name]).toEqual(file.data);
  });
  it('fails on truncation or duplicate names instead of dropping files', async () => {
    await expect(restoreFileArchive(container('multi-file', files).slice(0, -1), decode)).rejects.toThrow();
    await expect(restoreFileArchive(container('multi-file', [files[0], files[0]]), decode)).rejects.toThrow('Duplicate');
    expect(() => validateFilePaths([{ name:'same' }, { name:'same' }] as File[])).toThrow('Duplicate');
  });
  it.each(['../escape', '/absolute', 'C:\\absolute', 'a/../escape', 'a//b', 'a\0b'])('rejects unsafe path %s', path => {
    expect(() => archivePath(path)).toThrow('Invalid archive path');
  });
  it('leaves ordinary single-file data unchanged', async () => {
    expect(await restoreFileArchive(new TextEncoder().encode('ordinary content'), decode)).toBeNull();
  });
});
