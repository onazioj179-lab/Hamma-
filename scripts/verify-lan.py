"""Verify four independent browser-like sessions against an actual LAN server."""
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
from io import BytesIO
import json
import sys
import time
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile

base = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:5014'

def verify(index):
    client = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
    payload = (f'HAMMA concurrent Wi-Fi test session {index}\n' * 1024).encode()
    def call(path, value=None, method='GET', raw=False, headers=None):
        body = value if raw else json.dumps(value).encode() if value is not None else None
        request = Request(base + path, data=body, method=method, headers={
            'X-Hamma-Request': '1', **({'Content-Type': 'application/json'} if value is not None and not raw else {}), **(headers or {})})
        with client.open(request, timeout=30) as response:
            data = response.read()
            return data if raw else json.loads(data)
    source = call('/api/process/uploads', {'name': 'wifi-test.txt', 'size': len(payload)}, 'POST')
    call('/api/process/uploads/' + source['id'], payload, 'PUT', True, {'Upload-Offset': '0'})
    job = call('/api/process/jobs', {'uploads': [source['id']], 'operation': 'compress', 'target': 'zip'}, 'POST')
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        job = call('/api/process/jobs/' + job['id'])
        if job['state'] in ('completed', 'failed', 'interrupted', 'cancelled'):
            break
        time.sleep(.25)
    assert job['state'] == 'completed', job
    output = call(job['download'], raw=True)
    with ZipFile(BytesIO(output)) as archive:
        assert archive.read('wifi-test.txt') == payload
    assert call('/api/process/jobs')['total'] == 1
    return job, call

with ThreadPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(verify, range(4)))
for index, (_, call) in enumerate(results):
    try:
        call('/api/process/jobs/' + results[(index + 1) % 4][0]['id'])
    except HTTPError as error:
        assert error.code == 404
    else:
        raise AssertionError('A session accessed another session')
print('PASS: 4 concurrent sessions, 4 verified ZIP downloads, isolated histories and cross-session access denied.')
