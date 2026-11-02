export interface Capability {
  version: number;
  archives: string[];
  conversions: string[];
  processing: 'local';
  limits: { input: number; expanded: number; files: number; seconds: number };
}
export interface Job {
  id: string; name: string; operation: 'compress' | 'extract' | 'convert'; target: string;
  state: string; inputSize: number; outputSize: number | null; processed: number;
  created: number; duration?: number; error?: string; entries: number;
  download?: string; downloadAvailable: boolean; outputName?: string;
  fileExpires: number; historyExpires: number | null; fileCount: number; format: string;
  expanded?: number; mediaSeconds?: number; track?: number; tracks?: number;
}
export interface Source { id: string; file: File | null; name: string; size: number; directory: boolean; upload?: string; uploaded?: number }
export interface Retention { historyRetention: string; fileRetention: string }
export const activeJob = (job: Job) => ['queued', 'processing', 'verifying', 'paused'].includes(job.state);

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/process' + path, {
    ...init, credentials: 'same-origin', headers: { 'X-Hamma-Request': '1', ...init.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result as T;
}
export const jsonRequest = <T>(path: string, data: unknown, method = 'POST') =>
  request<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
const requestKeys = new Map<string, string>();
export async function requestId(parts: unknown[]): Promise<string> {
  const key = JSON.stringify(parts);
  if (!requestKeys.has(key)) {
    if (requestKeys.size >= 32) requestKeys.delete(requestKeys.keys().next().value!);
    requestKeys.set(key, randomId() + randomId());
  }
  return requestKeys.get(key)!;
}

/** Chunk retries reconcile the server's committed offset before sending more bytes. */
export async function upload(source: Source, signal: AbortSignal, update: (offset: number) => void): Promise<string> {
  if (!source.upload) {
    const record = await jsonRequest<{ id: string }>('/uploads', { name: source.name, size: source.size, directory: source.directory });
    source.upload = record.id;
  }
  const id = source.upload;
  let offset = (await request<{ offset: number }>('/uploads/' + id, { signal })).offset;
  update(offset);
  let failures = 0;
  while (offset < source.size) {
    signal.throwIfAborted();
    try {
      const next = Math.min(source.size, offset + 4 * 1024 * 1024);
      const result = await request<{ offset: number }>('/uploads/' + id, {
        method: 'PUT', signal, headers: { 'Upload-Offset': String(offset) }, body: source.file!.slice(offset, next),
      });
      offset = result.offset;
      failures = 0;
      update(offset);
    } catch (error) {
      if (signal.aborted || ++failures >= 3) throw error;
      offset = (await request<{ offset: number }>('/uploads/' + id, { signal })).offset;
      update(offset);
    }
  }
  return id;
}

export async function droppedSources(transfer: DataTransfer, max = 5000): Promise<Source[]> {
  const sources: Source[] = [];
  const append = (name: string, file: File | null) => {
    sources.push({ id: randomId(), name, file, size: file?.size || 0, directory: file === null });
    if (sources.length > max) throw new Error(`Choose at most ${max.toLocaleString()} files. Nothing was added.`);
  };
  async function walk(entry: FileSystemEntry, depth = 0): Promise<void> {
    if (depth > 64) throw new Error('Folder nesting limit reached');
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      append(entry.fullPath.slice(1), file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let any = false;
      while (true) {
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!entries.length) break;
        any = true;
        for (const child of entries) await walk(child, depth + 1);
      }
      if (!any) append(entry.fullPath.slice(1) + '/', null);
    }
  }
  // Entry handles must be captured before the drop event's data store closes.
  const entries = Array.from(transfer.items || []).map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry);
  const files = Array.from(transfer.files);
  if (entries.length) for (const entry of entries) await walk(entry);
  else for (const file of files) append(file.webkitRelativePath || file.name, file);
  return sources;
}
