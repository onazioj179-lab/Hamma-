"""Stage, smoke-test and package the built native CLI with licenses and checksums."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
dist.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='shante-release-', dir=dist) as temporary:
    stage = Path(temporary)
    subprocess.run(['cmake', '--install', str(root / 'native/build'), '--prefix', str(stage),
                    '--component', 'ShanteCore', '--config', 'Release', '--strip'], check=True)
    executable = stage / 'bin' / ('shante-core.exe' if os.name == 'nt' else 'shante-core')
    environment = os.environ.copy()
    if os.name == 'nt':
        environment['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32')
    info = json.loads(subprocess.check_output([str(executable), 'probe'], env=environment, timeout=10))
    if info['protocol'] != 1 or info['gpuAcceleration']:
        raise SystemExit('Unexpected native artifact capabilities')
    subprocess.run([sys.executable, str(root / 'native/tests/test_cli.py'), str(executable)],
                   env=environment, check=True, timeout=120)
    (stage / 'README.md').write_bytes((root / 'native/README.md').read_bytes())
    files = sorted(path for path in stage.rglob('*') if path.is_file())
    checksums = {path.relative_to(stage).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    (stage / 'SHA256SUMS.json').write_text(json.dumps(checksums, indent=2), encoding='utf-8')
    binary_hash = checksums[executable.relative_to(stage).as_posix()]
    name = f'SHANTE-Core-0.1.0-{platform.system()}-{platform.machine()}-{binary_hash[:8]}.zip'
    archive = dist / name
    if archive.exists():
        raise SystemExit('Artifact already exists; preserve the prior verified archive')
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                bundle.write(path, path.relative_to(stage))
    result = {'artifact': name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
              'bytes': archive.stat().st_size, 'binarySha256': binary_hash, 'probe': info,
              'scope': 'Native CLI only; existing Python service/web UI are separate'}
    (root / 'validation/shante-release.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
