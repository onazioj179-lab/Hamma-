import { readFileAsArrayBuffer } from '../utils/fileHelpers';

export interface ZipMember {
  name: string;
  size: number;
  packedSize: number;
  encrypted: boolean;
}

export interface ZipDirectory {
  members: ZipMember[];
  comment: string;
}

const END_SIZE = 22;
const MAX_COMMENT = 65535;
const COMMENT_PREVIEW = 4096;
const MAX_DIRECTORY = 2 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MEMBER_SIZE = 46;
const ZIP64_END = 56;
const ZIP64_LOCATOR = 20;
const LARGE = 0xffffffff;
const invalid = () => new Error('Invalid ZIP directory');
const split = () => new Error('Split ZIP previews are unavailable');

function safeUint64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP metadata exceeds browser integer precision');
  return Number(value);
}

function memberSizes(view: DataView, position: number, extra: number, extraSize: number) {
  let packedSize = view.getUint32(position + 20, true);
  let size = view.getUint32(position + 24, true);
  let offset = view.getUint32(position + 42, true);
  let disk = view.getUint16(position + 34, true);
  if (packedSize === LARGE || size === LARGE || offset === LARGE || disk === 0xffff) {
    const end = extra + extraSize;
    while (extra + 4 <= end && view.getUint16(extra, true) !== 1) {
      extra += 4 + view.getUint16(extra + 2, true);
    }
    if (extra + 4 > end) throw invalid();
    const fieldEnd = extra + 4 + view.getUint16(extra + 2, true);
    if (fieldEnd > end) throw invalid();
    extra += 4;
    const read = () => {
      if (extra + 8 > fieldEnd) throw invalid();
      const value = safeUint64(view, extra);
      extra += 8;
      return value;
    };
    if (size === LARGE) size = read();
    if (packedSize === LARGE) packedSize = read();
    if (offset === LARGE) offset = read();
    if (disk === 0xffff) {
      if (extra + 4 > fieldEnd) throw invalid();
      disk = view.getUint32(extra, true);
    }
  }
  if (disk) throw split();
  return { size, packedSize, offset };
}

/** Read ZIP metadata only. Member data is never opened or decompressed. */
export async function inspectZip(file: Blob): Promise<ZipDirectory> {
  const tailStart = Math.max(0, file.size - END_SIZE - MAX_COMMENT - ZIP64_LOCATOR - ZIP64_END);
  const tail = new DataView(await readFileAsArrayBuffer(file.slice(tailStart)));
  let end = tail.byteLength - END_SIZE;
  while (end >= 0) {
    if (tail.getUint32(end, true) === 0x06054b50 &&
        end + END_SIZE + tail.getUint16(end + 20, true) === tail.byteLength) break;
    end--;
  }
  if (end < 0) throw invalid();
  const commentLength = tail.getUint16(end + 20, true);
  const commentBytes = new Uint8Array(tail.buffer, end + END_SIZE, Math.min(commentLength, COMMENT_PREVIEW));
  const comment = Array.from(commentBytes, byte => byte >= 0x20 && byte <= 0x7e
    ? String.fromCharCode(byte) : '\\x' + byte.toString(16).padStart(2, '0')).join('')
    + (commentLength > COMMENT_PREVIEW ? '…' : '');
  let count = tail.getUint16(end + 10, true);
  let size = tail.getUint32(end + 12, true);
  let offset = tail.getUint32(end + 16, true);
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true) ||
      tail.getUint16(end + 8, true) !== count) throw split();
  const locator = end - ZIP64_LOCATOR;
  if (locator >= 0 && tail.getUint32(locator, true) === 0x07064b50) {
    if (tail.getUint32(locator + 4, true) || tail.getUint32(locator + 16, true) !== 1) throw split();
    end = locator - ZIP64_END;
    if (end < 0 || safeUint64(tail, locator + 8) !== tailStart + end ||
        tail.getUint32(end, true) !== 0x06064b50 || safeUint64(tail, end + 4) !== 44) throw invalid();
    count = safeUint64(tail, end + 32);
    if (tail.getUint32(end + 16, true) || tail.getUint32(end + 20, true) ||
        safeUint64(tail, end + 24) !== count) throw split();
    size = safeUint64(tail, end + 40);
    offset = safeUint64(tail, end + 48);
  } else if (count === 0xffff || size === LARGE || offset === LARGE) {
    throw invalid();
  }
  if (count > MAX_ENTRIES || size > MAX_DIRECTORY) throw new Error('ZIP directory exceeds the preview limit');
  if (offset !== tailStart + end - size || size < count * MEMBER_SIZE) throw invalid();

  const buffer = await readFileAsArrayBuffer(file.slice(offset, offset + size));
  const directory = new DataView(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const members: ZipMember[] = [];
  let position = 0;
  while (position < size) {
    if (members.length >= count || size - position < MEMBER_SIZE ||
        directory.getUint32(position, true) !== 0x02014b50) throw invalid();
    const flags = directory.getUint16(position + 8, true);
    const nameSize = directory.getUint16(position + 28, true);
    const extraSize = directory.getUint16(position + 30, true);
    const commentSize = directory.getUint16(position + 32, true);
    const start = position + MEMBER_SIZE;
    const member = position;
    position = start + nameSize + extraSize + commentSize;
    if (!nameSize || position > size) throw invalid();
    const { size: unpackedSize, packedSize, offset: localOffset } = memberSizes(directory, member, start + nameSize, extraSize);
    if (localOffset > offset - 30) throw invalid();

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
  return { members, comment };
}
