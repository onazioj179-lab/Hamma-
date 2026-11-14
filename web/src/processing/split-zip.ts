import {
  BlobReader, BlobWriter, ERR_INVALID_AUTHENTICATION_CODE, ERR_INVALID_CRC32, ERR_INVALID_PASSWORD,
  SplitDataReader, SplitDataWriter, ZipReader, ZipWriter, type Entry,
} from '@zip.js/zip.js';
import { checkZipPaths, readVerifiedZipEntry } from './encrypted-zip';

const maxBytes = 128 * 1024 * 1024;
const maxEntries = 1000;
const maxVolumes = 128;
const volumeName = /^(.*)\.z(\d{2,3})$/i;
export const zipVolumeSizes = [1, 8, 32] as const;
type Input = { name: string; file: Blob | null; directory: boolean };

export async function createSplitZip(inputs: Input[], volumeMiB: number, signal: AbortSignal, password?: string) {
  if (!zipVolumeSizes.some(size => size === volumeMiB)) throw new Error('Choose a supported volume size.');
  const volumeSize = volumeMiB * 1024 * 1024;
  const total = inputs.reduce((sum, input) => sum + (input.file?.size ?? 0), 0);
  if (total <= volumeSize || total > maxBytes || inputs.length > maxEntries ||
      inputs.some(input => !input.directory && !input.file)) {
    throw new Error('Choose up to 1,000 files totaling more than one volume and at most 128 MiB.');
  }
  const names = inputs.map(input => input.directory ? input.name.replace(/\/?$/, '/') : input.name);
  checkZipPaths(names);
  const volumes: BlobWriter[] = [];
  const disks = new SplitDataWriter((async function* () {
    while (volumes.length < maxVolumes) {
      const disk = new BlobWriter();
      volumes.push(disk);
      yield disk;
    }
    throw new Error('The archive needs too many ZIP volumes. Choose a larger volume size.');
  })(), volumeSize);
  const writer = new ZipWriter(disks, { useWebWorkers: false });
  for (const [index, input] of inputs.entries()) {
    signal.throwIfAborted();
    await writer.add(names[index], input.file ? new BlobReader(input.file) : undefined,
      {
        level: 0, directory: input.directory, signal,
        ...(password && !input.directory ? { password, encryptionStrength: 3 } : {}),
      });
  }
  await writer.close();
  const blobs = await Promise.all(volumes.map(volume => volume.getData()));
  const reader = new ZipReader(new SplitDataReader(blobs.map(blob => new BlobReader(blob))), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    if (entries.length !== inputs.length) throw new Error('The ZIP volume set is incomplete.');
    for (const [index, entry] of entries.entries()) {
      signal.throwIfAborted();
      if (entry.filename !== names[index] || entry.directory !== inputs[index].directory ||
          entry.uncompressedSize !== (inputs[index].file?.size ?? 0)) {
        throw new Error('The ZIP volume set failed verification.');
      }
      if (!entry.directory) {
        if (password ? !entry.encrypted || entry.zipCrypto || entry.extraFieldAES?.strength !== 3 : entry.encrypted) {
          throw new Error('The ZIP volume set uses unexpected encryption.');
        }
        await entry.getData(new WritableStream<Uint8Array>(), {
          password, checkAuthenticationCode: true, checkCrc32: true, signal,
        });
      }
    }
  } finally {
    await reader.close();
  }
  return blobs.map((blob, index) => ({
    blob, name: index === blobs.length - 1 ? 'archive.zip' : 'archive.z' + String(index + 1).padStart(2, '0'),
  }));
}

export function orderZipVolumes(files: File[]) {
  const ends = files.filter(file => /\.zip$/i.test(file.name));
  if (ends.length !== 1 || files.length < 2 || files.length > maxVolumes) {
    throw new Error('Select the final .zip and all numbered ZIP volumes.');
  }
  const end = ends[0];
  const base = end.name.slice(0, -4).toLowerCase();
  const parts = files.filter(file => file !== end).map(file => {
    const match = volumeName.exec(file.name);
    if (!match || match[1].toLowerCase() !== base) throw new Error('Select volumes from the same ZIP.');
    return { file, index: Number(match[2]) };
  }).sort((a, b) => a.index - b.index);
  if (parts.some((part, index) => part.index !== index + 1)) {
    throw new Error('The ZIP volumes have a missing or duplicate number.');
  }
  const ordered = [...parts.map(part => part.file), end];
  if (ordered.some(file => !file.size) || ordered.reduce((sum, file) => sum + file.size, 0) > maxBytes + 4 * 1024 * 1024) {
    throw new Error('The ZIP volume set exceeds the browser size limit or contains an empty volume.');
  }
  return ordered;
}

export async function joinSplitZip(files: File[], signal: AbortSignal, password?: string) {
  const ordered = orderZipVolumes(files);
  const end = ordered[ordered.length - 1];
  const tail = new DataView(await end.slice(-65557).arrayBuffer());
  let footer = tail.byteLength - 22;
  while (footer >= 0 && (tail.getUint32(footer, true) !== 0x06054b50 ||
      footer + 22 + tail.getUint16(footer + 20, true) !== tail.byteLength)) footer--;
  if (footer < 0 || tail.getUint16(footer + 4, true) !== ordered.length - 1) {
    throw new Error('The ZIP directory does not match the selected volumes.');
  }
  const count = tail.getUint16(footer + 10, true);
  if (!count || count > maxEntries || tail.getUint32(footer + 12, true) > 2 * 1024 * 1024) {
    throw new Error('The split ZIP directory exceeds the browser limit.');
  }
  const reader = new ZipReader(new SplitDataReader(ordered.map(file => new BlobReader(file))), {
    useWebWorkers: false,
  });
  try {
    const entries: Entry[] = [];
    let expanded = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      signal.throwIfAborted();
      if (entries.length === count || entry.symlink || (entry.encrypted && entry.directory) ||
          !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
          (expanded += entry.uncompressedSize) > maxBytes) {
        throw new Error('The split ZIP contains unsupported entries or exceeds the 128 MiB output limit.');
      }
      entries.push(entry);
    }
    if (entries.length !== count) throw new Error('The ZIP directory entry count is invalid.');
    if (!password && entries.some(entry => entry.encrypted)) {
      throw new Error('Enter the password for this split ZIP.');
    }
    checkZipPaths(entries.map(entry => entry.filename));
    const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
    for (const entry of entries) {
      signal.throwIfAborted();
      if (entry.directory) {
        await writer.add(entry.filename, undefined, { directory: true, signal });
        continue;
      }
      const blob = await readVerifiedZipEntry(entry, signal, entry.encrypted ? password : undefined);
      await writer.add(entry.filename, new BlobReader(blob), { level: 0, signal });
    }
    const output = await writer.close();
    signal.throwIfAborted();
    return output;
  } catch (error) {
    if (error instanceof Error &&
        [ERR_INVALID_PASSWORD, ERR_INVALID_AUTHENTICATION_CODE, ERR_INVALID_CRC32].includes(error.message)) {
      throw new Error(password ? 'The password is incorrect or the ZIP data is damaged.' : 'The ZIP data is damaged.');
    }
    throw error;
  } finally {
    await reader.close();
  }
}
