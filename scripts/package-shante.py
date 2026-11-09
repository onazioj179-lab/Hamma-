"""Stage and smoke-test the native CLI, optionally with the local workspace."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile


def smoke_workspace(stage, environment):
    interpreter = sys._base_executable if os.name == 'nt' else sys.executable
    with tempfile.TemporaryDirectory(prefix='shante-smoke-') as data:
        log_path = Path(data) / 'startup.log'
        with log_path.open('wb') as log, subprocess.Popen(
            [interpreter, '-B', 'run-workspace.py', '--port', '0', '--data', str(Path(data) / 'jobs')],
            cwd=stage, env=environment, stdout=log, stderr=log,
        ) as process:
            def get(path):
                client = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
                try:
                    client.request('GET', path)
                    response = client.getresponse()
                    if response.status != 200:
                        raise RuntimeError(f'{path} returned HTTP {response.status}')
                    return response.read()
                finally:
                    client.close()

            try:
                deadline = time.monotonic() + 15
                while True:
                    address = re.search(r'HAMMA available at http://127\.0\.0\.1:(\d+)', log_path.read_text(errors='replace'))
                    if address:
                        port = int(address[1])
                        break
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('Packaged workspace did not start')
                    time.sleep(.1)
                health = json.loads(get('/api/process/health'))
                if health['pid'] != process.pid or get('/') != (stage / 'web/index.html').read_bytes():
                    raise RuntimeError('Unexpected workspace response')
                capabilities = json.loads(get('/api/process/capabilities'))
                if 'zstd' not in capabilities['archives'] or not all(
                    capabilities.get(name) for name in ('zipVerification', 'zipSelection', 'archiveRepack')
                ):
                    raise RuntimeError('Packaged workspace capabilities missing')
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                print(log_path.read_text(errors='replace'), end='')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workspace', action='store_true', help='Include the built web UI and local Python processor')
parser.add_argument('--output-dir', type=Path, help='Override the default dist directory')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
web = root / 'web/dist'
if args.workspace and not (web / 'index.html').is_file():
    parser.error('Build the web workspace first with npm run build')
dist = args.output_dir.resolve() if args.output_dir else root / 'dist'
dist.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='shante-release-', dir=dist) as temporary:
    stage = Path(temporary)
    environment = os.environ.copy()
    environment.setdefault('SOURCE_DATE_EPOCH', '0')
    subprocess.run(['cmake', '--install', str(root / 'native/build'), '--prefix', str(stage),
                    '--component', 'ShanteCore', '--config', 'Release', '--strip'], env=environment, check=True)
    executable = stage / 'bin' / ('shante-core.exe' if os.name == 'nt' else 'shante-core')
    if os.name == 'nt':
        environment['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32')
    info = json.loads(subprocess.check_output([str(executable), 'probe'], env=environment, timeout=10))
    if info['protocol'] != 1 or info['gpuAcceleration']:
        raise SystemExit('Unexpected native artifact capabilities')
    subprocess.run([sys.executable, str(root / 'native/tests/test_cli.py'), str(executable)],
                   env=environment, check=True, timeout=120)
    (stage / 'README.md').write_bytes((root / 'native/README.md').read_bytes())
    if args.workspace:
        runtime = stage / 'processor'
        runtime.mkdir()
        for path in sorted((root / 'processor').glob('*.py')):
            shutil.copyfile(path, runtime / path.name)
        shutil.copyfile(root / 'processor/requirements-oauth.txt', runtime / 'requirements-oauth.txt')
        shutil.copytree(web, stage / 'web')
        (stage / 'run-workspace.py').write_text(
            'import os\nfrom pathlib import Path\nimport sys\n\n'
            'root = Path(__file__).resolve().parent\n'
            'os.chdir(root)\n'
            'name = "shante-core.exe" if os.name == "nt" else "shante-core"\n'
            'os.environ["SHANTE_CORE_BINARY"] = str(root / "bin" / name)\n'
            'from processor.server import main\n\n'
            'if __name__ == "__main__":\n'
            '    sys.argv[1:1] = ["--web", str(root / "web")]\n'
            '    main()\n',
            encoding='utf-8',
        )
        (stage / 'WORKSPACE.txt').write_text(
            'SHANTE local workspace\n\n'
            'Requires Python 3.11 or newer. Run python run-workspace.py and open\n'
            'http://127.0.0.1:5010 in a browser. Jobs are stored in .hamma-data\n'
            'by default. Use --data to choose another private directory.\n'
            'FFmpeg and FFprobe on PATH enable media conversion. Provider login\n'
            'requires optional dependencies and separate OAuth configuration.\n'
            'The archive contains unsigned, platform-specific native code.\n',
            encoding='utf-8',
        )
        smoke_workspace(stage, environment)
    files = sorted(path for path in stage.rglob('*') if path.is_file())
    checksums = {path.relative_to(stage).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    (stage / 'SHA256SUMS.json').write_text(json.dumps(checksums, indent=2), encoding='utf-8')
    binary_hash = checksums[executable.relative_to(stage).as_posix()]
    content_hash = hashlib.sha256(json.dumps(checksums, sort_keys=True).encode()).hexdigest()
    product = 'Workspace' if args.workspace else 'Core'
    name = f'SHANTE-{product}-0.1.0-{platform.system()}-{platform.machine()}-{content_hash[:8]}.zip'
    archive = dist / name
    if archive.exists():
        raise SystemExit('Artifact already exists; preserve the prior verified archive')
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                entry = zipfile.ZipInfo(path.relative_to(stage).as_posix())
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = (0o755 if path == executable else 0o644) << 16
                bundle.writestr(entry, path.read_bytes())
    result = {'artifact': name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
              'bytes': archive.stat().st_size, 'binarySha256': binary_hash, 'probe': info,
              'scope': 'Local browser workspace and native CLI' if args.workspace else 'Native CLI only'}
    report = dist / f'{archive.stem}.json' if args.workspace else root / 'validation/shante-release.json'
    report.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
