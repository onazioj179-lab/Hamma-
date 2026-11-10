"""Run an operator-authorized directory job using the normal durable scheduler."""
import argparse
import hashlib
import json
from pathlib import Path
import time

from .server import Service, TERMINAL
from .indexed_archive import TARGETS
from .engine import ProcessingError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--data', type=Path, required=True, help='Processor data directory; stop its other server first')
    parser.add_argument('--target', choices=TARGETS, default='tar.gz')
    parser.add_argument('--owner', default=hashlib.sha256(b'shante-local-operator-v1').hexdigest(), help='Explicit local owner scope; not an HTTP authentication bypass')
    parser.add_argument('--project', default='default')
    parser.add_argument('--resume-job', help='Resume a queued/interrupted operator job instead of creating a new one')
    args = parser.parse_args()
    service = None
    try:
        service = Service(args.data)
        if args.resume_job:
            service.store.folder(args.owner, args.resume_job)
            job = service.store.get(args.owner, 'job', args.resume_job)
            source = service.store.local_source(args.owner, args.resume_job)
            if not job or job.get('inputMode') != 'directory-index' or source != args.source.resolve(strict=True):
                raise ValueError('Indexed job unavailable for this owner and source')
            if job['fileExpires'] <= time.time():
                raise ValueError('Job retention expired')
            if job['state'] in ('failed', 'interrupted', 'cancelled', 'paused'):
                folder = service.store.folder(args.owner, job['id'])
                (folder / 'cancel').unlink(missing_ok=True)
                service.store.patch(args.owner, 'job', job['id'], state='queued', error=None, errorInfo=None, processed=0,
                                    retryCount=job.get('retryCount', 0) + 1, hidden=False)
        else:
            job = service.enqueue_directory(args.owner, args.source, args.target, args.project)
        print(json.dumps({'id': job['id'], 'owner': args.owner, 'state': job['state']}), flush=True)
        while True:
            service.tick()
            record = service.store.get(args.owner, 'job', job['id'])
            if record['state'] in TERMINAL:
                result = service.public(args.owner, record)
                result.pop('download', None)  # no HTTP server is running in this operator command
                if record['state'] == 'completed':
                    result['artifact'] = str(service.store.folder(args.owner, job['id']) / record['outputFile'])
                print(json.dumps(result), flush=True)
                if record['state'] != 'completed':
                    parser.exit(1, 'Processing incomplete; retained discovery can be resumed within policy.\n')
                break
            time.sleep(.25)
    except (OSError, RuntimeError, ValueError, ProcessingError) as error:
        parser.exit(1, f'Local job unavailable: {error}\n')
    except KeyboardInterrupt:
        parser.exit(130, 'Worker stopped; rerun with --resume-job and the emitted job identifier.\n')
    finally:
        if service is not None:
            service.close()


if __name__ == '__main__':
    main()
