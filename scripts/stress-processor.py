"""Bounded synthetic HTTP stress run. Use a disposable processor data directory.

python -m processor.server --port 5026 --data .hamma-data/page-stress
python scripts/stress-processor.py http://127.0.0.1:5026 --sessions 8
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
from http.cookiejar import CookieJar
from io import BytesIO
import json
import time
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile


def run(base, sessions):
    def session(index):
        client = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

        def call(path, value=None, method='GET', raw=False, headers=None):
            body = value if raw else json.dumps(value).encode() if value is not None else None
            request = Request(base + path, data=body, method=method, headers={
                'X-Hamma-Request': '1',
                **({'Content-Type': 'application/json'} if value is not None and not raw else {}),
                **(headers or {}),
            })
            with client.open(request, timeout=30) as response:
                data = response.read()
                return data if raw else json.loads(data)

        payload = (f'Synthetic session {index}: Unicode 世界 and exact content\n' * 8192).encode()
        jobs = []
        for target in ('zip', 'gzip', 'corrupt'):
            content = b'PK\x03\x04not an archive' if target == 'corrupt' else payload
            source = call('/api/process/uploads', {'name': f'stress-{index}.txt', 'size': len(content)}, 'POST')
            midpoint = len(content) // 2
            for offset, chunk in ((0, content[:midpoint]), (midpoint, content[midpoint:])):
                result = json.loads(call('/api/process/uploads/' + source['id'], chunk, 'PUT', True, {'Upload-Offset': str(offset)}))
                assert result['offset'] == offset + len(chunk), result
            body = {'uploads': [source['id']], 'operation': 'extract' if target == 'corrupt' else 'compress',
                    'target': 'zip' if target == 'corrupt' else target, 'requestId': hashlib.sha256(f'{index}-{target}'.encode()).hexdigest()}
            job = call('/api/process/jobs', body, 'POST')
            repeated = call('/api/process/jobs', body, 'POST')
            assert job['id'] == repeated['id'], 'Duplicate submission created extra work'
            jobs.append((job['id'], target))

        deadline = time.monotonic() + 120
        pending = dict(jobs)
        completed = []
        while pending and time.monotonic() < deadline:
            for job_id, target in list(pending.items()):
                job = call('/api/process/jobs/' + job_id)
                if job['state'] not in ('completed', 'failed', 'cancelled', 'interrupted'):
                    continue
                del pending[job_id]
                if target == 'corrupt':
                    assert job['state'] == 'failed' and not job['downloadAvailable'], job
                    continue
                assert job['state'] == 'completed', job
                output = call(job['download'], raw=True)
                assert hashlib.sha256(output).hexdigest() == job['sha256'], 'Output checksum mismatch'
                if target == 'zip':
                    with ZipFile(BytesIO(output)) as archive:
                        restored = archive.read(f'stress-{index}.txt')
                else:
                    restored = gzip.decompress(output)
                assert restored == payload, 'Lossless round trip failed'
                suffix = call(job['download'], raw=True, headers={'Range': 'bytes=-16'})
                assert suffix == output[-16:], 'Range download mismatch'
                completed.append(job)
            if pending:
                time.sleep(.25)
        assert not pending, f'Jobs exceeded the deadline: {pending}'
        assert call('/api/process/jobs')['total'] == 3, 'History isolation/deduplication failed'
        for page in ('/', '/assets/does-not-exist.js'):
            try:
                response = call(page, raw=True)
                assert page == '/' and b'root' in response
            except HTTPError as error:
                assert page != '/' and error.code == 404
        return call, completed

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=sessions) as pool:
        results = list(pool.map(session, range(sessions)))
    for index, (call, _) in enumerate(results):
        foreign = results[(index + 1) % sessions][1][0]
        for path in ('/api/process/jobs/' + foreign['id'], foreign['download']):
            try:
                call(path, raw=True)
            except HTTPError as error:
                assert error.code in (403, 404), error.code
            else:
                raise AssertionError('Cross-session access succeeded')
    return {'sessions': sessions, 'jobs': sessions * 3, 'verifiedDownloads': sessions * 2,
            'expectedCorruptFailures': sessions, 'elapsedSeconds': round(time.monotonic() - started, 2)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', help='URL of the disposable processor instance')
    parser.add_argument('--sessions', type=int, default=8, choices=range(2, 17))
    args = parser.parse_args()
    print(json.dumps(run(args.base.rstrip('/'), args.sessions), indent=2))
