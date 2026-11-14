"""Verify resumable mixed-project HTTP jobs with a disposable processor."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
from http.cookiejar import CookieJar
from io import BytesIO
import json
from pathlib import Path
import platform
import random
import tarfile
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile

from .native import capability
from .resources import configured_limits
from .server import LocalHTTPServer, Service, handler

MIB = 1024 ** 2
CHUNK = 4 * MIB
OWNERS = 4
ROUNDS = 3


def run(base):
    submitted = threading.Barrier(OWNERS)
    foreign_ready = threading.Barrier(OWNERS)
    outputs = {}
    event = threading.Lock()
    started = time.monotonic()

    def owner(index):
        jar = CookieJar()
        client = build_opener(ProxyHandler({}), HTTPCookieProcessor(jar))

        def call(path, value=None, method='GET', headers=None, raw=False):
            data = json.dumps(value).encode() if isinstance(value, dict) else value
            request = Request(base + path, data, {
                'X-Hamma-Request': '1',
                **({'Content-Type': 'application/json'} if isinstance(value, dict) else {}),
                **(headers or {}),
            }, method=method)
            with client.open(request, timeout=45) as response:
                body = response.read()
                return body if raw else json.loads(body)

        def put(path, payload, offset=0, writer=None, stop=None):
            end = len(payload) if stop is None else stop
            for start in range(offset, end, CHUNK):
                data = payload[start:min(start + CHUNK, end)]
                headers = {'Upload-Offset': str(start)}
                if writer:
                    headers['Upload-Writer'] = writer
                assert call(path, data, 'PUT', headers)['offset'] == start + len(data)

        def reserve(project, source):
            return call('/api/process/uploads', {
                **{key: source[key] for key in ('name', 'size', 'directory')},
                'projectId': project, 'sourceId': source['id'],
            }, 'POST')['id']

        def submit(project, operation, target, uploads):
            identity = hashlib.sha256(f'{index}/{project}/{operation}/{target}'.encode()).hexdigest()
            body = {'projectId': project, 'operation': operation, 'target': target,
                    'uploads': uploads, 'requestId': identity}
            job = call('/api/process/jobs', body, 'POST')
            assert call('/api/process/jobs', body, 'POST')['id'] == job['id']
            return job

        def finish(job, max_seconds=240):
            deadline = time.monotonic() + max_seconds
            while time.monotonic() < deadline:
                job = call('/api/process/jobs/' + job['id'])
                if job['state'] in ('completed', 'failed', 'interrupted', 'cancelled'):
                    break
                time.sleep(.4)
            assert job['state'] == 'completed', job
            data = call(job['download'], raw=True)
            assert hashlib.sha256(data).hexdigest() == job['sha256']
            assert call(job['download'], headers={'Range': 'bytes=-32'}, raw=True) == data[-32:]
            return job, data

        timings = []
        for round_index in range(ROUNDS):
            project = f'mixed-{round_index}'
            quick = f'quick-{round_index}'
            for key in (project, quick):
                call('/api/process/projects/' + key, {}, 'PUT')
            samples = [
                (f'nested/owner-{index}-世界.bin', random.Random(index * 100 + round_index).randbytes(16 * MIB)),
                ('completed.bin', bytes(range(256)) * (MIB // 256)),
                ('unstarted.txt', b'pending selection\n' * 4096),
            ]
            sources = [{'id': f'{item + 1:032x}', 'name': name, 'size': len(payload), 'directory': False}
                       for item, (name, payload) in enumerate(samples)]
            path = '/api/process/projects/' + project + '/inputs'
            call(path, {'selections': sources}, 'PUT')
            partial, complete = [reserve(project, source) for source in sources[:2]]
            partial_path = '/api/process/uploads/' + partial
            put(partial_path, samples[0][1], stop=CHUNK)
            put('/api/process/uploads/' + complete, samples[1][1])

            quick_data = gzip.compress(b'quick verification' * 1024, mtime=0)
            quick_id = call('/api/process/uploads', {'name': 'interactive.txt.gz', 'size': len(quick_data)}, 'POST')['id']
            put('/api/process/uploads/' + quick_id, quick_data)
            quick_job = submit(quick, 'extract', 'zip', [quick_id])

            # Reopen with the same guest cookies, using a fresh HTTP opener.
            client = build_opener(ProxyHandler({}), HTTPCookieProcessor(jar))
            page = call(path + '?includeIncomplete=1&includeSelections=1')
            assert len(page['sources']) == 3 and page['unavailable'] == 0, page
            interrupted, finished, pending = page['sources']
            assert interrupted['upload'] == partial and interrupted['uploaded'] == CHUNK
            assert finished['upload'] == complete and finished['uploaded'] == len(samples[1][1])
            assert pending['pending'] and 'upload' not in pending
            saved = call(partial_path + f'/prefix?start=0&length={CHUNK}')
            assert saved['sha256'] == hashlib.sha256(samples[0][1][:CHUNK]).hexdigest()
            writer = f'{index * ROUNDS + round_index + 1:032x}'
            call(partial_path + '/resume', {'offset': CHUNK, 'writer': writer}, 'POST')
            put(partial_path, samples[0][1], offset=CHUNK, writer=writer)
            new_id = reserve(project, sources[2])
            put('/api/process/uploads/' + new_id, samples[2][1])

            target = ('zip', 'tar.gz', 'tar.zst')[round_index]
            batch = submit(project, 'compress', target, [partial, complete, new_id])
            submitted.wait(timeout=180)
            quick_job, data = finish(quick_job)
            with ZipFile(BytesIO(data)) as archive:
                assert archive.read('interactive.txt') == gzip.decompress(quick_data)
            batch, data = finish(batch)
            if target == 'zip':
                with ZipFile(BytesIO(data)) as archive:
                    assert [(name, archive.read(name)) for name in archive.namelist()] == samples
            elif target == 'tar.gz':
                with tarfile.open(fileobj=BytesIO(data), mode='r:gz') as archive:
                    assert [(name, archive.extractfile(name).read()) for name in archive.getnames()] == samples
            else:
                source = call('/api/process/jobs/' + batch['id'] + '/reuse',
                              {'projectId': project, 'name': batch['outputName']}, 'POST')
                assert source['uploaded'] == len(data)
                _, restored = finish(submit(project, 'extract', 'zip', [source['upload']]))
                with ZipFile(BytesIO(restored)) as archive:
                    assert [(name, archive.read(name)) for name in archive.namelist()] == samples
            timings.append({'target': target, 'inputBytes': sum(len(payload) for _, payload in samples),
                            'quickJobSeconds': round(quick_job['finished'] - quick_job['created'], 3),
                            'batchJobSeconds': round(batch['finished'] - batch['created'], 3)})
        with event:
            outputs[index] = batch
        foreign_ready.wait(timeout=300)
        foreign = outputs[(index + 1) % OWNERS]
        for path in ('/api/process/jobs/' + foreign['id'], foreign['download']):
            try:
                call(path, raw=True)
            except HTTPError as error:
                assert error.code in (403, 404), error
            else:
                raise AssertionError('Cross-owner job access succeeded')
        return timings

    def run_owner(index):
        try:
            return owner(index)
        except Exception:
            submitted.abort()
            foreign_ready.abort()
            raise

    with ThreadPoolExecutor(OWNERS) as pool:
        futures = [pool.submit(run_owner, index) for index in range(OWNERS)]
        runs = []
        for future in futures:
            try:
                runs.append(future.result())
            except threading.BrokenBarrierError:
                continue
        assert len(runs) == OWNERS
    return {'owners': OWNERS, 'rounds': ROUNDS, 'projects': OWNERS * ROUNDS * 2,
            'jobs': OWNERS * (ROUNDS * 2 + 1), 'resumedUploads': OWNERS * ROUNDS,
            'resumedBytes': OWNERS * ROUNDS * 12 * MIB,
            'mixedBatchInputBytes': sum(item['inputBytes'] for run in runs for item in run),
            'foreignAccessDenied': OWNERS * 2, 'sha256AndRangeVerified': True,
            'chainedOutputsVerified': OWNERS,
            'seconds': round(time.monotonic() - started, 3), 'runs': runs}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not capability():
        parser.error('Build SHANTE or set SHANTE_CORE_BINARY before running this workload')
    limits = {**configured_limits({}), 'input': 64 * MIB, 'expanded': 64 * MIB,
              'storage': 1024 * MIB, 'seconds': 180}
    with tempfile.TemporaryDirectory(prefix='hamma-mixed-http-') as folder:
        service = Service(folder, limits=limits)
        with LocalHTTPServer(('127.0.0.1', 0), handler(service)) as server:
            http = threading.Thread(target=server.serve_forever, daemon=True)
            scheduler = threading.Thread(target=service.loop, daemon=True)
            http.start()
            scheduler.start()
            try:
                report = run(f'http://127.0.0.1:{server.server_port}')
            finally:
                server.shutdown()
                service.close()
                http.join(3)
                scheduler.join(3)
    report['platform'] = platform.platform()
    report['python'] = platform.python_version()
    report['native'] = capability()['version']
    report['zstandard'] = capability()['codecVersion']
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'runs'}))
