"""Materialize only hash-pinned dependency source files, without archive symlinks."""
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile

archive = Path(sys.argv[1])
expected = 'eb33e51f49a15e023950cd7825ca74a4a2b43db8354825ac24fc1b7ee09e6fa3'
with archive.open('rb') as stream:
    if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
        raise SystemExit('Dependency checksum mismatch')
cache = Path(__file__).resolve().parents[1] / '.hamma-data' / 'shante-deps'
cache.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive, 'r:gz') as source:
    for member in source:
        parts = PurePosixPath(member.name).parts
        if len(parts) < 2 or parts[0] != 'zstd-1.5.7' or not member.isfile():
            continue
        if parts[1] not in ('lib', 'build', 'LICENSE', 'COPYING'):
            continue
        if any(part in ('', '.', '..') or ':' in part or '\\' in part for part in parts):
            raise SystemExit('Unsafe dependency path')
        destination = cache.joinpath(*parts)
        if not destination.resolve().is_relative_to(cache.resolve()) or destination.is_symlink():
            raise SystemExit('Unsafe dependency destination')
        destination.parent.mkdir(parents=True, exist_ok=True)
        with source.extractfile(member) as stream, destination.open('wb') as output:
            shutil.copyfileobj(stream, output, 1024 * 1024)
print('Verified Zstandard 1.5.7 source materialized (code and CMake only).')
