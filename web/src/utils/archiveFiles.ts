import { zipSync } from 'fflate';

interface Entry { name: string; size: number; offset: number }

export function archivePath(name: string): string {
  const path = name.replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\0')) {
    throw new Error(`Invalid archive path: ${name}`);
  }
  return path;
}

export function validateFilePaths(files: File[]): void {
  const paths = new Set<string>();
  for (const file of files) {
    const path = archivePath(file.webkitRelativePath || file.name);
    if (paths.has(path)) throw new Error(`Duplicate archive path: ${path}`);
    paths.add(path);
  }
}

/** Restore the historical multi-file containers to a portable ZIP. */
export async function restoreFileArchive(
  data: Uint8Array,
  decode: (data: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array | null> {
  if (data.length < 5) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const manifestLength = view.getUint32(0, true);
  if (manifestLength === 0 || manifestLength > data.length - 4 || data[4] !== 0x7B) return null;
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(4, 4 + manifestLength))); }
  catch { return null; }
  if (manifest.type !== 'multi-file' && manifest.type !== 'multi-file-stream') return null;
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.fileCount !== manifest.files.length) {
    throw new Error('Invalid multi-file manifest');
  }
  const files: Record<string, Uint8Array> = Object.create(null);
  let offset = 4 + manifestLength;
  let originalOffset = 0;
  for (const entry of manifest.files as Entry[]) {
    if (typeof entry.name !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
        entry.offset !== originalOffset || !Number.isSafeInteger(originalOffset + entry.size)) {
      throw new Error('Invalid multi-file entry');
    }
    const name = archivePath(entry.name);
    if (Object.prototype.hasOwnProperty.call(files, name)) throw new Error(`Duplicate archive path: ${name}`);
    if (manifest.type === 'multi-file') {
      if (entry.size > data.length - offset) throw new Error(`Truncated file: ${name}`);
      files[name] = data.slice(offset, offset + entry.size);
      offset += entry.size;
    } else {
      const chunks: Uint8Array[] = [];
      let size = 0;
      do {
        if (offset + 4 > data.length) throw new Error(`Missing chunk: ${name}`);
        const length = view.getUint32(offset, true);
        offset += 4;
        if (!length || length > data.length - offset) throw new Error(`Invalid chunk: ${name}`);
        const chunk = await decode(data.subarray(offset, offset + length));
        if (chunk.length > entry.size - size || (!chunk.length && entry.size > 0)) throw new Error(`Invalid restored size: ${name}`);
        chunks.push(chunk);
        size += chunk.length;
        offset += length;
      } while (size < entry.size);
      const restored = new Uint8Array(size);
      let writeOffset = 0;
      for (const chunk of chunks) { restored.set(chunk, writeOffset); writeOffset += chunk.length; }
      files[name] = restored;
    }
    originalOffset += entry.size;
  }
  const expectedFooter = manifest.type === 'multi-file-stream' ? 'SPK_END' : '';
  if (new TextDecoder().decode(data.subarray(offset)) !== expectedFooter) throw new Error('Invalid multi-file archive length or footer');
  return zipSync(files, { level: 0 });
}
