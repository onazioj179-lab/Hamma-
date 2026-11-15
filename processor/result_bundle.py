"""Write verified processor results to an unseekable ZIP stream."""

import hashlib
from pathlib import PurePosixPath
import zipfile

from .engine import BLOCK, safe_path

MAX_RESULTS = 50
BUNDLE_NAME = "hamma-results.zip"


class ChunkedOutput:
    def __init__(self, stream):
        self.stream = stream

    def write(self, data):
        if data:
            self.stream.write(f"{len(data):x}\r\n".encode("ascii"))
            self.stream.write(data)
            self.stream.write(b"\r\n")
        return len(data)

    def flush(self):
        self.stream.flush()

    def finish(self):
        self.stream.write(b"0\r\n\r\n")
        self.flush()


def member_names(names):
    names = [PurePosixPath(safe_path(name)).name for name in names]
    reserved = {name.casefold() for name in names}
    used = set()
    for name in names:
        candidate = name
        if candidate.casefold() in used:
            path = PurePosixPath(name)
            suffix = path.suffix
            number = 2
            while candidate.casefold() in reserved or candidate.casefold() in used:
                candidate = f"{path.stem} ({number}){suffix}"
                number += 1
        used.add(candidate.casefold())
        yield candidate


def write_bundle(output, results):
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as bundle:
        for path, result, name in results:
            member = zipfile.ZipInfo(name)
            member.file_size = result["size"]
            digest = hashlib.sha256()
            with path.open("rb") as source, bundle.open(member, "w") as entry:
                remaining = member.file_size
                while remaining:
                    data = source.read(min(BLOCK, remaining))
                    if not data:
                        raise OSError("Retained result was truncated")
                    digest.update(data)
                    entry.write(data)
                    remaining -= len(data)
                if source.read(1) or digest.hexdigest() != result["sha256"]:
                    raise OSError("Retained result failed its checksum")
