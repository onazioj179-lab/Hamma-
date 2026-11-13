import { expect, it, vi } from 'vitest';
import { droppedSources, readFolder, type FolderEntry } from '../processing/folders';

type Child = FolderEntry | { kind: 'file'; name: string; getFile(): Promise<File> };
const folder = (name: string, children: Child[] = []): FolderEntry => ({
  kind: 'directory', name,
  async *values() { yield* children; },
});
const file = (name: string) => ({ kind: 'file' as const, name, getFile: async () => new File(['contents'], name) });

const droppedFolder = (path: string, children: FileSystemEntry[] = []) => ({
  isDirectory: true, fullPath: path, createReader() {
    let remaining = children;
    return { readEntries(resolve: (entries: FileSystemEntry[]) => void) {
      const batch = remaining.slice(0, 100);
      remaining = remaining.slice(batch.length);
      resolve(batch);
    } };
  },
} as FileSystemDirectoryEntry);
const transfer = (entries: FileSystemEntry[], files: File[] = []) => ({
  items: entries.map(entry => ({ webkitGetAsEntry: () => entry })), files,
} as unknown as DataTransfer);

it('preserves the selected root, nested paths, Unicode and empty folders', async () => {
  const rows = await readFolder(folder('Photos', [file('été.txt'), folder('nested', [file('same.txt')]), folder('empty')]));
  expect(rows.map(row => row.name)).toEqual(['Photos/été.txt', 'Photos/nested/same.txt', 'Photos/empty/']);
  expect(rows[0].file?.name).toBe('été.txt');
  expect(rows[2]).toMatchObject({ directory: true, file: null, size: 0 });
});

it('retains a completely empty selected folder', async () => {
  expect(await readFolder(folder('empty'))).toEqual([expect.objectContaining({ name: 'empty/', directory: true })]);
});

it('rejects oversized and excessively nested trees without returning a partial selection', async () => {
  await expect(readFolder(folder('root', [file('a'), file('b')]), 1)).rejects.toThrow('Nothing was added');
  let deep = folder('leaf');
  for (let index = 0; index < 65; index++) deep = folder(String(index), [deep]);
  await expect(readFolder(deep)).rejects.toThrow('nesting limit');
});

it('rejects unreadable and aborted selections', async () => {
  await expect(readFolder(folder('root', [file('first'), { kind: 'file', name: 'locked', getFile: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }]))).rejects.toThrow('Denied');
  const controller = new AbortController(); controller.abort();
  await expect(readFolder(folder('root'), 5000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('cancels promptly while a cloud file provider is still pending', async () => {
  let release!: (file: File) => void;
  const pending = new Promise<File>(resolve => { release = resolve; });
  const controller = new AbortController();
  const reading = readFolder(folder('cloud', [{ kind: 'file', name: 'pending.txt', getFile: () => pending }]), 5000, controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  release(new File(['late'], 'pending.txt'));
});

it('preserves empty folders and rejects oversized flat drops atomically', async () => {
  const drop = transfer([droppedFolder('/folder/empty')]);
  expect(await droppedSources(drop)).toEqual([expect.objectContaining({
    name: 'folder/empty/', directory: true, file: null, size: 0,
  })]);
  await expect(droppedSources(transfer([], [new File(['a'], 'a'), new File(['b'], 'b')]), 1))
    .rejects.toThrow('Nothing was added');
});

it('bounds visits to nonempty directories across drag-and-drop reader pages', async () => {
  const tail = vi.fn();
  const tree = Array.from({ length: 130 }, (_, index) => {
    const path = '/root/' + index;
    return droppedFolder(path, [droppedFolder(path + '/nested', [droppedFolder(path + '/nested/empty')])]);
  });
  tree.push({ isDirectory: true, fullPath: '/root/tail', createReader: tail } as FileSystemDirectoryEntry);
  await expect(droppedSources(transfer([droppedFolder('/root', tree)]), 140)).rejects.toThrow('too many entries');
  expect(tail).not.toHaveBeenCalled();
});
