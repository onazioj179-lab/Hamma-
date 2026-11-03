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

/** Collect one explicit selection atomically, retaining paths and empty folders. */
export async function readFolder(root: FolderEntry, maximum = 5000, signal?: AbortSignal): Promise<Source[]> {
  const sources: Source[] = [];
  let entries = 0;
  const append = (name: string, file: File | null) => {
    if (sources.length >= maximum) throw new Error(`Choose at most ${maximum.toLocaleString()} files. Nothing was added.`);
    sources.push({ id: randomId(), name, file, size: file?.size || 0, directory: file === null });
  };
  const walk = async (entry: FolderEntry | FolderFile, path: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    if (depth > 64) throw new Error('Folder nesting limit reached. Nothing was added.');
    // Count nonempty directories too, so a tree cannot evade traversal bounds.
    if (++entries > maximum * 2 + 64) throw new Error('This folder contains too many entries. Choose a smaller folder.');
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      signal?.throwIfAborted(); append(path, file);
      return;
    }
    let empty = true;
    for await (const child of entry.values()) {
      empty = false;
      await walk(child, path + '/' + child.name, depth + 1);
    }
    signal?.throwIfAborted();
    if (empty) append(path + '/', null);
  };
  if (!signal) { await walk(root, root.name, 0); return sources; }
  signal.throwIfAborted();
  // Cloud providers may leave getFile()/iteration pending. Release the UI on
  // cancellation immediately; the traversal checks the signal before adding more.
  return new Promise<Source[]>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    walk(root, root.name, 0).then(() => {
      signal.removeEventListener('abort', abort); resolve(sources);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
