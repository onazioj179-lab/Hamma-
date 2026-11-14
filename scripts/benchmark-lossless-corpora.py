"""Compare ZIP, TAR.ZST and solid TAR.XZ on identical seeded corpora."""
import argparse
import gzip
import hashlib
import json
import lzma
from pathlib import Path
import platform
import random
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import tracemalloc
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from processor.engine import BLOCK, Context, compress
from processor.native import capability

CORPORA = ('shared-blocks', 'unique-random', 'already-compressed')


def digest(stream):
    return hashlib.file_digest(stream, 'sha256').hexdigest()


def inputs_for(root, corpus, mib):
    generator = random.Random(2027)
    files = []
    expected = {}
    shared = generator.randbytes(32 * 1024)
    for index in range(mib * 8):
        name = f'file-{index:05}.bin'
        if corpus == 'shared-blocks':
            payload = shared * 3 + generator.randbytes(32 * 1024)
        elif corpus == 'unique-random':
            payload = generator.randbytes(128 * 1024)
        else:
            payload = gzip.compress(generator.randbytes(128 * 1024), mtime=0)
        path = root / name
        path.write_bytes(payload)
        files.append({'name': name, 'path': str(path)})
        expected[name] = (len(payload), hashlib.sha256(payload).hexdigest())
    return files, expected


def verify_zip(output, expected):
    with zipfile.ZipFile(output) as archive:
        if archive.namelist() != list(expected):
            raise ValueError('ZIP entries changed')
        for entry in archive.infolist():
            with archive.open(entry) as source:
                if (entry.file_size, digest(source)) != expected[entry.filename]:
                    raise ValueError(f'ZIP entry changed: {entry.filename}')


def run(tool, args, cwd):
    return subprocess.run([tool, *args], cwd=cwd, capture_output=True, check=True, timeout=600).stdout


def verify_restored(path, expected):
    if sorted(p.name for p in path.iterdir()) != sorted(expected):
        raise ValueError('Restored entries changed')
    for name, (size, sha256) in expected.items():
        member = path / name
        with member.open('rb') as stream:
            if member.stat().st_size != size or digest(stream) != sha256:
                raise ValueError(f'Restored entry changed: {name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mib', type=int, default=16, help='Nominal MiB per corpus')
    parser.add_argument('--bsdtar', default=shutil.which('bsdtar') or shutil.which('tar'))
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.mib <= 128:
        parser.error('Choose 1–128 MiB per corpus')
    if not args.bsdtar or not capability():
        parser.error('Native SHANTE and bsdtar with Zstandard and XZ support are required')
    root = Path(__file__).resolve().parents[1]
    tool_versions = {
        'revision': run('git', ['rev-parse', 'HEAD'], root).decode().strip(),
        'native': capability(),
        'bsdtar': run(args.bsdtar, ['--version'], root).decode().strip(),
    }
    results = []
    with tempfile.TemporaryDirectory(prefix='hamma-lossless-corpora-') as temp:
        for corpus in CORPORA:
            fixture = Path(temp) / corpus
            fixture.mkdir()
            sources, expected = inputs_for(fixture, corpus, args.mib)
            names = list(expected)
            size = sum(item[0] for item in expected.values())
            limits = dict(input=size + 16 * BLOCK, expanded=size + 16 * BLOCK, files=len(names),
                          seconds=600, ratio=1000, depth=8)
            for codec in ('zip', 'tar.zst', 'tar.xz'):
                output = Path(temp) / ('archive.' + codec)
                tracemalloc.start()
                start = time.perf_counter()
                try:
                    if codec == 'tar.xz':
                        with lzma.open(output, 'wb', preset=6) as stream, tarfile.open(fileobj=stream, mode='w|') as archive:
                            for name in names:
                                archive.add(fixture / name, arcname=name)
                    else:
                        manifest = compress(sources, output, codec, Context(Path(temp), limits))
                        if [(row['name'], row['size'], row['sha256']) for row in manifest] != [
                            (name, *expected[name]) for name in names
                        ]:
                            raise ValueError('Archive manifest changed')
                    created = time.perf_counter()
                    if codec == 'zip':
                        verify_zip(output, expected)
                    else:
                        with tempfile.TemporaryDirectory(dir=temp) as restored:
                            run(args.bsdtar, ['-xf', str(output), '-C', restored], fixture)
                            verify_restored(Path(restored), expected)
                    finished = time.perf_counter()
                    _, peak = tracemalloc.get_traced_memory()
                finally:
                    tracemalloc.stop()
                result = dict(corpus=corpus, codec=codec, files=len(names), inputBytes=size,
                              outputBytes=output.stat().st_size,
                              secondsThroughWriteAndBuiltInChecks=round(created - start, 4),
                              secondsThroughIndependentVerification=round(finished - start, 4),
                              peakPythonAllocationBytes=peak, verified=True)
                results.append(result)
                output.unlink()
                print(json.dumps(result), flush=True)
            shutil.rmtree(fixture)
    report = {
        'platform': platform.platform(), 'python': platform.python_version(), 'tools': tool_versions,
        'scope': 'One local run per case. Traced allocations exclude subprocess memory and are not peak RSS.',
        'settings': {'zip': 'Deflate level 6', 'tar.zst': 'SHANTE native default',
                     'tar.xz': 'One LZMA2 stream over TAR, preset 6'},
        'results': results,
    }
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
