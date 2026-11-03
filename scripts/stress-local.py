"""Bounded local stress run; only generated, isolated guest data is deleted."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
from io import BytesIO
import bz2, gzip, hashlib, json, lzma, time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5014')
parser.add_argument('--jobs', type=int, default=100)
parser.add_argument('--workers', type=int, default=8)
parser.add_argument('--report', default='.hamma-data/stress-local.json')
args = parser.parse_args()
if not 1 <= args.jobs <= 100 or not 1 <= args.workers <= 8:
    parser.error('Use 1-100 jobs and 1-8 clients')
base = args.base.rstrip('/')
parsed = urlsplit(base)
if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
    parser.error('Stress runner is restricted to an explicitly local processor')

def opener():
    return build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

def verify(index):
    client = opener()
    created = False
    def call(path, value=None, method='GET', raw=False, headers=None, peer=None):
        body = value if raw else json.dumps(value).encode() if value is not None else None
        req = Request(base + path, data=body, method=method, headers={'X-Hamma-Request': '1', **({'Content-Type':'application/json'} if value is not None and not raw else {}), **(headers or {})})
        with (peer or client).open(req, timeout=30) as response:
            data = response.read()
            return data if raw else json.loads(data)
    started = time.monotonic()
    try:
        payload = (f'Generated stress case {index} integrity checks.\n'.encode() * (index * 13 + 1)) if index % 10 else b''
        name = f'nested/stress-{index}-\u4e16\u754c.txt'
        target = ['zip', 'gzip', 'bzip2', 'xz'][index % 4]
        source = call('/api/process/uploads', {'name': name, 'size':len(payload)}, 'POST'); created = True
        split = len(payload) // 2
        for begin, end in [(0, split), (split, len(payload))]:
            if begin == end: continue
            call('/api/process/uploads/' + source['id'], payload[begin:end], 'PUT', True, {'Upload-Offset':str(begin)})
            assert call('/api/process/uploads/' + source['id'])['offset'] == end
        key = hashlib.sha256(f"{source['id']}:{index}".encode()).hexdigest()
        spec = {'uploads':[source['id']], 'operation':'compress', 'target':target, 'requestId':key}
        job = call('/api/process/jobs', spec, 'POST')
        assert call('/api/process/jobs', spec, 'POST')['id'] == job['id']
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            job = call('/api/process/jobs/' + job['id'])
            if job['state'] in ('completed','failed','interrupted','cancelled'): break
            time.sleep(1)
        assert job['state'] == 'completed', job.get('error')
        output = call(job['download'], raw=True)
        assert hashlib.sha256(output).hexdigest() == job['sha256']
        if target == 'zip':
            with ZipFile(BytesIO(output)) as archive: restored = archive.read(name)
        else: restored = {'gzip':gzip.decompress, 'bzip2':bz2.decompress, 'xz':lzma.decompress}[target](output)
        assert restored == payload
        assert call(job['download'], raw=True, headers={'Range':'bytes=0-15'}) == output[:16]
        assert call('/api/process/jobs')['total'] == 1
        try: call('/api/process/jobs/' + job['id'], peer=opener())
        except HTTPError as error: assert error.code == 404
        else: raise AssertionError('Cross-session access was allowed')
        return {'case':index, 'format':target, 'passed':True, 'seconds':round(time.monotonic()-started,3), 'inputBytes':len(payload)}
    except Exception as error:
        return {'case':index, 'passed':False, 'error':str(error)}
    finally:
        if created:
            call('/api/process/files', method='DELETE')
            call('/api/process/history', method='DELETE')

started = time.monotonic()
with ThreadPoolExecutor(max_workers=args.workers) as executor:
    results = list(executor.map(verify, range(args.jobs)))
report = {'jobs':args.jobs, 'workers':args.workers, 'passed':sum(row['passed'] for row in results), 'seconds':round(time.monotonic()-started,3), 'cases':results}
Path(args.report).parent.mkdir(parents=True, exist_ok=True)
Path(args.report).write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({key:value for key,value in report.items() if key!='cases'}))
for row in results:
    if not row['passed']: print(row)
raise SystemExit(0 if report['passed'] == args.jobs else 1)
