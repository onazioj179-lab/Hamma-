"""Bounded streaming operations. No extractall, shell commands, or whole-file reads."""
from __future__ import annotations

import bz2
import gzip
import hashlib
import io
import json
import lzma
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import tarfile
import time
import unicodedata
import zipfile

BLOCK = 1024 * 1024
ARCHIVES = ("zip", "tar", "tar.gz", "tar.bz2", "tar.xz", "gzip", "bzip2", "xz")
MEDIA = ("wav", "flac", "mp3", "aac", "m4a", "ogg", "mp4", "mkv", "webm", "png", "webp", "jpg")


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
            re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", p)
            for p in parts)):
        raise ProcessingError("Unsafe filename")
    return value + ("/" if directory else "")


def detect(path: Path) -> str:
    with path.open("rb") as stream:
        head = stream.read(512)
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
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[4:8] == b"ftyp":
        return "mp4"
    if head[:4] == b"\x1aE\xdf\xa3":
        return "mkv"
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
        # A file cannot also be the parent of another entry.
        for parent in Path(key).parents:
            if str(parent).replace("\\", "/") in self.paths and str(parent) != ".":
                if str(parent).replace("\\", "/") in getattr(self, "file_paths", set()):
                    raise ProcessingError("Conflicting archive paths")
        if not directory and any(p.startswith(key + "/") for p in self.paths):
            raise ProcessingError("Conflicting archive paths")
        if not hasattr(self, "file_paths"):
            self.file_paths = set()
        if not directory:
            self.file_paths.add(key)
        self.paths.add(key)
        self.count += 1
        if self.count > self.limits["files"]:
            raise ProcessingError("Too many files")
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


def validate_tar(path: Path, ctx: Context, opener=None):
    """Bound extended headers before tarfile allocates their declared sizes."""
    total, headers = 0, 0
    with (opener(path, "rb") if opener else path.open("rb")) as stream:
        while True:
            ctx.check()
            header = stream.read(512)
            if not header or header == bytes(512):
                break
            if len(header) != 512:
                raise ProcessingError("Truncated archive")
            headers += 1
            if headers > ctx.limits["files"] * 3:
                raise ProcessingError("Too many archive entries")
            # tarfile's parser handles checksum and base-256 number validation.
            info = tarfile.TarInfo.frombuf(header, "utf-8", "surrogateescape")
            if info.size < 0 or info.size > ctx.limits["expanded"]:
                raise ProcessingError("Expanded size limit reached")
            metadata = info.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK)
            if info.type == tarfile.GNUTYPE_SPARSE or metadata and info.size > BLOCK:
                raise ProcessingError("Unsupported archive metadata")
            remaining = (info.size + 511) // 512 * 512
            total += remaining + 512
            if total > ctx.limits["expanded"] + ctx.limits["files"] * 1024:
                raise ProcessingError("Expanded size limit reached")
            while remaining:
                ctx.check()
                chunk = stream.read(min(BLOCK, remaining))
                if not chunk:
                    raise ProcessingError("Truncated archive")
                if metadata and b"GNU.sparse" in chunk:
                    raise ProcessingError("Unsupported sparse archive")
                remaining -= len(chunk)


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
        if count == 65535 or central_size == 0xffffffff or central_offset == 0xffffffff:
            position = size - len(end)
            if position < 20:
                raise ProcessingError("Invalid ZIP64 archive")
            stream.seek(position - 20)
            locator = stream.read(20)
            if locator[:4] != b"PK\x06\x07":
                raise ProcessingError("Invalid ZIP64 archive")
            record_offset = struct.unpack_from("<Q", locator, 8)[0]
            stream.seek(record_offset)
            record = stream.read(56)
            if len(record) != 56 or record[:4] != b"PK\x06\x06":
                raise ProcessingError("Invalid ZIP64 archive")
            if any(struct.unpack_from("<II", record, 16)):
                raise ProcessingError("Split archives are unsupported")
            count, central_size, central_offset = struct.unpack_from("<QQQ", record, 32)
        if count > ctx.limits["files"] or central_size > ctx.limits["files"] * 4096 + BLOCK:
            raise ProcessingError("Too many archive entries")
        if central_offset + central_size > size:
            raise ProcessingError("Invalid archive index")


def file_digest(path: Path, context: Context):
    with path.open("rb") as stream:
        return context.copy(stream, Sink(), progress=False)


def compress(inputs: list[dict], output: Path, target: str, ctx: Context):
    manifest = []
    names = [(item, ctx.register(item["name"], item.get("directory", False))) for item in inputs]
    if target == "zip":
        with BoundedWriter(output, ctx) as bounded, zipfile.ZipFile(bounded, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for item, name in names:
                ctx.check()
                if item.get("directory"):
                    archive.writestr(name, b"")
                    manifest.append({"name": name, "directory": True, "size": 0})
                else:
                    with Path(item["path"]).open("rb") as source, archive.open(name, "w", force_zip64=True) as dest:
                        manifest.append({"name": name, **ctx.copy(source, dest)})
        ctx.report(state="verifying")
        with zipfile.ZipFile(output) as archive:
            if archive.namelist() != [row["name"] for row in manifest]:
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
        ctx.report(state="verifying")
        with tarfile.open(output, "r|*") as archive:
            seen = []
            for info in archive:
                ctx.check()
                seen.append(info.name.rstrip("/") + ("/" if info.isdir() else ""))
                row = manifest[len(seen) - 1]
                if info.isfile():
                    actual = ctx.copy(archive.extractfile(info), Sink(), progress=False, expected=row["size"])
                    if actual["sha256"] != row["sha256"]:
                        raise ProcessingError("Integrity check failed")
            if seen != [row["name"] for row in manifest]:
                raise ProcessingError("Archive verification failed")
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
        manifest.append({"name": names[0][1], **row})
    return manifest


def extract(source: Path, original_name: str, output: Path, ctx: Context, recursive=False):
    manifest = []
    # Temporary files allow recursive inspection without buffering members in RAM.
    temp = ctx.root / "expanded"
    temp.mkdir(exist_ok=True)
    work = [(source, "", original_name, 0)]
    with BoundedWriter(output, ctx) as bounded, zipfile.ZipFile(bounded, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as result:
        while work:
            path, prefix, name, depth = work.pop(0)
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
                staging = temp / str(len(manifest))
                with staging.open("wb") as dest:
                    record = ctx.copy(stream, dest, expanding=True, progress=False, expected=size)
                # Retain the original member too: recursive inspection never silently removes it.
                with staging.open("rb") as src, result.open(normalized, "w", force_zip64=True) as dest:
                    ctx.copy(src, dest, progress=False)
                manifest.append({"name": normalized, **record})
                ctx.report(entries=ctx.count, expanded=ctx.expanded)
                nested = detect(staging)
                if recursive and nested in ("zip", "tar", "gzip", "bzip2", "xz"):
                    work.append((staging, normalized + ".contents/", entry_name, depth + 1))
                else:
                    staging.unlink()

            if kind == "zip":
                validate_zip(path, ctx)
                with zipfile.ZipFile(path) as archive:
                    for item in archive.infolist():
                        ctx.check()
                        if item.flag_bits & 1:
                            raise ProcessingError("Password-protected archive")
                        mode = item.external_attr >> 16
                        if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                            raise ProcessingError("Unsafe archive link or device")
                        if item.file_size > max(1, item.compress_size) * ctx.limits["ratio"]:
                            raise ProcessingError("Archive expansion ratio limit reached")
                        with archive.open(item) as stream:
                            add_entry(item.filename, stream, item.file_size, item.is_dir())
            elif kind in ("tar", "gzip", "bzip2", "xz"):
                # Inspect the bounded decompressed prefix before deciding TAR versus a single stream.
                opener = {"gzip": gzip.open, "bzip2": bz2.open, "xz": lzma.open}.get(kind)
                is_tar = kind == "tar"
                if opener:
                    with opener(path, "rb") as stream:
                        head = stream.read(512)
                        is_tar = len(head) == 512 and (head[257:262] == b"ustar" or head == bytes(512))
                if is_tar:
                    validate_tar(path, ctx, opener)
                    with tarfile.open(path, "r|*") as archive:
                        for item in archive:
                            ctx.check()
                            if not (item.isfile() or item.isdir()):
                                raise ProcessingError("Unsafe archive link or device")
                            if item.isdir():
                                add_entry(item.name, None, 0, True)
                            else:
                                with archive.extractfile(item) as stream:
                                    add_entry(item.name, stream, item.size)
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
                    if recursive and detect(staging) in ("zip", "tar", "gzip", "bzip2", "xz"):
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
    args += ["-show_entries", "stream=index,codec_type,codec_name,sample_fmt,sample_rate,channels,bits_per_sample,bits_per_raw_sample,duration,nb_frames,nb_read_frames:format=format_name,duration", "-of", "json", str(path)]
    proc = subprocess.run(args, capture_output=True, timeout=30)
    if proc.returncode or len(proc.stdout) > BLOCK:
        raise ProcessingError("Unsupported media")
    return json.loads(proc.stdout)


def convert(source: Path, output: Path, target: str, ctx: Context):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise ProcessingError("Media engine unavailable")
    info = probe(source)
    audio = [s for s in info["streams"] if s["codec_type"] == "audio"]
    image = target in ("png", "webp", "jpg")
    outputs = []
    if image:
        formats = set(info.get("format", {}).get("format_name", "").split(","))
        if not formats.intersection({"image2", "png_pipe", "jpeg_pipe", "webp_pipe", "bmp_pipe", "tiff_pipe", "gif"}):
            raise ProcessingError("Choose a still image")
        frames = [s for s in probe(source, count_frames=True)["streams"] if s["codec_type"] == "video"]
        if len(frames) != 1 or frames[0].get("nb_read_frames") != "1":
            raise ProcessingError("Choose a still image")
    tracks = audio if target in ("wav", "flac", "mp3", "aac", "m4a", "ogg") else [None]
    if not tracks:
        raise ProcessingError("No audio track")
    for index, track in enumerate(tracks):
        remaining = ctx.limits["expanded"] - sum(row["size"] for row in outputs)
        if remaining <= 0:
            raise ProcessingError("Conversion output limit reached")
        destination = output if len(tracks) == 1 else ctx.root / f"audio-{index + 1}.{target}"
        args = [shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-y", "-max_alloc", str(64 * BLOCK),
                "-protocol_whitelist", "file,pipe", "-format_whitelist", INPUT_FORMATS, "-threads", "2", "-i", str(source), "-threads", "2", "-map_metadata", "-1"]
        if track:
            args += ["-map", f"0:{track['index']}", "-vn"]
            bits = int(track.get("bits_per_raw_sample") or track.get("bits_per_sample") or 0)
            sample = track.get("sample_fmt", "")
            pcm = "pcm_f64le" if sample.startswith("dbl") else "pcm_f32le" if sample.startswith("flt") else "pcm_s32le" if bits > 24 else "pcm_s24le" if bits > 16 else "pcm_s16le"
            codecs = {"wav": pcm, "flac": "flac", "mp3": "libmp3lame", "aac": "aac", "m4a": "aac", "ogg": "libvorbis"}
            args += ["-c:a", codecs[target]]
            if target == "wav":
                args += ["-rf64", "auto"]
        elif image:
            args += ["-map", "0:v:0", "-frames:v", "1"]
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
        # Reject truncated outputs rather than treating FFmpeg's size-limited exit as success.
        duration = float(track.get("duration", info.get("format", {}).get("duration", 0)) or 0) if track else float(info.get("format", {}).get("duration", 0) or 0)
        actual = float(verified.get("format", {}).get("duration", 0) or 0)
        if not image and duration > 0 and (actual <= 0 or abs(actual - duration) > max(0.25, duration * .01)):
            raise ProcessingError("Incomplete conversion")
        if track and target in ("wav", "flac"):
            converted = next((s for s in verified["streams"] if s["codec_type"] == "audio"), {})
            if any(str(converted.get(k)) != str(track.get(k)) for k in ("sample_rate", "channels")):
                raise ProcessingError("Audio verification failed")
        outputs.append({"name": destination.name, **file_digest(destination, ctx)})
    if len(tracks) > 1:
        inputs = [{"name": row["name"], "path": str(ctx.root / row["name"])} for row in outputs]
        # Package each audio track separately, preserving all tracks.
        outputs = compress(inputs, output, "zip", Context(ctx.root, ctx.limits, ctx.report))
    return outputs
