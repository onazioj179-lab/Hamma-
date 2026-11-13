import { randomId, type Source } from './client';

export type FolderEntry = {
  kind: 'directory'; name: string; values(): AsyncIterable<FolderEntry | FolderFile>;
};
type FolderFile = { kind: 'file'; name: string; getFile(): Promise<File> };
type DirectoryWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'read'; id: string }) => Promise<FolderEntry>;
};

export function directoryPicker() {
  const picker = (window as DirectoryWindow).showDirectoryPicker;
  return window.isSecureContext && typeof picker === 'function' ? picker.bind(window) : null;
}

type FolderSelection = {
  visit(depth: number): void;
  append(name: string, file: File | null): void;
};

/** Collect one selection atomically, with the same limits for either browser API. */
async function collectSources(scan: (selection: FolderSelection) => Promise<void>, maximum: number, signal?: AbortSignal): Promise<Source[]> {
  const sources: Source[] = [];
  let entries = 0;
  const selection: FolderSelection = {
    visit(depth) {
      signal?.throwIfAborted();
      if (depth > 64) throw new Error('Folder nesting limit reached. Nothing was added.');
      if (++entries > maximum * 2 + 64) throw new Error('This folder contains too many entries. Choose a smaller folder.');
    },
    append(name, file) {
      signal?.throwIfAborted();
      if (sources.length >= maximum) throw new Error(`Choose at most ${maximum.toLocaleString()} files. Nothing was added.`);
      sources.push({ id: randomId(), name, file, size: file?.size || 0, directory: file === null });
    },
  };
  if (!signal) { await scan(selection); return sources; }
  signal.throwIfAborted();
  // Cloud providers may leave getFile()/iteration pending. Release the UI on
  // cancellation immediately; the traversal checks the signal before adding more.
  return new Promise<Source[]>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    scan(selection).then(() => {
      signal.removeEventListener('abort', abort); resolve(sources);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export function readFolder(root: FolderEntry, maximum = 5000, signal?: AbortSignal): Promise<Source[]> {
  return collectSources(async ({ visit, append }) => {
    async function walk(entry: FolderEntry | FolderFile, path: string, depth: number): Promise<void> {
      visit(depth);
      if (entry.kind === 'file') { append(path, await entry.getFile()); return; }
      let empty = true;
      for await (const child of entry.values()) {
        empty = false;
        await walk(child, path + '/' + child.name, depth + 1);
        signal?.throwIfAborted();
      }
      if (empty) append(path + '/', null);
    }
    await walk(root, root.name, 0);
  }, maximum, signal);
}

export function droppedSources(transfer: DataTransfer, maximum = 5000, signal?: AbortSignal): Promise<Source[]> {
  return collectSources(async ({ visit, append }) => {
    async function walk(entry: FileSystemEntry, depth: number): Promise<void> {
      visit(depth);
      const path = entry.fullPath.slice(1);
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
        append(path, file);
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let empty = true;
        while (true) {
          signal?.throwIfAborted();
          const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
          if (!entries.length) break;
          empty = false;
          for (const child of entries) await walk(child, depth + 1);
        }
        if (empty) append(path + '/', null);
      }
    }
    // Capture handles synchronously while the drop event's data store is open.
    const entries: FileSystemEntry[] = [];
    for (const item of transfer.items || []) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;
      if (entries.length >= maximum) throw new Error(`Choose at most ${maximum.toLocaleString()} files. Nothing was added.`);
      entries.push(entry);
    }
    if (entries.length) {
      for (const entry of entries) await walk(entry, 0);
    } else {
      for (const file of transfer.files) append(file.webkitRelativePath || file.name, file);
    }
  }, maximum, signal);
}
