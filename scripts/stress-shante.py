"""Eight synthetic owner-isolated native compress/restore flows on a disposable local service."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from http.cookiejar import CookieJar
from io import BytesIO
import json
from pathlib import Path
import random
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile

base = sys.argv[1].rstrip('/')
if urlsplit(base).hostname not in ('127.0.0.1', 'localhost'):
    raise SystemExit('Use a disposable localhost service')


def verify(index):
    client = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
    def call(path, value=None, method='GET', raw=False, headers=None):
        body = value if raw else json.dumps(value).encode() if value is not None else None
        request = Request(base + path, data=body, method=method, headers={
            'X-Hamma-Request': '1', **({'Content-Type': 'application/json'} if value is not None and not raw else {}), **(headers or {})})
        with client.open(request, timeout=30) as response:
            result = response.read()
            return result if raw else json.loads(result)
    def upload(payload, name):
        source = call('/api/process/uploads', {'name': name, 'size': len(payload)}, 'POST')
        call('/api/process/uploads/' + source['id'], payload, 'PUT', True, {'Upload-Offset': '0'})
        return source['id']
    def execute(upload_id, operation, target):
        job = call('/api/process/jobs', {'uploads': [upload_id], 'operation': operation, 'target': target}, 'POST')
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            job = call('/api/process/jobs/' + job['id'])
            if job['state'] in ('completed', 'failed', 'cancelled', 'interrupted'):
                break
            time.sleep(.25)
        assert job['state'] == 'completed', job
        result = call(job['download'], raw=True)
        assert hashlib.sha256(result).hexdigest() == job['sha256']
        return job, result
    payload = random.Random(index).randbytes(65536) if index else b''
    name = f'owner-{index}-世界.bin'
    packed_job, packed = execute(upload(payload, name), 'compress', 'zstd')
    assert packed_job['outputName'] == name + '.zstd'
    assert packed[:4] == b'\x28\xb5\x2f\xfd'
    restored_job, restored = execute(upload(packed, packed_job['outputName']), 'extract', 'zip')
    with ZipFile(BytesIO(restored)) as archive:
        assert archive.read(name) == payload
    assert call('/api/process/jobs')['total'] == 2
    return call, packed_job, restored_job


started = time.monotonic()
with ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(verify, range(8)))
for index, (call, _, _) in enumerate(results):
    foreign = results[(index + 1) % 8][1]
    try:
        call('/api/process/jobs/' + foreign['id'])
    except HTTPError as error:
        assert error.code == 404
    else:
        raise AssertionError('Owner isolation failed')
report = {'sessions': 8, 'nativeCompressions': 8, 'nativeRestorations': 8,
          'verifiedDownloads': 16, 'passed': True, 'seconds': round(time.monotonic() - started, 3)}
Path('validation/shante-stress.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
