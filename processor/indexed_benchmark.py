"""Real directory-to-archive payload benchmark, including independent checksums."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import random
import tarfile
import tempfile
import time
import tracemalloc

from .resources import configured_limits
from .server import Service, run_job


def payload(number, size):
    return random.Random(number).randbytes(size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--files', type=int, required=True)
    parser.add_argument('--bytes-per-file', type=int, default=4096)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.files < 1 or not 1 <= args.bytes_per_file <= 1024**2:
        parser.error('Positive file count and 1..1048576 bytes per file are required')
    with tempfile.TemporaryDirectory(prefix='shante-indexed-payload-') as folder:
        base = Path(folder)
        source = base / 'source'
        source.mkdir()
        for number in range(args.files):
            parent = source / f'folder-{number // 1000}'
            parent.mkdir(exist_ok=True)
            (parent / f'file-{number}.bin').write_bytes(payload(number, args.bytes_per_file))
        limits = configured_limits({})
        limits['files'] = args.files + (args.files + 999) // 1000
        limits['input'] = args.files * args.bytes_per_file
        limits['expanded'] = args.files * (args.bytes_per_file + 4096) + 1024**2
        limits['storage'] = limits['expanded'] * 3 + 128 * 1024**2
        service = Service(base / 'data', limits=limits)
        try:
            owner = 'a' * 64
            tracemalloc.start()
            started = time.perf_counter()
            job = service.enqueue_directory(owner, source, 'tar.gz')
            run_job(service.store.root, owner, job['id'], limits)
            seconds = time.perf_counter() - started
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
            record = service.store.get(owner, 'job', job['id'])
            if record['state'] != 'completed':
                raise RuntimeError(record.get('error', 'Processing failed'))
            archive_path = service.store.folder(owner, job['id']) / record['outputFile']
            count = 0
            with tarfile.open(archive_path, 'r|*') as archive:
                while info := archive.next():
                    if info.isfile():
                        number = int(Path(info.name).stem.removeprefix('file-'))
                        assert info.name == f'folder-{number // 1000}/file-{number}.bin'
                        assert info.size == args.bytes_per_file
                        with archive.extractfile(info) as stream:
                            actual = hashlib.sha256(stream.read(args.bytes_per_file + 1)).hexdigest()
                        assert actual == hashlib.sha256(payload(number, args.bytes_per_file)).hexdigest()
                        count += 1
                    archive.members.clear()
            assert count == args.files and record['fileCount'] == limits['files']
            result = {'scope': 'real local directory discovery, TAR.GZ processing and internal verification; deterministic random file payloads',
                      'platform': platform.platform(), 'python': platform.python_version(), 'files': count,
                      'entriesIncludingDirectories': record['fileCount'], 'bytesPerFile': args.bytes_per_file,
                      'inputBytes': record['inputSize'], 'outputBytes': record['outputSize'], 'indexBytesCharged': record['indexBytes'],
                      'secondsDiscoveryProcessingVerification': seconds, 'peakPythonAllocatedBytes': peak,
                      'independentPayloadChecksumsVerified': True, 'outputSHA256': record['sha256'],
                      'notes': 'Fixture generation, independent post-run verification and cleanup excluded from timed interval. Python allocations exclude SQLite/native memory and OS cache. Worker called in-process for tracing; scheduled subprocess covered separately.'}
            args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
            print(json.dumps(result))
        finally:
            service.close()


if __name__ == '__main__':
    main()
