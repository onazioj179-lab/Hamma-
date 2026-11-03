"""300 sequential codec jobs, with per-file outcomes; desktop, not mobile certification."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import tracemalloc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from processor.engine import Context, convert

if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
    raise SystemExit('FFmpeg and FFprobe required')
limits = dict(input=64*1024**2, expanded=64*1024**2, files=5000, seconds=60, ratio=1000, depth=3)
started = time.monotonic()
results = []
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    fixtures = []
    for extension, size in [('png', '32x32'), ('jpg', '1920x1080'), ('webp', '64x64'), ('gif', '48x48'), ('avif', '64x64')]:
        path = root / ('fixture.' + extension)
        generated = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size='+size+':duration=0.1', '-frames:v', '1', '-threads', '1', str(path)], capture_output=True)
        if generated.returncode:
            raise RuntimeError('Fixture generation failed: ' + extension)
        fixtures.append(path)
    tracemalloc.start()
    for index in range(300):
        job = root / str(index)
        job.mkdir()
        # Repeated basenames in independent nested paths must remain independent.
        source = job / ('世界.' + fixtures[index % len(fixtures)].suffix.lstrip('.'))
        if index < 14:
            source.write_bytes(b'corrupt or unsupported fixture')
        else:
            shutil.copyfile(fixtures[index % len(fixtures)], source)
        output = job / 'result.png'
        row = dict(id=index, name=str(source.relative_to(root)), inputBytes=source.stat().st_size)
        tick = time.monotonic()
        try:
            convert(source, output, 'png', Context(job, limits))
            if not output.is_file() or not output.stat().st_size:
                raise RuntimeError('Missing verified output')
            row.update(status='completed', outputBytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest())
        except Exception as error:
            row.update(status='failed', reason=str(error))
        row['seconds'] = round(time.monotonic()-tick, 4)
        results.append(row)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
report = dict(environment='Windows desktop Python/FFmpeg engine; sequential jobs, no browser/network', inputCount=300,
              successfulFiles=sum(row['status']=='completed' for row in results), failedFiles=sum(row['status']=='failed' for row in results),
              durationSeconds=round(time.monotonic()-started, 3), peakPythonTracedBytes=peak,
              limitations='Python allocations only; excludes FFmpeg RSS. No mobile hardware, HEIC, background suspension, upload or concurrency certification.', files=results)
Path(sys.argv[1] if len(sys.argv) > 1 else 'validation/image-batch-v4.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'files'}))
