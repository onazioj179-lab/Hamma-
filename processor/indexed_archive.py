"""Bounded TAR processing over a durable directory index.

No ZIP scalability claim: Python's ZIP central directory remains memory backed.
Every recorded input must be representable and verified, or the job fails.
"""
import bz2
from contextlib import contextmanager, nullcontext
from functools import lru_cache
import gzip
import hashlib
import lzma
import os
from pathlib import Path
import stat
import sqlite3
import tarfile
import tempfile

from .engine import BLOCK, BoundedWriter, ProcessingError, Sink, safe_path

TARGETS = {'tar': '', 'tar.gz': 'gz', 'tar.bz2': 'bz2', 'tar.xz': 'xz'}
READERS = {'tar': open, 'tar.gz': gzip.open, 'tar.bz2': bz2.open, 'tar.xz': lzma.open}
TAR_WRITE_BUFFER = 128 * 1024


@lru_cache(maxsize=1)
def windows_api():
    import ctypes
    from ctypes import wintypes
    import msvcrt

    class Info(ctypes.Structure):
        _fields_ = [('attributes', wintypes.DWORD), ('created', wintypes.FILETIME),
                    ('accessed', wintypes.FILETIME), ('written', wintypes.FILETIME),
                    ('volume', wintypes.DWORD), ('size_high', wintypes.DWORD),
                    ('size_low', wintypes.DWORD), ('links', wintypes.DWORD),
                    ('index_high', wintypes.DWORD), ('index_low', wintypes.DWORD)]

    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                                  wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.POINTER(Info)]
    kernel.GetFileInformationByHandle.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    return ctypes, kernel, Info, msvcrt


@contextmanager
def open_source(root, relative):
    """Open without following links, retaining ancestor handles until close."""
    safe_path(relative)  # validate traversal, but retain the filesystem's original Unicode spelling
    parts = Path(relative).parts
    if os.name == 'nt':
        ctypes, kernel, Info, msvcrt = windows_api()
        handles = []
        try:
            current = Path(root)
            for number, component in enumerate(('', *parts)):
                current /= component
                directory = number < len(parts)
                handle = kernel.CreateFileW(str(current), 0x80 if directory else 0x80000000,
                                            3 if directory else 1, None, 3,
                                            0x00200000 | (0x02000000 if directory else 0), None)
                if handle == ctypes.c_void_p(-1).value:
                    raise ProcessingError('Input unavailable or changed')
                handles.append(handle)
                info = Info()
                if (not kernel.GetFileInformationByHandle(handle, ctypes.byref(info)) or
                        info.attributes & 0x400 or bool(info.attributes & 0x10) != directory):
                    raise ProcessingError('Unsafe input link or type')
            descriptor = msvcrt.open_osfhandle(handles[-1], os.O_RDONLY | os.O_BINARY)
            handles.pop()  # descriptor owns the leaf handle now
            with os.fdopen(descriptor, 'rb') as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    raise ProcessingError('A regular input file is required')
                yield source
        finally:
            for handle in reversed(handles):
                kernel.CloseHandle(handle)
    else:
        handles = []
        try:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
            handles.append(os.open(root, flags))
            for component in parts[:-1]:
                handles.append(os.open(component, flags, dir_fd=handles[-1]))
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK,
                                 dir_fd=handles[-1])
            with os.fdopen(descriptor, 'rb') as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    raise ProcessingError('A regular input file is required')
                yield source
        finally:
            for descriptor in reversed(handles):
                os.close(descriptor)


class ArchiveManifest:
    def __init__(self, index):
        self.index = index
        self.writer = None
        self.pending = 0
        with index.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS archive_manifest(id INTEGER PRIMARY KEY,name TEXT NOT NULL,key TEXT UNIQUE NOT NULL,directory INTEGER NOT NULL,size INTEGER NOT NULL,sha256 TEXT)')

    def reset(self):
        with self.index.connect() as db:
            db.execute('DELETE FROM archive_manifest')

    def begin(self):
        self.writer = sqlite3.connect(self.index.database, timeout=15)
        self.writer.execute('BEGIN IMMEDIATE')

    def close(self, success=False):
        if self.writer is not None:
            try:
                if success:
                    self.writer.commit()
                    self.index.checkpoint()
                else:
                    self.writer.rollback()
            finally:
                self.writer.close()
                self.writer = None

    def add(self, entry_id, name, directory, size, digest):
        name = safe_path(name, directory)
        key = name.rstrip('/').casefold()
        with nullcontext(self.writer) if self.writer is not None else self.index.connect() as db:
            if db.execute('SELECT 1 FROM archive_manifest WHERE key=?', (key,)).fetchone():
                raise ProcessingError('Duplicate archive path')
            for parent in Path(key).parents:
                normalized = parent.as_posix()
                if normalized != '.' and db.execute('SELECT 1 FROM archive_manifest WHERE key=? AND directory=0', (normalized,)).fetchone():
                    raise ProcessingError('Conflicting archive paths')
            if not directory and db.execute('SELECT 1 FROM archive_manifest WHERE key>=? AND key<? LIMIT 1', (key + '/', key + '0')).fetchone():
                raise ProcessingError('Conflicting archive paths')
            db.execute('INSERT INTO archive_manifest VALUES (?,?,?,?,?,?)', (entry_id, name, key, int(directory), size, digest))
            if self.writer is not None:
                self.pending += 1
                if self.pending >= 256:
                    self.writer.commit()
                    self.index.checkpoint()
                    self.writer.execute('BEGIN IMMEDIATE')
                    self.pending = 0
        return name

    def page(self, after=0, limit=100):
        if type(after) is not int or not 0 <= after <= 2**63 - 1 or type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('Invalid manifest page')
        with self.index.connect() as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute('SELECT id,name,directory,size,sha256 FROM archive_manifest WHERE id>? ORDER BY id LIMIT ?', (after, limit))]

    def rows(self):
        after = 0
        while page := self.page(after, 1000):
            yield from page
            after = page[-1]['id']


class DigestReader:
    def __init__(self, source, ctx):
        self.source, self.ctx = source, ctx
        self.digest = hashlib.sha256()
        self.size = 0

    def read(self, size):
        self.ctx.check()
        data = self.source.read(size)
        self.digest.update(data)
        self.size += len(data)
        self.ctx.bytes += len(data)
        self.ctx.report(processed=self.ctx.bytes, entries=self.ctx.count)
        return data


def compress_index(index, output, target, ctx):
    if output.exists() or output.is_symlink():
        raise FileExistsError('Output already exists')
    if target not in TARGETS:
        raise ProcessingError('Indexed compression supports TAR formats only')
    summary = index.summary()
    if summary['pendingDirectories'] or summary['errors']:
        raise ProcessingError('Discovery incomplete or inputs need attention')
    if summary['entries'] > ctx.limits['files']:
        raise ProcessingError('Too many files')
    manifest = ArchiveManifest(index)
    manifest.reset()
    descriptor, temporary = tempfile.mkstemp(prefix=output.name + '.part-', dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary)
    after = total_input = count = 0
    try:
        manifest.begin()
        # Match payload reads to the engine's bounded I/O block and coalesce
        # small writes from tarfile before checking and writing the output.
        with (
            BoundedWriter(temporary, ctx) as bounded,
            tarfile.open(fileobj=bounded, mode='w|' + TARGETS[target], format=tarfile.PAX_FORMAT,
                         bufsize=TAR_WRITE_BUFFER, copybufsize=BLOCK) as archive,
        ):
            while page := index.page(after=after, limit=256):
                for entry in page:
                    ctx.check()
                    if entry['kind'] not in ('file', 'directory'):
                        raise ProcessingError('Unsupported input link, device or discovery error')
                    directory = entry['kind'] == 'directory'
                    name = safe_path(entry['path'], directory)
                    info = tarfile.TarInfo(name)
                    info.mtime = 0
                    info.mode = 0o755 if directory else 0o644
                    if directory:
                        info.type = tarfile.DIRTYPE
                        manifest.add(entry['id'], name, True, 0, None)
                        archive.addfile(info)
                    else:
                        if entry['size'] > ctx.limits['input'] - total_input:
                            raise ProcessingError('Input size limit reached')
                        with open_source(index.root, entry['path']) as source:
                            before = os.fstat(source.fileno())
                            if before.st_size != entry['size'] or before.st_mtime_ns != entry['mtime_ns']:
                                raise ProcessingError('Input changed since discovery')
                            info.size = before.st_size
                            reader = DigestReader(source, ctx)
                            archive.addfile(info, reader)
                            end = os.fstat(source.fileno())
                            if source.read(1) or reader.size != info.size or end.st_size != before.st_size or end.st_mtime_ns != before.st_mtime_ns:
                                raise ProcessingError('Input changed during processing')
                            manifest.add(entry['id'], name, False, reader.size, reader.digest.hexdigest())
                            total_input += reader.size
                    archive.members.clear()  # tarfile otherwise caches every TarInfo, even in streaming mode
                    count += 1
                    ctx.count = count
                after = page[-1]['id']
        manifest.close(success=True)
        ctx.report(state='verifying', phase='verifying')
        # Compare ordered names, types, sizes and SHA-256; never materialize a full list.
        with READERS[target](temporary, 'rb') as decoded, tarfile.open(fileobj=decoded, mode='r|') as archive:
            for row in manifest.rows():
                ctx.check()
                info = archive.next()
                if (info is None or info.name.rstrip('/') != row['name'].rstrip('/') or
                        info.isdir() != bool(row['directory']) or (not info.isdir() and not info.isfile()) or info.size != row['size']):
                    raise ProcessingError('Archive verification failed')
                if not info.isdir():
                    with archive.extractfile(info) as source:
                        digest = ctx.copy(source, Sink(), progress=False, expected=row['size'])
                    if digest['sha256'] != row['sha256']:
                        raise ProcessingError('Integrity check failed')
                archive.members.clear()
            if archive.next() is not None:
                raise ProcessingError('Unexpected archive member')
            # tarfile stops at the end marker. Drain the underlying decoder
            # through EOF so it validates the compression trailer.
            ctx.check()
            tail = decoded.read(BLOCK + 1)
            if len(tail) > BLOCK or tail.strip(b'\x00'):
                raise ProcessingError('Invalid archive padding')
        ctx.check()
        with temporary.open('r+b') as stream:
            os.fsync(stream.fileno())
        os.link(temporary, output)  # atomic and exclusive; never overwrite an existing output
        return {'entries': count, 'inputBytes': total_input, 'manifestStorage': 'index'}
    finally:
        manifest.close()
        temporary.unlink(missing_ok=True)


def manifest_page(database, after=0, limit=100):
    if type(after) is not int or not 0 <= after <= 2**63 - 1 or type(limit) is not int or not 1 <= limit <= 1000:
        raise ValueError('Invalid manifest page')
    db = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True, timeout=15)
    try:
        db.row_factory = sqlite3.Row
        return [dict(row) for row in db.execute('SELECT id,name,directory,size,sha256 FROM archive_manifest WHERE id>? ORDER BY id LIMIT ?', (after, limit))]
    finally:
        db.close()
