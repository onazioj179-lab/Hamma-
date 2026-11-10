export interface Inspection { format: string; conversions: string[]; extract: boolean; error?: string }
export interface Capability {
  projectRecovery?: boolean;
  inspection?: boolean;
  zipVerification?: boolean;
  zipSelection?: boolean;
  archiveRepack?: boolean;
  officeInspection?: boolean;
  zipProfiles?: string[];
  singleFileArchives?: string[];
  actionRegistry?: { mime: string[]; extensions: string[]; conversions: string[]; extract: boolean }[];
  version: number;
  archives: string[];
  conversions: string[];
  processing: 'local';
  limits: { input: number; expanded: number; files: number; seconds: number };
  plan?: { historyRecords: number };
}
export interface Job {
  errorInfo?: { category: string; retryEligible: boolean; stage: string; jobId: string; fileIds?: string[] } | null;
  retryCount?: number;
  projectId?: string; id: string; name: string; operation: 'compress' | 'extract' | 'convert' | 'verify' | 'inspect'; target: string;
  state: string; inputSize: number; outputSize: number | null; processed: number;
  created: number; finished?: number | null; duration?: number; error?: string; entries: number; hidden?: boolean;
  download?: string; downloadAvailable: boolean; outputName?: string;
  fileExpires: number; historyExpires: number | null; fileCount: number; format: string;
  expanded?: number; mediaSeconds?: number; track?: number; tracks?: number;
}
export interface Source { inspection?: Inspection; id: string; file: File | null; name: string; size: number; directory: boolean; upload?: string; uploaded?: number }
export interface Retention { historyRetention: string; fileRetention: string }
export const activeJob = (job: Job) => ['queued', 'processing', 'verifying', 'paused'].includes(job.state);

export class ProcessorError extends Error {
  constructor(message: string, public status: number, public retryAfterSeconds?: number) { super(message); this.name = 'ProcessorError'; }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  try {
    const response = await fetch('/api/process' + path, {
      ...init, signal: controller.signal, credentials: 'same-origin', headers: { 'X-Hamma-Request': '1', ...init.headers },
    });
    if (response.status === 204) return undefined as T;
    let result;
    try { result = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ProcessorError('The processor returned an unreadable response. Reconnect and try again.', response.status);
    }
    if (!response.ok) {
      const header = response.headers?.get('Retry-After');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : undefined;
      const message = typeof result?.error === 'string' ? result.error : 'Request failed';
      throw new ProcessorError(seconds ? `${message}. Try again in ${seconds} seconds.` : message, response.status, seconds);
    }
    return result as T;
  } catch (error) {
    if (timedOut) throw new Error('The processor took too long to respond. Reconnect and retry.');
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancel);
  }
}
export const jsonRequest = <T>(path: string, data: unknown, method = 'POST', init: RequestInit = {}) =>
  request<T>(path, { ...init, method, headers: { 'Content-Type': 'application/json', ...init.headers }, body: JSON.stringify(data) });

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
  signal.throwIfAborted();
  const create = async () => {
    if (!source.directory && !source.file && source.size > 0) throw new Error('This recovered upload is unavailable. Select the original file again.');
    const record = await jsonRequest<{ id: string }>('/uploads', { name: source.name, size: source.size, directory: source.directory }, 'POST', { signal });
    source.upload = record.id;
  };
  if (!source.upload) await create();
  let offset: number;
  try { offset = (await request<{ offset: number }>('/uploads/' + source.upload, { signal })).offset; }
  catch (error) {
    if (!(error instanceof ProcessorError) || ![404, 410].includes(error.status)) throw error;
    await create();
    offset = (await request<{ offset: number }>('/uploads/' + source.upload, { signal })).offset;
  }
  const id = source.upload!;
  const validOffset = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > source.size) throw new Error('The processor returned an invalid upload position.');
    return value;
  };
  offset = validOffset(offset);
  update(offset);
  let failures = 0;
  while (offset < source.size) {
    signal.throwIfAborted();
    if (!source.file) throw new Error('This recovered upload is incomplete. Select the original file again.');
    try {
      const next = Math.min(source.size, offset + 4 * 1024 * 1024);
      const result = await request<{ offset: number }>('/uploads/' + id, {
        method: 'PUT', signal, headers: { 'Upload-Offset': String(offset) }, body: source.file!.slice(offset, next),
      });
      if (result.offset <= offset) throw new Error('The upload made no progress. Retry the operation.');
      offset = validOffset(result.offset);
      failures = 0;
      update(offset);
    } catch (error) {
      // Retrying throttling or permanent errors only increases pressure on the host.
      if (signal.aborted || error instanceof ProcessorError && ![408, 409, 500, 502, 503, 504].includes(error.status) || ++failures >= 3) throw error;
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 200 * 2 ** (failures - 1));
        if (signal.aborted) cancel();
        else signal.addEventListener('abort', cancel, { once: true });
      });
      offset = validOffset((await request<{ offset: number }>('/uploads/' + id, { signal })).offset);
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
