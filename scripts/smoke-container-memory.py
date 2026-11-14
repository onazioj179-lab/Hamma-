"""Exercise HTTP job admission under a disposable container's real memory limit."""

import hashlib
from http.cookiejar import CookieJar
from io import BytesIO
import json
import subprocess
import sys
import time
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile

from processor.resources import available_memory, cgroup_available, MIB, worker_capacity


PRESSURE = """
import sys
from processor.resources import cgroup_available, MIB

pages = []
for _ in range(32):
    if cgroup_available() < 1152 * MIB:
        print('ready', flush=True)
        sys.stdin.buffer.read(1)
        break
    pages.append(bytearray(b'x') * (16 * MIB))
else:
    raise RuntimeError('The bounded fixture could not create memory pressure')
"""


def check():
    client = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

    def call(path, data=None, method='GET', **headers):
        request = Request('http://127.0.0.1:5010' + path, data, method=method,
                          headers={'X-Hamma-Request': '1', **headers})
        with client.open(request, timeout=5) as response:
            return response.read()

    def post(path, body):
        return json.loads(call(path, json.dumps(body).encode(), 'POST',
                               **{'Content-Type': 'application/json'}))

    before = cgroup_available()
    assert before is not None and worker_capacity(available_memory()) == 1, before
    payload = b'HAMMA memory admission fixture\n'
    upload = post('/api/process/uploads', {'name': 'fixture.txt', 'size': len(payload)})
    committed = call('/api/process/uploads/' + upload['id'], payload, 'PUT',
                     **{'Upload-Offset': '0'})
    assert json.loads(committed)['offset'] == len(payload)
    with subprocess.Popen([sys.executable, '-c', PRESSURE], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE) as pressure:
        try:
            assert pressure.stdout.readline() == b'ready\n', 'Memory fixture failed'
            during = cgroup_available()
            assert during < 1152 * MIB and worker_capacity(available_memory()) == 0, during
            job = post('/api/process/jobs', {'operation': 'compress', 'target': 'zip',
                                             'uploads': [upload['id']]})
            path = '/api/process/jobs/' + job['id']
            for _ in range(10):
                state = json.loads(call(path))
                assert state['state'] == 'queued' and state.get('scheduled') is None, state
                assert json.loads(call('/api/process/ready')) == {'ready': True}
                time.sleep(.2)
        finally:
            pressure.stdin.close()
            pressure.wait(timeout=5)

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        job = json.loads(call(path))
        if job['state'] not in ('queued', 'processing', 'verifying'):
            break
        time.sleep(.2)
    assert job['state'] == 'completed', job
    data = call(job['download'])
    assert hashlib.sha256(data).hexdigest() == job['sha256']
    with ZipFile(BytesIO(data)) as archive:
        assert archive.namelist() == ['fixture.txt']
        assert archive.read('fixture.txt') == payload
    print(f'Memory headroom was {before // MIB} MiB before pressure and {during // MIB} MiB '
          'while queued. The same job completed with verified bytes after release.')


if __name__ == '__main__':
    check()
