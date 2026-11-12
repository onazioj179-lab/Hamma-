"""Exercise fair dispatch against retained job metadata in a disposable database."""
import argparse
from collections import deque
import json
from pathlib import Path
import statistics
import tempfile
import time

from .server import Store


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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = json.dumps(run(), indent=2) + '\n'
    args.output.write_text(result, encoding='utf-8')
    print(result, end='')
