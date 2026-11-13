"""Bounded streaming operations. No extractall, shell commands, or whole-file reads."""
from __future__ import annotations

import bz2
from collections import deque
from contextlib import contextmanager
import gzip
import hashlib
import io
from itertools import zip_longest
import json
import lzma
import math
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
from tempfile import TemporaryDirectory
import time
import unicodedata
import zipfile
import zlib

from .media_policy import AUDIO_TARGETS, H264_TARGET, validate_conversion_options

BLOCK = 1024 * 1024
ARCHIVES = ("zip", "tar", "tar.gz", "tar.bz2", "tar.xz", "gzip", "bzip2", "xz")
ZSTD_TAR = "tar.zst"
ZSTD_TAR_SUFFIXES = (".tar.zst", ".tar.zstd", ".tzst")
IMAGE_TARGETS = ("png", "webp", "jpg", "tiff")
MEDIA = (*AUDIO_TARGETS, "mp4", "mkv", "webm", *IMAGE_TARGETS, H264_TARGET)
ZIP_PROFILES = {"auto": 6, "fastest": 1, "balanced": 6, "maximum": 9}
TAR_CODECS = {
    "gzip": (gzip.open, (".tar.gz", ".tgz")),
    "bzip2": (bz2.open, (".tar.bz2", ".tbz", ".tbz2")),
    "xz": (lzma.open, (".tar.xz", ".txz")),
}


def archive_formats():
    from .native import capability
    return ARCHIVES + ((ZSTD_TAR, "zstd") if capability() else ())


def archive_working_copies(job):
    if job["operation"] == "compress" and job["target"] == ZSTD_TAR:
        return 2
    if job["operation"] == "extract" and job.get("recursive"):
        # Nested compressed members, a decoded TAR, and the output ZIP can
        # coexist while the current member is read.
        return 3
    if (job["operation"] in ("extract", "verify") and job.get("format") == "zstd"
            and named_zstd_tar(job["name"])):
        return 2
    return 1


class ProcessingError(Exception):
    pass


def safe_path(value: str, directory: bool = False) -> str:
    if not isinstance(value, str):
        raise ProcessingError("Unsafe filename")
    value = unicodedata.normalize("NFC", value.replace("\\", "/"))
    if directory:
        value = value.rstrip("/")
    parts = value.split("/")
    if (not value or len(value) > 1024 or value.startswith("/") or
        any(p in ("", ".", "..") or p.rstrip(" .") != p or
            re.search(r'[\x00-\x1f\x7f:<>"|?*]', p) or
            re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])", p.split(".", 1)[0].rstrip(" "))
            for p in parts)):
        raise ProcessingError("Unsafe filename")
    return value + ("/" if directory else "")


def detect(path: Path) -> str:
    with path.open("rb") as stream:
        head = stream.read(512)
    return detect_header(head)


def detect_header(head: bytes) -> str:
    if head[:4] in (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"):
        return "zip"
    if head.startswith(b"\x1f\x8b"):
        return "gzip"
    if head.startswith(b"BZh"):
        return "bzip2"
    if head.startswith(b"\xfd7zXZ\x00"):
        return "xz"
    if head.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7z"
    if head.startswith(b"Rar!\x1a\x07"):
        return "rar"
    if head.startswith(b"\x28\xb5\x2f\xfd"):
        return "zstd"
    if head[257:262] == b"ustar":
        return "tar"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith((b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")):
        return "tiff"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand == b"avif":
            return "avif"
        if brand == b"avis":
            return "avif-sequence"
        if brand in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"):
            return "heic"
        if brand in (b"M4A ", b"M4B "):
            return "m4a"
        return "mp4"
    if head[:4] == b"\x1aE\xdf\xa3":
        return "mkv"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if head.startswith(b"fLaC"):
        return "flac"
    if head.startswith(b"OggS"):
        return "ogg"
    if head.startswith(b"ID3") or len(head) > 1 and head[0] == 255 and head[1] & 0xE0 == 0xE0:
        return "mp3"
    if head.startswith(b"%PDF-"):
        return "pdf"
    return "file"


class Context:
    def __init__(self, root: Path, limits: dict, report=lambda **kw: None):
        self.root, self.limits, self.report = root, limits, report
        self.bytes = 0
        self.expanded = 0
        self.count = 0
        self.paths: set[str] = set()
        self.file_paths: set[str] = set()
        self.parent_paths: set[str] = set()
        self.started = time.monotonic()

    def check(self):
        if (self.root / "cancel").exists():
            raise ProcessingError("Cancelled")
        if time.monotonic() - self.started > self.limits["seconds"]:
            raise ProcessingError("Processing time limit reached")

    def register(self, name: str, directory=False):
        name = safe_path(name, directory)
        key = name.rstrip("/").casefold()
        if key in self.paths:
            raise ProcessingError("Duplicate archive path")
        parents = [key[:index] for index, char in enumerate(key) if char == "/"]
        if any(parent in self.file_paths for parent in parents) or (
            not directory and key in self.parent_paths
        ):
            raise ProcessingError("Conflicting archive paths")
        if self.count >= self.limits["files"]:
            raise ProcessingError("Too many files")
        if not directory:
            self.file_paths.add(key)
        self.paths.add(key)
        self.parent_paths.update(parents)
        self.count += 1
        return name

    def copy(self, source, target, *, expanding=False, progress=True, expected=None):
        digest = hashlib.sha256()
        size = 0
        while True:
            self.check()
            data = source.read(BLOCK)
            if not data:
                break
            size += len(data)
            if expanding:
                self.expanded += len(data)
                if self.expanded > self.limits["expanded"]:
                    raise ProcessingError("Expanded size limit reached")
            if expected is not None and size > expected:
                raise ProcessingError("Invalid file size")
            target.write(data)
            digest.update(data)
            if progress:
                self.bytes += len(data)
                self.report(processed=self.bytes, entries=self.count)
        if expected is not None and size != expected:
            raise ProcessingError("Incomplete file")
        return {"size": size, "sha256": digest.hexdigest()}


class Sink:
    def write(self, data):
        return len(data)


class BoundedWriter(io.BufferedWriter):
    def __init__(self, path: Path, ctx: Context):
        super().__init__(path.open("wb", buffering=0))
        self.context = ctx

    def write(self, data):
        self.context.check()
        if self.tell() + len(data) > self.context.limits["expanded"]:
            raise ProcessingError("Output size limit reached")
        return super().write(data)


def pax_size(data: bytes, maximum: int):
    """Validate PAX framing and return the local file size override, if any."""
    position = 0
    size = None
    while position < len(data):
        separator = data.find(b" ", position, position + 9)
        length = data[position:separator] if separator >= 0 else b""
        if not length.isdigit():
            raise ProcessingError("Invalid archive PAX metadata")
        end = position + int(length)
        if not separator + 3 < end <= len(data) or data[end - 1] != 10:
            raise ProcessingError("Invalid archive PAX metadata")
        key, equals, value = data[separator + 1:end - 1].partition(b"=")
        if not key or not equals or b"\x00" in key:
            raise ProcessingError("Invalid archive PAX metadata")
        if key.startswith(b"GNU.sparse."):
            raise ProcessingError("Unsupported sparse archive")
        if key == b"size":
            if not value.isdigit() or len(value) > len(str(maximum)) or int(value) > maximum:
                raise ProcessingError("Expanded size limit reached")
            size = int(value)
        position = end
    return size


def validate_tar(path: Path, ctx: Context, opener=None):
    """Walk the same payload boundaries tarfile will use for extraction."""
    pax_types = (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE)
    local_types = (tarfile.XHDTYPE, tarfile.SOLARIS_XHDTYPE, tarfile.GNUTYPE_LONGNAME)
    total, headers = 0, 0
    local_header = False
    metadata_chain = 0
    global_metadata = 0
    size_override = None
    maximum = ctx.limits["expanded"]
    limit = maximum + ctx.limits["files"] * 1024
    with (opener(path, "rb") if opener else path.open("rb")) as stream:
        while True:
            ctx.check()
            header = stream.read(512)
            if not header:
                raise ProcessingError("Truncated archive end marker")
            if header == bytes(512):
                if metadata_chain:
                    raise ProcessingError("Truncated archive metadata")
                break
            if len(header) != 512:
                raise ProcessingError("Truncated archive")
            headers += 1
            if headers > ctx.limits["files"] * 3:
                raise ProcessingError("Too many archive entries")
            # tarfile's parser handles checksum and base-256 number validation.
            info = tarfile.TarInfo.frombuf(header, "utf-8", "surrogateescape")
            if info.size < 0:
                raise ProcessingError("Expanded size limit reached")
            metadata = info.type in pax_types or info.type in local_types
            size = info.size
            if metadata:
                metadata_chain += 1
                if local_header or metadata_chain > 8 or size > BLOCK:
                    raise ProcessingError("Unsupported archive metadata")
                local_header = info.type in local_types
            else:
                if info.type == tarfile.GNUTYPE_SPARSE:
                    raise ProcessingError("Unsupported sparse archive")
                if not (info.isfile() or info.isdir()):
                    raise ProcessingError("Unsafe archive link or device")
                if info.isdir() and (size or size_override):
                    raise ProcessingError("Invalid archive directory size")
                if size_override is not None:
                    size = size_override
                size_override = None
                local_header = False
                metadata_chain = 0
            if size > maximum:
                raise ProcessingError("Expanded size limit reached")
            remaining = (size + 511) // 512 * 512
            total += remaining + 512
            if total > limit:
                raise ProcessingError("Expanded size limit reached")
            if info.type in pax_types:
                payload = stream.read(remaining)
                if len(payload) != remaining:
                    raise ProcessingError("Truncated archive metadata")
                if payload[size:].strip(b"\x00"):
                    raise ProcessingError("Invalid archive PAX metadata padding")
                size_override = pax_size(payload[:size], maximum)
                if info.type == tarfile.XGLTYPE:
                    if size_override is not None:
                        raise ProcessingError("Unsupported global PAX size")
                    global_metadata += size
                    if global_metadata > BLOCK:
                        raise ProcessingError("Unsupported archive metadata")
                continue
            while remaining:
                ctx.check()
                chunk = stream.read(min(BLOCK, remaining))
                if not chunk:
                    raise ProcessingError("Truncated archive")
                remaining -= len(chunk)
        # Read through the compression trailer and allow only bounded zero padding.
        if stream.read(512) != bytes(512):
            raise ProcessingError("Invalid archive end marker")
        padding = 1024
        while True:
            ctx.check()
            chunk = stream.read(min(BLOCK, BLOCK - padding + 1))
            if not chunk:
                break
            padding += len(chunk)
            if padding > BLOCK or chunk.strip(b"\x00"):
                raise ProcessingError("Invalid archive padding")


def validate_zip(path: Path, ctx: Context):
    """Bound central-directory allocation, including ZIP64, before ZipFile reads it."""
    with path.open("rb") as stream:
        size = path.stat().st_size
        stream.seek(max(0, size - 65557))
        tail = stream.read(65557)
        index = tail.rfind(b"PK\x05\x06")
        if index < 0 or len(tail) - index < 22:
            raise ProcessingError("Corrupted archive")
        end = tail[index:]
        if len(end) != 22 + struct.unpack_from("<H", end, 20)[0]:
            raise ProcessingError("Invalid archive footer")
        disk, start_disk, disk_entries, count, central_size, central_offset = struct.unpack_from("<HHHHII", end, 4)
        if disk or start_disk or disk_entries != count:
            raise ProcessingError("Split archives are unsupported")
        central_end = size - len(end)
        locator = b""
        if central_end >= 20:
            stream.seek(central_end - 20)
            locator = stream.read(20)
        # Readers can prefer ZIP64 metadata even when the classic fields fit.
        if locator.startswith(b"PK\x06\x07"):
            locator_disk, record_offset, disks = struct.unpack_from("<IQI", locator, 4)
            if locator_disk or disks != 1:
                raise ProcessingError("Split archives are unsupported")
            central_end -= 76
            if central_end < 0 or record_offset != central_end:
                raise ProcessingError("Invalid ZIP64 archive")
            stream.seek(central_end)
            record = stream.read(56)
            if len(record) != 56 or record[:4] != b"PK\x06\x06":
                raise ProcessingError("Invalid ZIP64 archive")
            if struct.unpack_from("<Q", record, 4)[0] != 44:
                raise ProcessingError("Unsupported ZIP64 metadata")
            disk, start_disk, disk_entries, count, central_size, central_offset = struct.unpack_from("<IIQQQQ", record, 16)
            if disk or start_disk or disk_entries != count:
                raise ProcessingError("Split archives are unsupported")
        if count > ctx.limits["files"] or central_size > ctx.limits["files"] * 4096 + BLOCK:
            raise ProcessingError("Too many archive entries")
        if central_offset + central_size != central_end:
            raise ProcessingError("Invalid archive index")
        # The footer count is untrusted. Count actual records before ZipFile
        # allocates an object per member.
        stream.seek(central_offset)
        actual = 0
        while stream.tell() < central_end:
            ctx.check()
            header = stream.read(46)
            if len(header) != 46 or header[:4] != b"PK\x01\x02":
                raise ProcessingError("Invalid archive index")
            actual += 1
            if actual > ctx.limits["files"]:
                raise ProcessingError("Too many archive entries")
            stream.seek(sum(struct.unpack_from("<HHH", header, 28)), io.SEEK_CUR)
        if stream.tell() != central_end or actual != count:
            raise ProcessingError("Invalid archive index")


def file_digest(path: Path, context: Context):
    with path.open("rb") as stream:
        return context.copy(stream, Sink(), progress=False)


def encode_zip_comment(comment):
    if not isinstance(comment, str) or len(comment) > 1024 or any(not " " <= char <= "~" for char in comment):
        raise ProcessingError("ZIP comments must be at most 1024 printable ASCII characters")
    return comment.encode("ascii")


def compress(inputs, output: Path, target: str, ctx: Context, *, zip_profile="balanced", zip_comment=""):
    comment = encode_zip_comment(zip_comment)
    if comment and target != "zip":
        raise ProcessingError("Archive comments require ZIP")
    if target == ZSTD_TAR:
        from .native import run
        with TemporaryDirectory(prefix="tar-zstd-", dir=ctx.root) as folder:
            tar = Path(folder) / "archive.tar"
            manifest = compress(inputs, tar, "tar", ctx)
            result = run("compress", tar, output, ctx, progress=False,
                         input_limit=ctx.limits["expanded"])
            if result["inputBytes"] > max(1, result["outputBytes"]) * ctx.limits["ratio"]:
                output.unlink()
                raise ProcessingError("Archive expansion ratio limit reached")
        return manifest
    manifest = []
    names = ((item, ctx.register(item["name"], item.get("directory", False))) for item in inputs)
    if not (target == "zip" or target.startswith("tar")):
        names = iter(list(names))
    if target == "zstd":
        from .native import run
        if len(inputs) != 1 or inputs[0].get("directory"):
            raise ProcessingError("Choose one file for this format")
        source = Path(inputs[0]["path"])
        original = file_digest(source, ctx)
        # The kernel decodes and byte-compares against the original through the
        # same open handle before publishing. Recheck its source SHA-256 here;
        # materializing a second full-size decoded file would exceed the job's
        # temporary-storage reservation for large compressible inputs.
        run("compress", source, output, ctx)
        ctx.report(state="verifying")
        if file_digest(source, ctx) != original:
            raise ProcessingError("Input changed during verification")
        manifest.append({"name": next(names)[1], **original})
    elif target == "zip":
        if zip_profile not in ZIP_PROFILES:
            raise ProcessingError("Unsupported ZIP compression profile")
        with BoundedWriter(output, ctx) as bounded, zipfile.ZipFile(
            bounded, "w", compression=zipfile.ZIP_DEFLATED,
            compresslevel=ZIP_PROFILES[zip_profile], allowZip64=True,
        ) as archive:
            archive.comment = comment
            for item, name in names:
                ctx.check()
                if item.get("directory"):
                    archive.writestr(name, b"")
                    manifest.append({"name": name, "directory": True, "size": 0})
                else:
                    with Path(item["path"]).open("rb") as source:
                        entry = name
                        if zip_profile == "auto":
                            sample = source.read(64 * 1024)
                            source.seek(0)
                            if not sample or len(zlib.compress(sample, level=1)) >= len(sample) * 0.99:
                                entry = zipfile.ZipInfo(name)  # ZIP_STORED for this member.
                        with archive.open(entry, "w", force_zip64=True) as dest:
                            manifest.append({"name": name, **ctx.copy(source, dest)})
        ctx.report(state="verifying")
        with zipfile.ZipFile(output) as archive:
            if archive.comment != comment or archive.namelist() != [row["name"] for row in manifest]:
                raise ProcessingError("Archive verification failed")
            for row in manifest:
                if not row.get("directory"):
                    with archive.open(row["name"]) as source:
                        actual = ctx.copy(source, Sink(), progress=False, expected=row["size"])
                    if actual["sha256"] != row["sha256"]:
                        raise ProcessingError("Integrity check failed")
    elif target.startswith("tar"):
        mode = {"tar": "", "tar.gz": "gz", "tar.bz2": "bz2", "tar.xz": "xz"}[target]
        with BoundedWriter(output, ctx) as bounded, tarfile.open(fileobj=bounded, mode="w|" + mode, format=tarfile.PAX_FORMAT) as archive:
            for item, name in names:
                info = tarfile.TarInfo(name)
                info.mtime = 0
                info.mode = 0o755 if item.get("directory") else 0o644
                if item.get("directory"):
                    info.type = tarfile.DIRTYPE
                    archive.addfile(info)
                    manifest.append({"name": name, "directory": True, "size": 0})
                else:
                    path = Path(item["path"])
                    info.size = path.stat().st_size
                    digest = file_digest(path, ctx)
                    with path.open("rb") as source:
                        archive.addfile(info, source)
                    ctx.bytes += info.size
                    ctx.report(processed=ctx.bytes, entries=ctx.count)
                    manifest.append({"name": name, **digest})
                archive.members.clear()  # Writers cache TarInfo even in stream mode.
        ctx.report(state="verifying")
        with open_tar_stream(name=output, mode="r|*") as archive:
            for info, row in zip_longest(archive, manifest):
                ctx.check()
                if info is None or row is None:
                    raise ProcessingError("Archive verification failed")
                name = info.name.rstrip("/") + ("/" if info.isdir() else "")
                if name != row["name"] or not (info.isdir() if row.get("directory") else info.isfile()):
                    raise ProcessingError("Archive verification failed")
                if info.isfile():
                    actual = ctx.copy(archive.extractfile(info), Sink(), progress=False, expected=row["size"])
                    if actual["sha256"] != row["sha256"]:
                        raise ProcessingError("Integrity check failed")
    else:
        if len(inputs) != 1 or inputs[0].get("directory"):
            raise ProcessingError("Choose one file for this format")
        opener = {"gzip": gzip.open, "bzip2": bz2.open, "xz": lzma.open}[target]
        with Path(inputs[0]["path"]).open("rb") as source, BoundedWriter(output, ctx) as bounded, opener(bounded, "wb") as dest:
            row = ctx.copy(source, dest)
        ctx.report(state="verifying")
        with opener(output, "rb") as source:
            actual = ctx.copy(source, Sink(), progress=False, expected=row["size"])
        if row != actual:
            raise ProcessingError("Integrity check failed")
        manifest.append({"name": next(names)[1], **row})
    return manifest


def zip_members(archive, ctx: Context, indexes=None):
    items = archive.infolist()
    if indexes is not None:
        if max(indexes) >= len(items):
            raise ProcessingError("Invalid archive member selection")
        items = [items[index] for index in indexes]
    for item in items:
        ctx.check()
        if "\x00" in item.orig_filename or "\x00" in item.filename:
            raise ProcessingError("Unsafe filename")
        if item.is_dir() and (item.file_size or item.CRC):
            raise ProcessingError("Invalid archive directory size or checksum")
        if item.flag_bits & 1:
            raise ProcessingError("Unsupported password-protected ZIP")
        mode = item.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ProcessingError("Unsafe archive link or device")
        if item.file_size > max(1, item.compress_size) * ctx.limits["ratio"]:
            raise ProcessingError("Archive expansion ratio limit reached")
        yield item


def verify_zip(source: Path, output: Path, ctx: Context):
    """Verify ZIP member CRCs and sizes without materializing extracted files."""
    if detect(source) != "zip":
        raise ProcessingError("Unsupported archive for ZIP verification")
    validate_zip(source, ctx)
    manifest = []
    with zipfile.ZipFile(source) as archive:
        for item in zip_members(archive, ctx):
            if item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ProcessingError("Unsupported ZIP compression method for verification")
            name = ctx.register(item.filename, item.is_dir())
            with archive.open(item) as stream:
                record = ctx.copy(stream, Sink(), expanding=True, progress=False, expected=item.file_size)
            manifest.append({"name": name, "directory": item.is_dir(), **record})
            ctx.report(entries=ctx.count, expanded=ctx.expanded)
    return write_archive_report(output, ctx, {"format": "zip", "verified": True, "entries": manifest})


def write_archive_report(output: Path, ctx: Context, data: dict):
    ctx.report(state="verifying")
    with BoundedWriter(output, ctx) as report:
        for chunk in json.JSONEncoder(ensure_ascii=True).iterencode(data):
            report.write(chunk.encode("ascii"))
    return data["entries"]


def tar_source(path, name, kind):
    opener, suffixes = TAR_CODECS.get(kind, (None, (".tar",)))
    if kind == "tar":
        return True, None
    if opener or kind == "file" and name.lower().endswith(suffixes):
        with (opener(path, "rb") if opener else path.open("rb")) as stream:
            head = stream.read(512)
        # Empty TAR has no magic. The suffix disambiguates a zero block from
        # ordinary compressed data starting with zeros.
        return len(head) == 512 and (head[257:262] == b"ustar"
                                     or head == bytes(512) and name.lower().endswith(suffixes)), opener
    return False, None


def open_tar_stream(**kwargs):
    # Python 3.13 can iterate TAR members without retaining every TarInfo.
    if sys.version_info >= (3, 13):
        kwargs["stream"] = True
    return tarfile.open(**kwargs)


def read_tar_members(path, ctx, opener, consume):
    validate_tar(path, ctx, opener)
    with (
        (opener(path, "rb") if opener else path.open("rb")) as raw,
        open_tar_stream(fileobj=raw, mode="r|") as archive,
    ):
        for item in archive:
            ctx.check()
            if item.isdir():
                consume(item.name, None, 0, True)
            elif item.isfile():
                with archive.extractfile(item) as stream:
                    consume(item.name, stream, item.size)
            else:
                raise ProcessingError("Unsafe archive link or device")


def named_zstd_tar(name):
    return name.lower().endswith(ZSTD_TAR_SUFFIXES)


@contextmanager
def decoded_zstd_tar(path, ctx):
    from .native import run
    maximum = min(ctx.limits["expanded"] - ctx.expanded,
                  max(1, path.stat().st_size) * ctx.limits["ratio"])
    if maximum < 1024:
        raise ProcessingError("Expanded size limit reached")
    with TemporaryDirectory(prefix="tar-zstd-", dir=ctx.root) as folder:
        decoded = Path(folder) / "archive.tar"
        run("decompress", path, decoded, ctx, output_limit=maximum, progress=False)
        is_tar, _ = tar_source(decoded, decoded.name, detect(decoded))
        if not is_tar:
            raise ProcessingError("Zstandard content is not a TAR archive")
        yield decoded


def verify_archive(source: Path, original_name: str, output: Path, ctx: Context):
    kind = detect(source)
    if kind == "zip":
        return verify_zip(source, output, ctx)
    zstd_tar = kind == "zstd" and named_zstd_tar(original_name)
    is_tar, opener = tar_source(source, original_name, kind)
    if not is_tar and not zstd_tar:
        raise ProcessingError("Unsupported archive for integrity verification")
    manifest = []

    def verify_member(name, stream, size, directory=False):
        normalized = ctx.register(name, directory)
        record = {"size": 0} if directory else ctx.copy(
            stream, Sink(), expanding=True, progress=False, expected=size)
        manifest.append({"name": normalized, "directory": directory, **record})
        ctx.report(entries=ctx.count, expanded=ctx.expanded)

    if zstd_tar:
        with decoded_zstd_tar(source, ctx) as decoded:
            read_tar_members(decoded, ctx, None, verify_member)
    else:
        read_tar_members(source, ctx, opener, verify_member)
    return write_archive_report(output, ctx, {
        "format": {"gzip": "tar.gz", "bzip2": "tar.bz2", "xz": "tar.xz", "zstd": ZSTD_TAR}.get(kind, "tar"),
        "verified": True, "scope": "structure-and-observed-member-digests", "entries": manifest,
    })


def extract(source: Path, original_name: str, output: Path, ctx: Context, recursive=False, zip_indexes=None, *, repack=False):
    if zip_indexes is not None and (recursive or detect(source) != "zip"):
        raise ProcessingError("Unsupported archive for selective ZIP extraction")
    manifest = []
    # Temporary files allow recursive inspection without buffering members in RAM.
    temp = ctx.root / "expanded"
    temp.mkdir(exist_ok=True)
    work = deque([(source, "", original_name, 0)])
    method = zipfile.ZIP_DEFLATED if repack else zipfile.ZIP_STORED
    with BoundedWriter(output, ctx) as bounded, zipfile.ZipFile(bounded, "w", compression=method, allowZip64=True) as result:
        while work:
            path, prefix, name, depth = work.popleft()
            ctx.check()
            if depth > ctx.limits["depth"]:
                raise ProcessingError("Archive nesting limit reached")
            kind = detect(path)

            def add_entry(entry_name, stream, size, directory=False):
                normalized = ctx.register(prefix + entry_name, directory)
                if size > ctx.limits["expanded"] - ctx.expanded:
                    raise ProcessingError("Expanded size limit reached")
                if directory:
                    result.writestr(normalized, b"")
                    manifest.append({"name": normalized, "directory": True, "size": 0})
                    return
                if not recursive:
                    with result.open(normalized, "w", force_zip64=True) as dest:
                        record = ctx.copy(stream, dest, expanding=True, progress=False, expected=size)
                    manifest.append({"name": normalized, **record})
                    ctx.report(entries=ctx.count, expanded=ctx.expanded)
                    return
                staging = temp / str(len(manifest))
                with staging.open("wb") as dest:
                    record = ctx.copy(stream, dest, expanding=True, progress=False, expected=size)
                # Retain the original member too: recursive inspection never silently removes it.
                with staging.open("rb") as src, result.open(normalized, "w", force_zip64=True) as dest:
                    ctx.copy(src, dest, progress=False)
                manifest.append({"name": normalized, **record})
                ctx.report(entries=ctx.count, expanded=ctx.expanded)
                nested = detect(staging)
                if nested in ("zip", "tar", "gzip", "bzip2", "xz", "zstd"):
                    work.append((staging, normalized + ".contents/", entry_name, depth + 1))
                else:
                    staging.unlink()

            if kind == "zip":
                validate_zip(path, ctx)
                with zipfile.ZipFile(path) as archive:
                    for item in zip_members(archive, ctx, zip_indexes):
                        with archive.open(item) as stream:
                            add_entry(item.filename, stream, item.file_size, item.is_dir())
            elif kind in ("tar", "gzip", "bzip2", "xz"):
                is_tar, opener = tar_source(path, name, kind)
                if is_tar:
                    read_tar_members(path, ctx, opener, add_entry)
                else:
                    leaf = re.sub(r"\.(gz|gzip|bz2|xz)$", "", Path(name).name, flags=re.I)
                    if leaf == Path(name).name:
                        leaf += ".out"
                    # Stream sizes are unknown; copy with the cumulative budget before adding.
                    staging = temp / ("stream-" + str(depth) + "-" + str(len(manifest)))
                    with opener(path, "rb") as stream, staging.open("wb") as dest:
                        record = ctx.copy(stream, dest, expanding=True, progress=False)
                    normalized = ctx.register(prefix + leaf)
                    with staging.open("rb") as src, result.open(normalized, "w", force_zip64=True) as dest:
                        ctx.copy(src, dest, progress=False)
                    manifest.append({"name": normalized, **record})
                    ctx.report(entries=ctx.count, expanded=ctx.expanded)
                    if recursive and detect(staging) in ("zip", "tar", "gzip", "bzip2", "xz", "zstd"):
                        work.append((staging, normalized + ".contents/", leaf, depth + 1))
                    else:
                        staging.unlink()
            elif kind == "zstd" and named_zstd_tar(name):
                with decoded_zstd_tar(path, ctx) as decoded:
                    read_tar_members(decoded, ctx, None, add_entry)
            elif kind == "zstd":
                from .native import run
                leaf = re.sub(r"\.(zst|zstd)$", "", Path(name).name, flags=re.I)
                if leaf == Path(name).name:
                    leaf += ".out"
                staging = temp / ("native-" + str(depth) + "-" + str(len(manifest)))
                maximum = min(ctx.limits["expanded"] - ctx.expanded, max(1, path.stat().st_size) * ctx.limits["ratio"])
                run("decompress", path, staging, ctx, output_limit=maximum, progress=False)
                record = file_digest(staging, ctx)
                ctx.expanded += record["size"]
                normalized = ctx.register(prefix + leaf)
                with staging.open("rb") as src, result.open(normalized, "w", force_zip64=True) as dest:
                    ctx.copy(src, dest, progress=False)
                manifest.append({"name": normalized, **record})
                ctx.report(entries=ctx.count, expanded=ctx.expanded)
                if recursive and detect(staging) in ("zip", "tar", "gzip", "bzip2", "xz", "zstd"):
                    work.append((staging, normalized + ".contents/", leaf, depth + 1))
                else:
                    staging.unlink()
            else:
                raise ProcessingError("Unsupported archive")
            if path.parent == temp:
                path.unlink(missing_ok=True)
    ctx.report(state="verifying")
    with zipfile.ZipFile(output) as archive:
        if archive.namelist() != [row["name"] for row in manifest]:
            raise ProcessingError("Incomplete extraction")
        for row in manifest:
            if row.get("directory"):
                continue
            with archive.open(row["name"]) as stream:
                actual = ctx.copy(stream, Sink(), progress=False, expected=row["size"])
            if actual["sha256"] != row["sha256"]:
                raise ProcessingError("Integrity check failed")
    return manifest


# Restrict demuxers and protocols so playlists cannot read arbitrary paths/URLs.
INPUT_FORMATS = "mov,matroska,webm,avi,wav,mp3,flac,aac,ogg,mpeg,mpegvideo,mpegts,image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif"


def probe(path: Path, count_frames=False):
    args = [shutil.which("ffprobe") or "ffprobe", "-v", "error", "-max_alloc", str(64 * BLOCK), "-protocol_whitelist", "file,pipe", "-format_whitelist", INPUT_FORMATS]
    if count_frames:
        args += ["-count_frames"]
    args += ["-show_entries", "stream=index,codec_type,codec_name,sample_fmt,sample_rate,channels,bits_per_sample,bits_per_raw_sample,pix_fmt,width,height,duration,nb_frames,nb_read_frames:stream_disposition=attached_pic:stream_tags:format=format_name,duration:format_tags", "-of", "json", str(path)]
    proc = subprocess.run(args, capture_output=True, timeout=30)
    if proc.returncode or len(proc.stdout) > BLOCK:
        raise ProcessingError("Unsupported media")
    return json.loads(proc.stdout)


def _media_duration(metadata):
    try:
        duration = float(metadata.get("duration"))
    except (TypeError, ValueError):
        return None
    return duration if math.isfinite(duration) and duration > 0 else None


def decoded_digest(path: Path, ctx: Context, *, stream, encoding, container):
    """Hash canonical decoded pixels/PCM with fixed buffers and an expansion cap."""
    args = [shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-xerror", "-max_alloc", str(64 * BLOCK),
            "-protocol_whitelist", "file,pipe", "-format_whitelist", INPUT_FORMATS, "-threads", "2", "-i", str(path),
            "-threads", "2", "-map", stream]
    if container == 'rawvideo':
        args += ['-frames:v', '1', '-pix_fmt', encoding]
    else:
        args += ['-c:a', encoding]
    args += ['-f', container, 'pipe:1']
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    digest, size = hashlib.sha256(), 0
    try:
        while chunk := process.stdout.read(BLOCK):
            ctx.check()
            size += len(chunk)
            if size > ctx.limits['expanded']:
                raise ProcessingError('Decoded media verification limit reached')
            digest.update(chunk)
        if process.wait() or not size:
            raise ProcessingError('Decoded media verification failed')
        return size, digest.hexdigest()
    finally:
        if process.poll() is None:
            process.kill(); process.wait()
        process.stdout.close()


def verify_media_decode(path: Path, ctx: Context):
    """Read all output audio and video streams without retaining decoded data."""
    ctx.check()
    args = [shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-xerror",
            "-max_alloc", str(64 * BLOCK), "-protocol_whitelist", "file,pipe",
            "-format_whitelist", INPUT_FORMATS, "-threads", "2", "-i", str(path),
            "-map", "0:v?", "-map", "0:a?", "-threads", "2",
            "-abort_on", "empty_output+empty_output_stream",
            "-f", "null", "-"]
    with subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
        try:
            while True:
                ctx.check()
                try:
                    status = process.wait(timeout=0.25)
                    break
                except subprocess.TimeoutExpired:
                    continue
            if status:
                raise ProcessingError("Converted media could not be decoded")
        finally:
            if process.poll() is None:
                process.kill()


def require_single_tiff_page(source: Path):
    # FFmpeg may decode only the first page of a TIFF. Check the directory
    # chain and reject subimages before treating the input as a still image.
    with source.open('rb') as stream:
        header = stream.read(8)
        if len(header) != 8 or header[:4] not in (b'II*\x00', b'MM\x00*'):
            raise ProcessingError('Unsupported TIFF directory format')
        endian = '<' if header[:2] == b'II' else '>'
        offset = struct.unpack_from(endian + 'I', header, 4)[0]
        if offset < 8:
            raise ProcessingError('Invalid TIFF directory')
        stream.seek(offset)
        count_bytes = stream.read(2)
        if len(count_bytes) != 2:
            raise ProcessingError('Invalid TIFF directory')
        count = struct.unpack(endian + 'H', count_bytes)[0]
        entries = stream.read(count * 12 + 4)
        if not count or len(entries) != count * 12 + 4:
            raise ProcessingError('Invalid TIFF directory')
        if struct.unpack_from(endian + 'I', entries, count * 12)[0] or any(
            struct.unpack_from(endian + 'H', entries, index * 12)[0] == 330
            for index in range(count)
        ):
            raise ProcessingError('Choose a still image with one TIFF page and no subimages')


def convert(source: Path, output: Path, target: str, ctx: Context, quality_mode='lossless', metadata_policy='strip'):
    if target not in MEDIA:
        raise ProcessingError('Unsupported conversion format')
    try:
        validate_conversion_options(target, quality_mode, metadata_policy)
    except ValueError as error:
        raise ProcessingError(str(error)) from error
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise ProcessingError("Media engine unavailable")
    source_kind = detect(source)
    if source_kind == "tiff" and target in IMAGE_TARGETS:
        require_single_tiff_page(source)
    info = probe(source)
    audio = [s for s in info["streams"] if s["codec_type"] == "audio"]
    image = target in IMAGE_TARGETS
    transcode = target == H264_TARGET
    formats = set(info.get("format", {}).get("format_name", "").split(","))
    outputs = []
    if transcode:
        from .capabilities import media_targets
        if target not in media_targets():
            raise ProcessingError("H.264 MP4 conversion is unavailable in this FFmpeg build")
        video = [s for s in info["streams"] if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")]
        if not video or not formats.intersection({"mov", "matroska", "webm", "avi", "mpeg", "mpegvideo", "mpegts"}) or source_kind in ("avif", "avif-sequence", "heic"):
            raise ProcessingError("Choose a video for H.264 conversion")
        if any(s["width"] % 2 or s["height"] % 2 for s in video):
            raise ProcessingError("H.264 MP4 conversion requires even video dimensions")
        subtitle_count = sum(s["codec_type"] == "subtitle" for s in info["streams"])
    if image:
        if "tiff_pipe" in formats and source_kind != "tiff":
            require_single_tiff_page(source)
        if not formats.intersection({"image2", "png_pipe", "jpeg_pipe", "webp_pipe", "bmp_pipe", "tiff_pipe", "gif"}) and source_kind != "avif":
            raise ProcessingError("Choose a still image")
        frames = [s for s in probe(source, count_frames=True)["streams"] if s["codec_type"] == "video"]
        if len(frames) != 1 or frames[0].get("nb_read_frames") != "1":
            raise ProcessingError("Choose a still image")
        pixel_format = frames[0].get('pix_fmt', '')
        high_precision = bool(re.search(r'(?:9|10|12|14|16|32|48|64)(?:le|be)?$', pixel_format))
        if target == 'webp' and quality_mode == 'lossless' and high_precision:
            raise ProcessingError('WebP cannot preserve this image precision. Choose PNG or TIFF, or explicitly allow lossy conversion.')
        if target == 'jpg' and (pixel_format.startswith(('rgba', 'bgra', 'argb', 'abgr', 'yuva', 'gbrap', 'ya')) or pixel_format == 'pal8'):
            raise ProcessingError('JPEG cannot preserve transparency. Choose PNG or WebP.')
    tracks = audio if target in AUDIO_TARGETS else [None]
    if not tracks:
        raise ProcessingError("No audio track")
    for index, track in enumerate(tracks):
        remaining = ctx.limits["expanded"] - sum(row["size"] for row in outputs)
        if remaining <= 0:
            raise ProcessingError("Conversion output limit reached")
        destination = output if len(tracks) == 1 else ctx.root / f"audio-{index + 1}.{target}"
        args = [shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-xerror", "-y", "-max_alloc", str(64 * BLOCK),
                "-protocol_whitelist", "file,pipe", "-format_whitelist", INPUT_FORMATS, "-threads", "2", "-i", str(source), "-threads", "2"]
        if metadata_policy == 'preserve':
            args += ['-map_metadata', '0', '-map_chapters', '0']
        else:
            args += ['-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1']
        if track:
            args += ["-map", f"0:{track['index']}", "-vn"]
            bits = int(track.get("bits_per_raw_sample") or track.get("bits_per_sample") or 0)
            sample = track.get("sample_fmt", "")
            if target == 'flac' and quality_mode == 'lossless' and (sample.startswith(('flt', 'dbl')) or bits > 24):
                raise ProcessingError('FLAC cannot preserve this source precision. Choose WAV or explicitly allow lossy conversion.')
            pcm = "pcm_f64le" if sample.startswith("dbl") else "pcm_f32le" if sample.startswith("flt") else "pcm_s64le" if bits > 32 else "pcm_s32le" if bits > 24 else "pcm_s24le" if bits > 16 else "pcm_s16le"
            codecs = {"wav": pcm, "flac": "flac", "mp3": "libmp3lame", "aac": "aac", "m4a": "aac", "ogg": "libvorbis", "opus": "libopus"}
            args += ["-c:a", codecs[target]]
            if target == 'mp3':
                args += ['-q:a', '2']
            elif target in ('aac', 'm4a'):
                args += ['-b:a', '192k']
            elif target == 'ogg':
                args += ['-q:a', '5']
            elif target == 'opus':
                args += ['-b:a', '128k', '-ar', '48000']
            if target == "wav":
                args += ["-rf64", "auto"]
        elif image:
            args += ["-map", "0:v:0", "-frames:v", "1"]
            if target == 'webp':
                args += ['-c:v', 'libwebp', '-lossless', '1' if quality_mode == 'lossless' else '0', '-quality', '80']
                if quality_mode == 'lossless':
                    args += ['-pix_fmt', 'bgra']
            elif target == 'jpg':
                args += ['-q:v', '2']
            elif target == 'tiff':
                args += ['-c:v', 'tiff', '-pix_fmt', 'rgba64le' if high_precision else 'rgba']
        elif transcode:
            for stream in video:
                args += ["-map", f"0:{stream['index']}"]
            args += ["-map", "0:a?", "-map", "0:s?", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                     "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-c:s", "mov_text",
                     "-movflags", "+faststart", "-f", "mp4"]
        else:
            args += ["-map", "0:v?", "-map", "0:a?", "-map", "0:s?", "-c", "copy"]
        args += ["-fs", str(remaining), "-progress", "pipe:1", str(destination)]
        log = ctx.root / "media.log"
        with log.open("wb") as stderr:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=stderr, text=True)
            try:
                for line in process.stdout:
                    ctx.check()
                    if line.startswith("out_time_us="):
                        try:
                            ctx.report(mediaSeconds=max(0, int(line.strip().split("=", 1)[1])) / 1e6, track=index + 1, tracks=len(tracks))
                        except ValueError:
                            pass
                if process.wait() != 0:
                    raise ProcessingError("Conversion failed")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()
        if not destination.exists() or destination.stat().st_size == 0 or destination.stat().st_size >= remaining:
            raise ProcessingError("Conversion output limit reached")
        ctx.report(state="verifying")
        verified = probe(destination)
        if not verified.get("streams"):
            raise ProcessingError("Conversion verification failed")
        if track or image:
            expected_type = "audio" if track else "video"
            expected_codec = pcm if target == "wav" else {
                "flac": "flac", "mp3": "mp3",
                "aac": "aac", "m4a": "aac", "ogg": "vorbis", "opus": "opus",
                "png": "png", "webp": "webp", "jpg": "mjpeg", "tiff": "tiff",
            }[target]
            streams = [(stream["codec_type"], stream.get("codec_name")) for stream in verified["streams"]
                       if stream["codec_type"] in ("audio", "video")]
            if streams != [(expected_type, expected_codec)]:
                raise ProcessingError("Conversion output codec or stream count did not match")
        # Reject truncated outputs rather than treating FFmpeg's size-limited exit as success.
        if not image:
            # The container can outlast an individual audio track. Fall back
            # to its duration only when it describes the entire conversion.
            source_duration = _media_duration(track) if track else None
            if not track or (source_duration is None and len(info["streams"]) == 1):
                source_duration = _media_duration(info.get("format", {}))
            actual = _media_duration(verified.get("format", {}))
            if source_duration is not None and (actual is None or abs(actual - source_duration) > max(0.25, source_duration * .01)):
                raise ProcessingError("Incomplete conversion")
        if track and target in ("wav", "flac"):
            converted = next((s for s in verified["streams"] if s["codec_type"] == "audio"), {})
            if any(str(converted.get(k)) != str(track.get(k)) for k in ("sample_rate", "channels")):
                raise ProcessingError("Audio verification failed")
            if quality_mode == 'lossless':
                encoding, container = ('pcm_f64le', 'f64le') if track.get('sample_fmt', '').startswith(('flt', 'dbl')) else ('pcm_s64le', 's64le') if bits > 32 else ('pcm_s32le', 's32le')
                if decoded_digest(source, ctx, stream=f"0:{track['index']}", encoding=encoding, container=container) != decoded_digest(destination, ctx, stream='0:a:0', encoding=encoding, container=container):
                    raise ProcessingError('Lossless audio checksum verification failed')
        if image:
            original_image = frames[0]
            converted_image = next((s for s in verified['streams'] if s['codec_type'] == 'video'), {})
            if any(converted_image.get(key) != original_image.get(key) for key in ('width', 'height')):
                raise ProcessingError('Image dimensions changed during conversion')
            if quality_mode == 'lossless':
                # Compare at the source precision. FFmpeg's 8→16-bit expansion
                # can differ across packed pixel layouts without any 8-bit loss.
                encoding = 'rgba64le' if high_precision else 'rgba'
                if decoded_digest(source, ctx, stream='0:v:0', encoding=encoding, container='rawvideo') != decoded_digest(destination, ctx, stream='0:v:0', encoding=encoding, container='rawvideo'):
                    raise ProcessingError('Lossless image checksum verification failed')
        if not track and not image:
            before_streams = [(s['codec_type'], s.get('codec_name')) for s in info['streams'] if s['codec_type'] in ('video', 'audio', 'subtitle')]
            after_streams = [(s['codec_type'], s.get('codec_name')) for s in verified['streams'] if s['codec_type'] in ('video', 'audio', 'subtitle')]
            if transcode:
                before_streams = ([("video", "h264")] * len(video) + [("audio", "aac")] * len(audio)
                                  + [("subtitle", "mov_text")] * subtitle_count)
                if "mp4" not in verified.get("format", {}).get("format_name", "").split(","):
                    raise ProcessingError("Conversion output is not an MP4 container")
            if sorted(before_streams, key=lambda row: (row[0], row[1] or '')) != sorted(after_streams, key=lambda row: (row[0], row[1] or '')):
                raise ProcessingError('Video conversion output codec or stream count did not match' if transcode
                                      else 'Container conversion did not preserve all streams')
        checksum_verified = quality_mode == "lossless" and (image or target in ("wav", "flac"))
        if not checksum_verified and any(stream["codec_type"] in ("audio", "video") for stream in verified["streams"]):
            verify_media_decode(destination, ctx)
        outputs.append({"name": destination.name, **file_digest(destination, ctx)})
    if len(tracks) > 1:
        inputs = [{"name": row["name"], "path": str(ctx.root / row["name"])} for row in outputs]
        # Package each audio track separately, preserving all tracks.
        outputs = compress(inputs, output, "zip", Context(ctx.root, ctx.limits, ctx.report))
    return outputs
