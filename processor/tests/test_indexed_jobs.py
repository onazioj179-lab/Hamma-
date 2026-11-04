import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import json
import subprocess
import sys
import gc
import tracemalloc
import unittest
from unittest.mock import patch

from processor.engine import Context, ProcessingError
from processor.indexing import DirectoryIndex
from processor.indexed_archive import ArchiveManifest, compress_index, manifest_page, open_source
from processor.resources import configured_limits
from processor.server import Service, run_job
import test_server
from test_engine import LIMITS


class IndexedArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'source'
        self.source.mkdir()
        self.work = self.base / 'work'
        self.work.mkdir()

    def index(self):
        index = DirectoryIndex(self.work / 'index.sqlite3', self.source, max_entries=LIMITS['files'], batch_size=2)
        self.assertTrue(index.discover())
        return index

    def context(self, **limits):
        return Context(self.work, {**LIMITS, **limits})

    def test_all_tar_formats_verify_real_bytes_unicode_and_empty_directories(self):
        (self.source / 'empty').mkdir()
        data = 'SHANTE 世界\n'.encode() * 2000
        (self.source / '世界.txt').write_bytes(data)
        index = self.index()
        for target in ('tar', 'tar.gz', 'tar.bz2', 'tar.xz'):
            with self.subTest(target=target):
                output = self.work / ('output.' + target)
                result = compress_index(index, output, target, self.context())
                self.assertEqual(result['inputBytes'], len(data))
                self.assertEqual(result['entries'], 2)
                rows = manifest_page(index.database)
                self.assertEqual(len(rows), 2)
                row = next(row for row in rows if not row['directory'])
                self.assertEqual(row['sha256'], hashlib.sha256(data).hexdigest())
                with tarfile.open(output) as archive:
                    self.assertEqual(archive.extractfile('世界.txt').read(), data)
                    self.assertTrue(archive.getmember('empty').isdir())

    def test_changed_file_and_output_limits_never_publish_partial_archive(self):
        path = self.source / 'input'
        path.write_bytes(b'original')
        index = self.index()
        path.write_bytes(b'changed and larger')
        output = self.work / 'out.tar'
        with self.assertRaisesRegex(ProcessingError, 'changed'):
            compress_index(index, output, 'tar', self.context())
        self.assertFalse(output.exists())
        self.assertEqual(list(self.work.glob('*.part-*')), [])
        index._commit([('input', 'file', path.stat().st_size, path.stat().st_mtime_ns, None)])
        with self.assertRaises(ProcessingError):
            compress_index(index, output, 'tar', self.context(expanded=512))
        self.assertFalse(output.exists())
        self.assertEqual(list(self.work.glob('*.part-*')), [])

    def test_duplicate_casefold_and_parent_conflicts_use_disk_registry(self):
        manifest = ArchiveManifest(self.index())
        manifest.add(1, 'Folder/a', False, 0, 'hash')
        with self.assertRaises(ProcessingError):
            manifest.add(2, 'folder/A', False, 0, 'hash')
        with self.assertRaises(ProcessingError):
            manifest.add(3, 'folder', False, 0, 'hash')
        manifest.add(4, 'parent', False, 0, 'hash')
        with self.assertRaises(ProcessingError):
            manifest.add(5, 'parent/child', False, 0, 'hash')

    def test_repeated_safe_opens_have_bounded_python_memory_and_release_handles(self):
        path = self.source / 'input'
        path.write_bytes(b'payload')
        with open_source(self.source, 'input') as source:
            self.assertEqual(source.read(), b'payload')
        gc.collect()
        tracemalloc.start()
        try:
            for _ in range(512):
                with open_source(self.source, 'input') as source:
                    self.assertEqual(source.read(), b'payload')
            gc.collect()
            current, _ = tracemalloc.get_traced_memory()
            self.assertLess(current, 1024**2, 'Repeated safe opens retained per-file Python state')
        finally:
            tracemalloc.stop()
        path.unlink()  # Windows sharing makes leaked read handles observable here.

    def test_unicode_normalization_does_not_change_the_source_path(self):
        name = 'cafe\u0301.txt'
        (self.source / name).write_bytes(b'original spelling')
        output = self.work / 'out.tar'
        compress_index(self.index(), output, 'tar', self.context())
        with tarfile.open(output) as archive:
            self.assertEqual(archive.extractfile('caf\u00e9.txt').read(), b'original spelling')

    def test_verification_detects_corrupted_payload_before_publication(self):
        (self.source / 'input').write_bytes(b'payload')
        index = self.index()
        output = self.work / 'out.tar'
        original = tarfile.open

        def corrupt_then_read(name=None, mode='r', **kwargs):
            if mode == 'r|*':
                with Path(name).open('r+b') as stream:
                    stream.seek(512)
                    stream.write(b'!')
            return original(name=name, mode=mode, **kwargs)

        with patch('processor.indexed_archive.tarfile.open', side_effect=corrupt_then_read):
            with self.assertRaisesRegex(ProcessingError, 'Integrity'):
                compress_index(index, output, 'tar', self.context())
        self.assertFalse(output.exists())

    def test_disk_manifest_batch_boundaries_cancellation_and_no_overwrite(self):
        for number in range(257):
            (self.source / str(number)).write_bytes(str(number).encode())
        index = self.index()
        output = self.work / 'out.tar'
        result = compress_index(index, output, 'tar', self.context())
        self.assertEqual(result['entries'], 257)
        self.assertEqual(len(manifest_page(index.database, limit=256)), 256)
        self.assertEqual(len(manifest_page(index.database, after=256)), 1)
        before = output.read_bytes()
        with self.assertRaises(FileExistsError):
            compress_index(index, output, 'tar', self.context())
        self.assertEqual(output.read_bytes(), before)
        (self.work / 'cancel').touch()
        with self.assertRaises(ProcessingError):
            compress_index(index, self.work / 'cancelled.tar', 'tar', self.context())
        self.assertFalse((self.work / 'cancelled.tar').exists())


class IndexedJobRoutes(unittest.TestCase):
    setUp = test_server.ServerTests.setUp
    tearDown = test_server.ServerTests.tearDown
    call = test_server.ServerTests.call
    upload = test_server.ServerTests.upload
    assert_status = test_server.ServerTests.assert_status

    def source(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        (root / 'a.txt').write_bytes(b'first')
        (root / 'b.txt').write_bytes(b'second')
        self.upload()  # establish this HTTP client's owner scope
        owner = self.service.store.list(kind='upload')[0][0]
        return root, owner

    def test_job_integrates_history_manifest_downloads_and_owner_isolation(self):
        from http.cookiejar import CookieJar
        from urllib.request import build_opener, HTTPCookieProcessor
        root, owner = self.source()
        job = self.service.enqueue_directory(owner, root, 'tar')
        self.assert_status(410, lambda: self.call('/jobs/' + job['id'] + '/manifest'))
        run_job(self.temp.name, owner, job['id'], LIMITS)
        result = self.call('/jobs/' + job['id'])
        self.assertEqual(result['state'], 'completed', result)
        self.assertEqual((result['fileCount'], result['inputSize']), (2, 11))
        self.assertNotIn(str(root), str(result))
        self.assertEqual(self.call('/jobs')['jobs'][0]['fileCount'], 2)
        first = self.call('/jobs/' + job['id'] + '/manifest?limit=1')
        second = self.call('/jobs/' + job['id'] + '/manifest?limit=1&after=' + first['nextCursor'])
        self.assertNotEqual(first['files'][0]['id'], second['files'][0]['id'])
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assert_status(404, lambda: self.call('/jobs/' + job['id'] + '/manifest', client=stranger))
        payload = self.call(result['download'].removeprefix('/api/process'), raw=True)
        self.assertEqual(hashlib.sha256(payload).hexdigest(), result['sha256'])
        with tarfile.open(fileobj=io.BytesIO(payload)) as archive:
            self.assertEqual(archive.extractfile('a.txt').read(), b'first')
        # Deleting stored outputs must never delete authorized original files.
        self.call('/jobs/' + job['id'] + '/files', method='DELETE')
        self.assertEqual((root / 'a.txt').read_bytes(), b'first')
        self.assertIsNone(self.service.store.local_source(owner, job['id']))

    def test_index_checkpoint_survives_restart_retry_and_storage_checks(self):
        root, owner = self.source()
        job = self.service.enqueue_directory(owner, root, 'tar')
        folder = self.service.store.folder(owner, job['id'])
        index = DirectoryIndex(folder / 'discovery.sqlite3', root, max_entries=LIMITS['files'])
        index.discover()
        ids = [row['id'] for row in index.page()]
        self.service.store.patch(owner, 'job', job['id'], state='processing')
        self.service.close()
        self.service = Service(self.temp.name, limits=LIMITS)
        self.assertEqual(self.service.store.get(owner, 'job', job['id'])['state'], 'interrupted')
        self.assertTrue(index.database.exists())
        self.service.store.patch(owner, 'job', job['id'], state='queued')
        run_job(self.temp.name, owner, job['id'], LIMITS)
        self.assertEqual(self.service.store.get(owner, 'job', job['id'])['state'], 'completed')
        self.assertEqual([row['id'] for row in index.page()], ids)

    def test_storage_accounting_and_failure_preserve_originals(self):
        root, owner = self.source()
        job = self.service.enqueue_directory(owner, root, 'tar')
        with patch('processor.server.shutil.disk_usage', return_value=type('Disk', (), {'free': 1})()):
            run_job(self.temp.name, owner, job['id'], LIMITS)
        result = self.service.store.get(owner, 'job', job['id'])
        self.assertEqual(result['state'], 'failed')
        self.assertEqual(result['errorInfo']['category'], 'insufficient_storage')
        self.assertGreater(result['indexBytes'], 0)
        self.assertFalse(result['downloadAvailable'])
        self.assertGreaterEqual(self.service.store.reserved_bytes(), result['indexBytes'])
        self.service.delete_files(owner, result)
        self.assertEqual((root / 'a.txt').read_bytes(), b'first')
        self.assertEqual(self.service.store.get(owner, 'job', job['id'])['indexBytes'], 0)


class LocalJobCommandTests(unittest.TestCase):
    def test_command_runs_a_real_scheduled_worker_and_can_reopen_completed_job(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            source = base / 'source'
            source.mkdir()
            (source / 'hello.txt').write_bytes(b'scheduled worker payload')
            # Real command main + real spawned worker; keep admission independent
            # of unrelated host load. Production admission is never bypassed.
            runner = "from unittest.mock import patch\nfrom processor.local_job import main\nwith patch('processor.server.available_memory', return_value=4 * 1024**3): main()"
            command = [sys.executable, '-c', runner, str(source), '--data', str(base / 'data'), '--target', 'tar']
            completed = subprocess.run(command, capture_output=True, text=True, timeout=60)
            self.assertEqual(completed.returncode, 0, completed.stderr + completed.stdout)
            records = [json.loads(line) for line in completed.stdout.splitlines()]
            self.assertEqual(records[-1]['state'], 'completed')
            self.assertEqual(records[-1]['entries'], 1)
            resumed = subprocess.run(command + ['--resume-job', records[0]['id']], capture_output=True, text=True, timeout=60)
            self.assertEqual(resumed.returncode, 0, resumed.stderr + resumed.stdout)
            self.assertEqual(json.loads(resumed.stdout.splitlines()[-1])['sha256'], records[-1]['sha256'])


class ConfiguredLimitsTests(unittest.TestCase):
    def test_explicit_policy_can_exceed_default_counts_without_capacity_claim(self):
        self.assertEqual(configured_limits({'SHANTE_MAX_FILES': '10000000'})['files'], 10000000)
        for value in ('0', '-1', '1e6', 'Infinity', str(2**64), ' 100'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                configured_limits({'SHANTE_MAX_FILES': value})
