"""Verified byte splitting into a portable ZIP package."""

import hashlib
import json
from pathlib import PurePosixPath
import zipfile

from .engine import BLOCK, BoundedWriter, ProcessingError, Sink, file_digest, safe_path, validate_zip


PART_SIZES = (1, 8, 32, 128)
MANIFEST = "hamma-parts.json"


def part_name(index):
    return f"parts/{index:06d}.part"


def split_file(source, name, output, ctx, part_mib, expected_sha256):
    name = safe_path(PurePosixPath(name).name)
    size = source.stat().st_size
    part_size = part_mib * BLOCK
    count = (size + part_size - 1) // part_size
    if count < 2:
        raise ProcessingError("Choose a part size smaller than the file")
    if count + 1 > ctx.limits["files"]:
        raise ProcessingError("Too many parts. Choose a larger part size")
    entries = []
    digest = hashlib.sha256()
    with (source.open("rb") as stream, BoundedWriter(output, ctx) as bounded,
          zipfile.ZipFile(bounded, "w") as archive):
        for index in range(1, count + 1):
            name_in_zip = part_name(index)
            part_digest = hashlib.sha256()
            remaining = min(part_size, size - ctx.bytes)
            length = remaining
            with archive.open(name_in_zip, "w", force_zip64=True) as part:
                while remaining:
                    ctx.check()
                    data = stream.read(min(BLOCK, remaining))
                    if not data:
                        raise ProcessingError("Input integrity check failed")
                    part.write(data)
                    part_digest.update(data)
                    digest.update(data)
                    remaining -= len(data)
                    ctx.bytes += len(data)
                    ctx.report(processed=ctx.bytes)
            entries.append({"name": name_in_zip, "size": length, "sha256": part_digest.hexdigest()})
        if stream.read(1) or digest.hexdigest() != expected_sha256:
            raise ProcessingError("Input integrity check failed")
        manifest = json.dumps({
            "version": 1, "name": name, "size": size, "sha256": expected_sha256,
            "parts": entries,
        }, ensure_ascii=True).encode("ascii")
        if len(manifest) > BLOCK:
            raise ProcessingError("Part manifest size limit reached")
        archive.writestr(MANIFEST, manifest)
    ctx.report(state="verifying")
    if output.stat().st_size > ctx.limits["input"]:
        raise ProcessingError("Part package exceeds the upload limit")
    with zipfile.ZipFile(output) as archive:
        for entry in entries:
            with archive.open(entry["name"]) as part:
                if ctx.copy(part, Sink(), progress=False, expected=entry["size"]) != {
                    "size": entry["size"], "sha256": entry["sha256"],
                }:
                    raise ProcessingError("Part integrity check failed")
    return entries


def join_file(source, output, ctx):
    validate_zip(source, ctx)
    with zipfile.ZipFile(source) as archive:
        try:
            info = archive.getinfo(MANIFEST)
            if info.compress_type != zipfile.ZIP_STORED or info.flag_bits & 1 or info.file_size > BLOCK:
                raise ValueError
            manifest = json.loads(archive.read(info))
            name = safe_path(manifest["name"])
            size = manifest["size"]
            parts = manifest["parts"]
            if (type(manifest["version"]) is not int or manifest["version"] != 1 or "/" in name or type(size) is not int or
                    not 0 < size <= ctx.limits["expanded"] or not isinstance(parts, list) or
                    not 2 <= len(parts) < ctx.limits["files"]):
                raise ValueError
            names = [part_name(index) for index in range(1, len(parts) + 1)]
            if archive.namelist() != [*names, MANIFEST]:
                raise ValueError
        except (KeyError, TypeError, ValueError, RuntimeError) as error:
            raise ProcessingError("Invalid archive parts manifest") from error

        with BoundedWriter(output, ctx) as joined:
            for part, expected_name in zip(parts, names):
                ctx.check()
                info = archive.getinfo(expected_name)
                if (not isinstance(part, dict) or part.get("name") != expected_name or
                        type(part.get("size")) is not int or part["size"] != info.file_size or
                        not 0 < info.file_size <= size - ctx.bytes or
                        info.compress_type != zipfile.ZIP_STORED or info.flag_bits & 1):
                    raise ProcessingError("Invalid archive part")
                with archive.open(info) as stream:
                    record = ctx.copy(stream, joined, expected=info.file_size)
                if record["sha256"] != part.get("sha256"):
                    raise ProcessingError("Part integrity check failed")
    ctx.report(state="verifying")
    record = file_digest(output, ctx)
    if record["size"] != size or record["sha256"] != manifest.get("sha256"):
        raise ProcessingError("Joined file integrity check failed")
    return name, [{"name": name, **record}]
