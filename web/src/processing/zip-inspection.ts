import { readFileAsArrayBuffer } from '../utils/fileHelpers';

export interface ZipMember {
  name: string;
  size: number;
  packedSize: number;
  encrypted: boolean;
}

const END_SIZE = 22;
const MAX_COMMENT = 65535;
const MAX_DIRECTORY = 2 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MEMBER_SIZE = 46;

/** Read ZIP metadata only. Member data is never opened or decompressed. */
export async function inspectZip(file: Blob): Promise<ZipMember[]> {
  const invalid = () => new Error('Invalid ZIP directory');
  const zip64 = () => new Error('ZIP64 previews are unavailable');
  const tailStart = Math.max(0, file.size - END_SIZE - MAX_COMMENT - 20);
  const tail = new DataView(await readFileAsArrayBuffer(file.slice(tailStart)));
  let end = tail.byteLength - END_SIZE;
  while (end >= 0) {
    if (tail.getUint32(end, true) === 0x06054b50 &&
        end + END_SIZE + tail.getUint16(end + 20, true) === tail.byteLength) break;
    end--;
  }
  if (end < 0) throw invalid();
  if (end >= 20 && tail.getUint32(end - 20, true) === 0x07064b50) throw zip64();
  const count = tail.getUint16(end + 10, true);
  const size = tail.getUint32(end + 12, true);
  const offset = tail.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw zip64();
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true) ||
      tail.getUint16(end + 8, true) !== count) throw new Error('Split ZIP previews are unavailable');
  if (count > MAX_ENTRIES || size > MAX_DIRECTORY) throw new Error('ZIP directory exceeds the preview limit');
  if (offset + size !== tailStart + end || size < count * MEMBER_SIZE) throw invalid();

  const buffer = await readFileAsArrayBuffer(file.slice(offset, offset + size));
  const directory = new DataView(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const members: ZipMember[] = [];
  let position = 0;
  while (position < size) {
    if (members.length >= count || size - position < MEMBER_SIZE ||
        directory.getUint32(position, true) !== 0x02014b50) throw invalid();
    const flags = directory.getUint16(position + 8, true);
    const packedSize = directory.getUint32(position + 20, true);
    const unpackedSize = directory.getUint32(position + 24, true);
    const nameSize = directory.getUint16(position + 28, true);
    const extraSize = directory.getUint16(position + 30, true);
    const commentSize = directory.getUint16(position + 32, true);
    const disk = directory.getUint16(position + 34, true);
    const localOffset = directory.getUint32(position + 42, true);
    if (packedSize === 0xffffffff || unpackedSize === 0xffffffff || localOffset === 0xffffffff) throw zip64();
    const start = position + MEMBER_SIZE;
    position = start + nameSize + extraSize + commentSize;
    if (!nameSize || position > size || disk || localOffset + 30 > offset) throw invalid();

    const nameBytes = new Uint8Array(buffer, start, nameSize);
    // Legacy non-ASCII bytes are displayed as escapes instead of guessing a code page.
    let name: string;
    try {
      name = flags & 0x800 ? utf8.decode(nameBytes) : Array.from(nameBytes, byte =>
        byte < 0x80 ? String.fromCharCode(byte) : '\\x' + byte.toString(16).padStart(2, '0')).join('');
    } catch {
      throw invalid();
    }
    name = name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '\uFFFD');
    members.push({ name, size: unpackedSize, packedSize, encrypted: !!(flags & 1) });
  }
  if (members.length !== count) throw invalid();
  return members;
}
