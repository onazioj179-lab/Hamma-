import type { Source } from './client';
import { inspectZip } from './zip-inspection';

export const ENCRYPTED_ZIP_LIMIT = 64 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const zipOptions = { useWebWorkers: false, useCompressionStream: false };

function checkedPaths(entries: { name: string; directory: boolean }[]) {
  const occupied = new Map<string, boolean>();
  for (const { name, directory } of entries) {
    const path = directory && name.endsWith('/') ? name.slice(0, -1) : name;
    const parts = path.split('/');
    if (path.length > 1024 || parts.some(part => !part || part === '.' || part === '..' ||
      /[<>:"\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]|[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
      throw new Error('The ZIP contains an unsafe path.');
    }
    const key = path.normalize('NFC').toLowerCase();
    if (occupied.has(key)) throw new Error('The ZIP contains conflicting paths.');
    occupied.set(key, directory);
  }
  for (const key of occupied.keys()) {
    for (let slash = key.indexOf('/'); slash >= 0; slash = key.indexOf('/', slash + 1)) {
      if (occupied.get(key.slice(0, slash)) === false) throw new Error('The ZIP contains conflicting paths.');
    }
  }
}

function checkLimits(count: number, bytes: number) {
  if (count > MAX_ENTRIES || !Number.isSafeInteger(bytes) || bytes > ENCRYPTED_ZIP_LIMIT) {
    throw new Error('Use at most 5,000 entries and 64 MiB of file data for password-protected ZIPs.');
  }
}

export async function createEncryptedZip(sources: Source[], password: string, signal: AbortSignal): Promise<Blob> {
  if (!password || !sources.some(source => source.file)) throw new Error('Choose at least one file and enter a password.');
  checkLimits(sources.length, sources.reduce((sum, source) => sum + source.size, 0));
  checkedPaths(sources);
  const { BlobReader, BlobWriter, ZipReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/zip'), zipOptions);
  for (const source of sources) {
    signal.throwIfAborted();
    if (!source.directory && !source.file) throw new Error('Select the original file to continue.');
    await writer.add(source.name, source.file ? new BlobReader(source.file) : undefined, {
      directory: source.directory, password: source.directory ? undefined : password,
      encryptionStrength: 3, level: 5, signal,
    });
  }
  const archive = await writer.close();
  signal.throwIfAborted();
  checkLimits(sources.length, archive.size);
  const reader = new ZipReader(new BlobReader(archive), zipOptions);
  try {
    const entries = await reader.getEntries();
    if (entries.length !== sources.length) throw new Error('ZIP verification failed.');
    for (const [index, entry] of entries.entries()) {
      signal.throwIfAborted();
      const source = sources[index];
      if (entry.filename !== source.name || entry.directory !== source.directory) throw new Error('ZIP verification failed.');
      if (entry.directory) continue;
      const file = source.file!;
      let offset = 0;
      if (!entry.encrypted || entry.zipCrypto || entry.extraFieldAES?.strength !== 3 ||
          entry.uncompressedSize !== file.size) throw new Error('ZIP verification failed.');
      await entry.getData(new WritableStream<Uint8Array>({
        async write(bytes) {
          const original = new Uint8Array(await file.slice(offset, offset + bytes.length).arrayBuffer());
          if (original.length !== bytes.length || bytes.some((byte, i) => byte !== original[i])) {
            throw new Error('ZIP verification failed.');
          }
          offset += bytes.length;
        },
      }), { password, checkAuthenticationCode: true, signal });
      if (offset !== file.size) throw new Error('ZIP verification failed.');
    }
  } finally {
    await reader.close();
  }
  return archive;
}

export async function unlockEncryptedZip(archive: Blob, password: string, signal: AbortSignal): Promise<Blob> {
  if (!password) throw new Error('Enter the ZIP password.');
  checkLimits(0, archive.size);
  // Preflight the central directory before the codec allocates entry objects.
  const directory = await inspectZip(archive);
  checkLimits(directory.members.length, directory.members.reduce((sum, entry) => sum + entry.size, 0));
  signal.throwIfAborted();
  const { BlobReader, BlobWriter, ZipReader, ZipWriter, ERR_INVALID_PASSWORD,
    ERR_INVALID_AUTHENTICATION_CODE } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(archive), zipOptions);
  try {
    const entries = await reader.getEntries();
    checkLimits(entries.length, entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0));
    checkedPaths(entries.map(entry => ({ name: entry.filename, directory: entry.directory })));
    if (!entries.some(entry => entry.encrypted && !entry.directory)) throw new Error('This ZIP has no encrypted files.');
    const writer = new ZipWriter(new BlobWriter('application/zip'), zipOptions);
    for (const entry of entries) {
      signal.throwIfAborted();
      if (entry.symlink || entry.encrypted && (entry.zipCrypto || !entry.extraFieldAES) ||
          !entry.directory && ![0, 8].includes(entry.compressionMethod)) {
        throw new Error('This ZIP uses an unsupported entry type or encryption method.');
      }
      if (entry.directory) {
        await writer.add(entry.filename, undefined, { directory: true, signal });
        continue;
      }
      const chunks: Blob[] = [];
      let size = 0;
      await entry.getData(new WritableStream<Uint8Array>({
        write(bytes) {
          size += bytes.length;
          if (size > entry.uncompressedSize) throw new Error('The ZIP entry exceeds its declared size.');
          chunks.push(new Blob([new Uint8Array(bytes)]));
        },
      }), { password, checkAuthenticationCode: true, checkCrc32: true, signal });
      if (size !== entry.uncompressedSize) throw new Error('The ZIP entry size did not match.');
      await writer.add(entry.filename, new BlobReader(new Blob(chunks)), { level: 0, signal });
    }
    const output = await writer.close();
    checkLimits(entries.length, output.size);
    return output;
  } catch (error) {
    if (error instanceof Error && [ERR_INVALID_PASSWORD, ERR_INVALID_AUTHENTICATION_CODE].includes(error.message)) {
      throw new Error('The password is incorrect or the ZIP data is damaged.');
    }
    throw error;
  } finally {
    await reader.close();
  }
}
