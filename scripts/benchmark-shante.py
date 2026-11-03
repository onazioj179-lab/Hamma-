"""Synthetic end-to-end engine baseline; includes normal verification and adapter overhead."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import statistics
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from processor.engine import Context, compress
from processor.native import capability

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', default='validation/shante-benchmark.json')
args = parser.parse_args()
info = capability()
if not info:
    raise SystemExit('Build SHANTE CORE first')
size = 4 * 1024**2
generator = random.Random(123)
random_data = generator.randbytes(size)
payloads = {'repeated': (b'SHANTE baseline text 0123456789\n' * (size // 32 + 1))[:size],
            'random': random_data, 'mixed': b'ABCD' * (size // 8) + random_data[:size // 2]}
limits = {'input': 64 * 1024**2, 'expanded': 64 * 1024**2, 'files': 5000,
          'ratio': 100000, 'depth': 8, 'seconds': 60}
rows = []
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    source = root / 'input'
    for workload, payload in payloads.items():
        source.write_bytes(payload)
        for codec in ('zip', 'gzip', 'zstd'):
            durations = []
            for iteration in range(3):
                output = root / f'{workload}-{codec}-{iteration}'
                start = time.perf_counter()
                manifest = compress([{'name': 'input.bin', 'path': str(source)}], output, codec, Context(root, limits))
                durations.append(time.perf_counter() - start)
                assert manifest[0]['sha256'] == hashlib.sha256(payload).hexdigest()
            rows.append({'workload': workload, 'codec': codec, 'inputBytes': len(payload),
                         'outputBytes': output.stat().st_size, 'seconds': durations,
                         'medianSeconds': statistics.median(durations), 'verified': True})
report = {'scope': 'Synthetic 4 MiB end-to-end operations including output verification; not a throughput guarantee',
          'native': info, 'cases': rows}
Path(args.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(rows, indent=2))
