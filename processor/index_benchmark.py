"""Repeatable indexing benchmark; no conversion throughput is claimed."""
import argparse
import json
from pathlib import Path
import platform
import tempfile
import time
import tracemalloc

from .indexing import DirectoryIndex


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--entries', type=int, required=True)
    parser.add_argument('--mode', choices=('metadata', 'directory'), default='metadata')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.entries <= 2**63 - 1:
        parser.error('Entries must be a positive 64-bit integer')
    with tempfile.TemporaryDirectory(prefix='shante-index-bench-') as folder:
        base = Path(folder)
        root = base / 'empty-source'
        root.mkdir()
        if args.mode == 'directory':
            for number in range(args.entries):
                parent = root / f'{number // 1000:08d}'
                parent.mkdir(exist_ok=True)
                (parent / f'{number:016d}.txt').write_bytes(b'SHANTE real discovery fixture\n')
        quota = args.entries if args.mode == 'metadata' else args.entries + (args.entries + 999) // 1000
        index = DirectoryIndex(base / 'index.sqlite3', root, max_entries=quota)
        tracemalloc.start()
        started = time.perf_counter()
        if args.mode == 'metadata':
            for start in range(0, args.entries, index.batch_size):
                index._commit([(f'folder/{number:016d}.bin', 'file', 5 * 1024**4, number, None)
                               for number in range(start, min(start + index.batch_size, args.entries))])
        else:
            assert index.discover()
        write_seconds = time.perf_counter() - started
        started = time.perf_counter()
        after = count = files = 0
        while rows := index.page(after=after, limit=1000):
            count += len(rows)
            files += sum(row['kind'] == 'file' for row in rows)
            after = rows[-1]['id']
        query_seconds = time.perf_counter() - started
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert count == quota and after == quota and files == args.entries
        scope = ('synthetic-metadata-only; no payload discovery, transfer, compression or multi-terabyte file was performed' if args.mode == 'metadata' else
                 'real directory enumeration and metadata indexing; 29-byte file fixtures; no payload conversion or transfer throughput claim')
        result = {'scope': scope, 'mode': args.mode, 'files': files,
                  'platform': platform.platform(), 'python': platform.python_version(), 'entries': count,
                  'batchSize': index.batch_size, 'pageSize': 1000, 'insertSeconds': write_seconds,
                  'pageAllSeconds': query_seconds, 'peakPythonAllocatedBytes': peak,
                  'databaseAndWalBytes': sum(p.stat().st_size for p in base.glob('index.sqlite3*')),
                  'verified': True}
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
