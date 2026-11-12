"""Exercise fair dispatch against retained job metadata in a disposable database."""
import argparse
from collections import deque
import hashlib
from http.cookiejar import CookieJar
from io import BytesIO
import json
from pathlib import Path
import random
import statistics
import tempfile
import threading
import time
from unittest.mock import patch

from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request
from zipfile import ZipFile

from .resources import configured_limits
from .server import LocalHTTPServer, Service, Store, handler


def run():
    projects, retained, queued, rounds = 20, 250, 15, 5
    owner = 'a' * 64
    with tempfile.TemporaryDirectory(prefix='hamma-scheduler-benchmark-') as folder:
        store = Store(folder)
        pending = {}
        project_rotation = deque()

        def records():
            sequence = 0
            for project in range(projects):
                name = f'project-{project}'
                project_rotation.append(name)
                pending[name] = deque()
                for item in range(retained + queued):
                    sequence += 1
                    job_id = f'{sequence:032x}'
                    waiting = item >= retained
                    if waiting:
                        pending[name].append(job_id)
                    data = {'id': job_id, 'created': sequence, 'state': 'queued' if waiting else 'completed',
                            'projectId': name, 'inputs': []}
                    if not waiting:
                        data['scheduled'] = item + 1
                    yield job_id, owner, 'job', sequence, json.dumps(data)

        with store.connect() as db:
            db.executemany('INSERT INTO records VALUES (?,?,?,?,?)', records())

        samples = []
        for dispatch in range(projects * rounds):
            expected = project_rotation.popleft()
            project_rotation.append(expected)
            started = time.perf_counter()
            (job_owner, job), = store.queued(fair=True)
            samples.append(time.perf_counter() - started)
            assert job_owner == owner and job['projectId'] == expected, job
            assert job['id'] == pending[expected].popleft(), job
            store.patch(owner, 'job', job['id'], scheduled=retained + dispatch + 1, state='completed')

        return {
            'projects': projects,
            'retainedJobs': projects * retained,
            'initialQueuedJobs': projects * queued,
            'dispatches': len(samples),
            'medianSelectionMs': round(statistics.median(samples) * 1000, 3),
            'p95SelectionMs': round(statistics.quantiles(samples, n=100, method='inclusive')[94] * 1000, 3),
            'fairRotationAndProjectFifoVerified': True,
            'scope': 'SQLite scheduler selection over synthetic metadata; excludes job execution and admission wait',
        }


def run_workers(multiple_owners=False):
    """Submit real uploads and check owner and project rotation with one worker slot."""
    mib = 1024 ** 2
    limits = {**configured_limits({}), 'input': 16 * mib, 'expanded': 24 * mib,
              'storage': 256 * mib, 'seconds': 60}
    payloads = {project: random.Random(index).randbytes(size)
                for index, (project, size) in enumerate([
                    ('bulk-a', 4 * mib), ('bulk-b', 4 * mib), ('interactive', 64 * 1024)])}
    with tempfile.TemporaryDirectory(prefix='hamma-worker-benchmark-') as folder:
        service = Service(folder, limits=limits)
        with LocalHTTPServer(('127.0.0.1', 0), handler(service)) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            clients = {
                project: build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
                for project in ('bulk-a', 'interactive')
            }
            clients['bulk-b'] = clients['bulk-a']
            if not multiple_owners:
                clients['interactive'] = clients['bulk-a']
            base = f'http://127.0.0.1:{server.server_port}'

            def call(project, path, body=None, method='GET', headers=None, binary=False):
                data = json.dumps(body).encode() if isinstance(body, dict) else body
                request = Request(base + path, data=data, method=method, headers={
                    'X-Hamma-Request': '1',
                    **({'Content-Type': 'application/json'} if isinstance(body, dict) else {}),
                    **(headers or {}),
                })
                with clients[project].open(request, timeout=15) as response:
                    raw = response.read()
                    return raw if binary else json.loads(raw)

            try:
                uploads = {}
                for project, payload in payloads.items():
                    upload = call(project, '/api/process/uploads', {'name': project + '.bin', 'size': len(payload)}, 'POST')
                    uploads[project] = upload['id']
                    for offset in range(0, len(payload), mib):
                        chunk = payload[offset:offset + mib]
                        result = call(project, '/api/process/uploads/' + upload['id'], chunk, 'PUT',
                                      {'Upload-Offset': str(offset)})
                        assert result['offset'] == offset + len(chunk)

                jobs = {}
                def submit(project, count):
                    for _ in range(count):
                        job = call(project, '/api/process/jobs', {'uploads': [uploads[project]], 'operation': 'compress',
                                                         'target': 'zip', 'projectId': project}, 'POST')
                        jobs[job['id']] = project

                submit('bulk-a', 4)
                submit('bulk-b', 4)
                started = time.monotonic()
                # Limit dispatch to a single slot to reproduce contention on
                # hosts with spare cores or memory. Workers still run normally.
                with patch('processor.server.worker_capacity', return_value=1):
                    service.tick()
                    assert len(service.running) == 1, 'The initial bulk job was not admitted'
                    submit('interactive', 3)
                    while time.monotonic() - started < 180:
                        service.tick()
                        if not service.running and not service.store.count(states=('queued',)):
                            break
                        time.sleep(.1)
                    else:
                        raise RuntimeError('Worker workload exceeded 180 seconds')
                worker_seconds = time.monotonic() - started

                records = {record['id']: record for _, record in service.store.iter_records()}
                assert records.keys() == jobs.keys(), records.keys()
                ordered = sorted(records.values(), key=lambda job: job['scheduled'])
                assert all(record['state'] == 'completed' for record in ordered), [
                    (record['projectId'], record['state'], record.get('error')) for record in ordered]
                order = [record['projectId'] for record in ordered]
                expected = (['bulk-a', 'interactive', 'bulk-b', 'interactive', 'bulk-a', 'interactive',
                             'bulk-b', 'bulk-a', 'bulk-b', 'bulk-a', 'bulk-b'] if multiple_owners
                            else ['bulk-a', 'bulk-b', 'interactive'] * 3 + ['bulk-a', 'bulk-b'])
                assert order == expected, order

                for record in ordered:
                    project = record['projectId']
                    public = call(project, '/api/process/jobs/' + record['id'])
                    output = call(project, public['download'], binary=True)
                    assert hashlib.sha256(output).hexdigest() == record['sha256']
                    if multiple_owners:
                        other = 'bulk-a' if project == 'interactive' else 'interactive'
                        try:
                            call(other, public['download'], binary=True)
                        except HTTPError as error:
                            with error:
                                assert error.code in (403, 404)
                        else:
                            raise AssertionError('A second owner could fetch the download')
                    with ZipFile(BytesIO(output)) as archive:
                        assert archive.namelist() == [project + '.bin']
                        assert archive.read(project + '.bin') == payloads[project]

                return {
                    'jobs': len(ordered), 'projects': 3, 'owners': 2 if multiple_owners else 1,
                    'dispatchOrder': order, 'verifiedDownloads': len(ordered),
                    'crossOwnerDownloadsRejected': len(ordered) if multiple_owners else None,
                    'verifiedInputBytes': sum(len(payloads[record['projectId']]) for record in ordered),
                    'interactiveQueueWaitSeconds': [
                        round(record['scheduled'] - record['created'], 3)
                        for record in ordered if record['projectId'] == 'interactive'],
                    'workerElapsedSeconds': round(worker_seconds, 3),
                    'scope': 'Loopback HTTP and spawned workers, three projects sharing one worker slot',
                }
            finally:
                server.shutdown()
                thread.join()
                service.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--workers', action='store_true', help='Run the HTTP and worker workload')
    parser.add_argument('--multiple-owners', action='store_true', help='Run the worker workload with two guests')
    args = parser.parse_args()
    result = json.dumps(run_workers(args.multiple_owners) if args.workers or args.multiple_owners else run(), indent=2) + '\n'
    args.output.write_text(result, encoding='utf-8')
    print(result, end='')
