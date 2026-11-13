import { BlobReader, BlobWriter, ZipReader, ZipWriter, ERR_INVALID_AUTHENTICATION_CODE,
  ERR_INVALID_PASSWORD } from '@zip.js/zip.js';
import { archivePath } from '../utils/archiveFiles';
import { inspectZip } from './zip-inspection';

export const encryptedZipLimit = 128 * 1024 * 1024;
export const encryptedZipFileLimit = 1000;
type Input = { name: string; file: Blob | null; directory: boolean };

function checkNames(names: string[]) {
  const files = new Set<string>();
  const seen = new Set<string>();
  for (const name of names) {
    const directory = name.endsWith('/');
    const path = archivePath(directory ? name.slice(0, -1) : name);
    const key = path.normalize('NFC').toLowerCase();
    if (name.includes('\\') || path.length > 1024 || seen.has(key) ||
        path.split('/').some(part => /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069:<>"|?*]|[ .]$/.test(part)
          || /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/i.test(part.split('.')[0].trimEnd()))) {
      throw new Error('The ZIP contains an unsafe or duplicate path.');
    }
    seen.add(key);
    if (!directory) files.add(key);
  }
  for (const path of seen) {
    const parts = path.split('/');
    if (parts.some((_, index) => index > 0 && files.has(parts.slice(0, index).join('/')))) {
      throw new Error('The ZIP contains conflicting paths.');
    }
  }
}

function checkLimits(sizes: number[]) {
  if (sizes.length > encryptedZipFileLimit || sizes.some(size => !Number.isSafeInteger(size) || size < 0)
      || sizes.reduce((sum, size) => sum + size, 0) > encryptedZipLimit) {
    throw new Error('Encrypted ZIPs are limited to 1,000 entries and 128 MiB of file data.');
  }
}

export async function createEncryptedZip(inputs: Input[], password: string, signal: AbortSignal) {
  checkLimits(inputs.map(input => input.file?.size ?? 0));
  const names = inputs.map(input => input.directory ? input.name.replace(/\/?$/, '/') : input.name);
  checkNames(names);
  if (!password || !inputs.some(input => input.file) || inputs.some(input => !input.directory && !input.file)) {
    throw new Error('Choose files and enter an archive password.');
  }
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  for (const [index, input] of inputs.entries()) {
    signal.throwIfAborted();
    await writer.add(names[index], input.file ? new BlobReader(input.file) : undefined, {
      directory: input.directory, signal, ...(input.directory ? {} : { password, encryptionStrength: 3 }),
    });
  }
  const archive = await writer.close();
  signal.throwIfAborted();
  if (archive.size > encryptedZipLimit + 4 * 1024 * 1024) throw new Error('Encrypted ZIP size limit reached.');
  const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    if (entries.length !== inputs.length) throw new Error('Could not verify the encrypted ZIP.');
    for (const [index, entry] of entries.entries()) {
      signal.throwIfAborted();
      const input = inputs[index].file;
      if (entry.filename !== names[index] || entry.directory !== inputs[index].directory) {
        throw new Error('Could not verify the encrypted ZIP.');
      }
      if (entry.directory || !input) continue;
      if (!entry.encrypted || entry.zipCrypto || entry.extraFieldAES?.strength !== 3 ||
          entry.uncompressedSize !== input.size) {
        throw new Error('Could not verify the encrypted ZIP.');
      }
      let offset = 0;
      await entry.getData(new WritableStream<Uint8Array>({
        async write(chunk) {
          signal.throwIfAborted();
          const original = new Uint8Array(await input.slice(offset, offset + chunk.length).arrayBuffer());
          if (original.length !== chunk.length || chunk.some((byte, index) => byte !== original[index])) {
            throw new Error('Could not verify the encrypted ZIP.');
          }
          offset += chunk.length;
        },
      }), { password, checkAuthenticationCode: true, checkCrc32: true, signal });
      if (offset !== input.size) throw new Error('Could not verify the encrypted ZIP.');
    }
  } finally {
    await reader.close();
  }
  return archive;
}

export async function unlockEncryptedZip(input: Blob, password: string, signal: AbortSignal) {
  if (input.size > encryptedZipLimit + 4 * 1024 * 1024) throw new Error('Encrypted ZIP size limit reached.');
  const directory = await inspectZip(input);
  signal.throwIfAborted();
  checkLimits(directory.members.map(entry => entry.size));
  const reader = new ZipReader(new BlobReader(input), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    if (entries.length !== directory.members.length || !entries.some(entry => entry.encrypted)) {
      throw new Error('Choose a password-protected ZIP.');
    }
    if (entries.some(entry => entry.encrypted && (entry.zipCrypto || entry.directory || !entry.extraFieldAES))) {
      throw new Error('This ZIP uses unsupported encryption. Use an AES-encrypted ZIP.');
    }
    if (entries.some(entry => entry.symlink)) throw new Error('The ZIP contains a symbolic link.');
    checkLimits(entries.map(entry => entry.uncompressedSize));
    checkNames(entries.map(entry => entry.filename));
    const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
    for (const entry of entries) {
      signal.throwIfAborted();
      if (entry.directory) {
        await writer.add(entry.filename, undefined, { directory: true, signal });
        continue;
      }
      const chunks: BlobPart[] = [];
      let written = 0;
      await entry.getData(new WritableStream<Uint8Array>({
        write(chunk) {
          signal.throwIfAborted();
          written += chunk.length;
          if (written > entry.uncompressedSize) throw new Error('Invalid ZIP entry size.');
          chunks.push(new Uint8Array(chunk));
        },
      }), { password, checkAuthenticationCode: true, checkCrc32: true, checkOverlappingEntry: true,
        checkLocalFilename: true, signal });
      if (written !== entry.uncompressedSize) throw new Error('Invalid ZIP entry size.');
      await writer.add(entry.filename, new BlobReader(new Blob(chunks)), { level: 0, signal });
    }
    const output = await writer.close();
    const restored = new ZipReader(new BlobReader(output), { useWebWorkers: false });
    try {
      const members = await restored.getEntries();
      if (members.length !== entries.length) throw new Error('Could not verify the unlocked ZIP.');
      for (const [index, member] of members.entries()) {
        signal.throwIfAborted();
        const original = entries[index];
        if (member.filename !== original.filename || member.encrypted ||
            member.directory !== original.directory || member.uncompressedSize !== original.uncompressedSize) {
          throw new Error('Could not verify the unlocked ZIP.');
        }
        if (!member.directory) await member.getData(new WritableStream<Uint8Array>(), { checkCrc32: true, signal });
      }
    } finally {
      await restored.close();
    }
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
