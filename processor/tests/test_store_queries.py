"""Owner-scoped query regressions and a reproducible retained-history baseline."""
import json
from http.cookiejar import CookieJar
from pathlib import Path
import sqlite3
import statistics
import sys
import tempfile
import time
import tracemalloc
import unittest
import threading
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor

from processor.server import ACTIVE, LocalHTTPServer, Service, Store, handler, run_job

LIMITS = {'expanded': 32 * 1024**2, 'files': 5000, 'ratio': 1000, 'depth': 3,
          'seconds': 60, 'input': 64 * 1024**2, 'storage': 256 * 1024**2}


class StoreQueries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.owner, self.other = 'a' * 64, 'b' * 64

    def tearDown(self):
        self.temp.cleanup()

    def put(self, index, owner=None, **fields):
        record = {'id': f'{index:032x}', 'created': index, 'name': f'file-{index}.txt',
                  'state': 'completed', 'inputs': [], 'inputSize': index * 10,
                  'outputSize': index, 'downloadAvailable': True, 'outputFile': 'output.zip',
                  'fileExpires': 2e10, 'historyExpires': 2e10, **fields}
        self.store.put(owner or self.owner, 'job', record)
        return record

    def test_pages_match_unicode_casefold_filter_and_order_without_owner_leaks(self):
        names = ['zeta', 'Straße.txt', 'STRASSE.log', 'éclair', 'Alpha', '世界']
        records = [self.put(index, name=name, hidden=index == 0) for index, name in enumerate(names)]
        self.put(20, self.other, name='other-private')
        for sort in ('newest', 'oldest', 'name', 'size', 'unrecognized'):
            for search in ('', 'STRASSE', '世界', "' OR 1=1 --"):
                with self.subTest(sort=sort, search=search):
                    expected = [row for row in records if not row.get('hidden') and search.casefold() in row['name'].casefold()]
                    expected.sort(key=lambda row: row['created'], reverse=True)
                    if sort == 'name': expected.sort(key=lambda row: (row['name'].casefold(), row['created']))
                    elif sort == 'oldest': expected.sort(key=lambda row: row['created'])
                    elif sort == 'size': expected.sort(key=lambda row: row['inputSize'], reverse=True)
                    total, actual = self.store.history_page(self.owner, offset=1, limit=2, search=search, sort=sort)
                    self.assertEqual(total, len(expected))
                    self.assertEqual([row['id'] for row in actual], [row['id'] for row in expected[1:3]])
        self.assertEqual(self.store.history_page(self.owner, offset=2**100)[1], [])

    def test_count_resources_and_queue_admission_are_filtered_and_bounded(self):
        self.put(1, state='queued')
        self.put(2, state='paused')
        self.put(3, owner=self.other, state='queued', hidden=True)
        self.store.put(self.owner, 'upload', {'id': 'd' * 32, 'created': 1, 'size': 100, 'expires': 2e10})
        self.assertEqual(self.store.count(states=(*ACTIVE, 'paused')), 3)
        self.assertEqual(self.store.count(self.owner, states=('queued',)), 1)
        self.assertEqual(self.store.count(self.other, visible=True), 0)
        self.assertEqual(self.store.reserved_bytes(), 106)
        candidates = self.store.queued(excluded_owners={self.owner})
        self.assertEqual([owner for owner, _ in candidates], [self.other])
        self.assertEqual(len(self.store.queued(limit=1)), 1)

    def test_fair_dispatch_rotates_owners_before_projects_and_keeps_project_fifo(self):
        project_jobs = [
            (self.owner, self.put(index, state='queued', projectId=project))
            for index, project in enumerate(('shared', 'bulk', 'overflow', 'shared', 'bulk', 'overflow'), 1)
        ]
        other_jobs = [
            (self.other, self.put(index, owner=self.other, state='queued', projectId='shared'))
            for index in range(7, 13)
        ]
        (owner, first), = self.store.queued(excluded_owners={self.owner}, fair=True)
        self.assertEqual((owner, first['id']), (self.other, other_jobs[0][1]['id']))
        expected = [job for pair in zip(project_jobs, other_jobs) for job in pair]
        for sequence, (expected_owner, expected_job) in enumerate(expected, 20):
            (owner, job), = self.store.queued(fair=True)
            self.assertEqual((owner, job['id']), (expected_owner, expected_job['id']))
            self.store.patch(owner, 'job', job['id'], state='completed', scheduled=sequence)
        self.assertEqual(self.store.queued(fair=True), [])

    def test_history_summaries_keep_counts_without_loading_private_manifests(self):
        self.put(1, inputs=[{'id': f'{index:032x}', 'path': 'private-path'} for index in range(1000)],
                 manifest=[{'name': 'private-member'}], filesCleaned=False)
        total, rows = self.store.history_page(self.owner, summary=True)
        self.assertEqual(total, 1)
        self.assertEqual(rows[0]['fileCount'], 1000)
        for private in ('inputs', 'manifest', 'outputFile', 'filesCleaned'):
            self.assertNotIn(private, rows[0])

    def test_overview_counts_retained_jobs_and_projects_only_the_latest_five(self):
        for index in range(1, 7):
            self.put(index, operation='compress', manifest=[{'name': 'private'}])
        self.put(7, operation='extract', outputSize=10000)
        self.put(8, operation='compress', state='paused', outputSize=None)
        self.put(9, operation='compress', state='failed', outputSize=None)
        self.put(10, operation='compress', hidden=True)
        self.put(11, owner=self.other, operation='compress')
        metrics, latest = self.store.history_overview(self.owner)
        self.assertEqual(metrics, {'total': 9, 'completed': 7, 'active': 1, 'failed': 1,
                                   'compressed': 6, 'extracted': 1, 'converted': 0,
                                   'measured': 6, 'input': 210, 'output': 21})
        self.assertEqual([row['created'] for row in latest], [9, 8, 7, 6, 5])
        self.assertTrue(all('manifest' not in row and 'inputs' not in row for row in latest))

    def test_hidden_downloads_are_opt_in_owner_scoped_and_expire_independently(self):
        self.put(1, hidden=True)
        self.put(2, hidden=True, fileExpires=0)
        self.put(3, hidden=True, downloadAvailable=False)
        self.put(4, owner=self.other, hidden=True)
        self.put(5)
        total, records = self.store.history_page(self.owner)
        self.assertEqual(total, 1)
        total, records = self.store.history_page(self.owner, include_hidden_downloads=True)
        self.assertEqual(total, 2)
        self.assertEqual({record['id'] for record in records}, {f'{1:032x}', f'{5:032x}'})
        self.store.patch(self.owner, 'job', f'{1:032x}', fileExpires=0)
        self.assertEqual(self.store.history_page(self.owner, include_hidden_downloads=True)[0], 1)

    def test_history_cap_hides_oldest_terminal_records_without_deleting_files_or_active_jobs(self):
        self.put(1, state='queued')
        self.put(2)
        self.put(3)
        self.put(4)
        self.put(5, owner=self.other)
        self.assertEqual(self.store.trim_history(self.owner, limit=2), 2)
        self.assertEqual(self.store.count(self.owner, visible=True), 2)
        self.assertEqual(self.store.get(self.owner, 'job', f'{1:032x}')['state'], 'queued')
        self.assertTrue(self.store.get(self.owner, 'job', f'{2:032x}')['hidden'])
        self.assertTrue(self.store.get(self.owner, 'job', f'{2:032x}')['downloadAvailable'])
        self.assertEqual(self.store.count(self.other, visible=True), 1)

    def test_reference_index_is_owner_scoped_and_tracks_replacement_patch_and_delete(self):
        upload = 'c' * 32
        first = self.put(1, inputs=[{'id': upload}])
        self.put(1, owner=self.other, inputs=[{'id': upload}])
        self.assertTrue(self.store.upload_referenced(self.owner, upload, now=0))
        self.assertFalse(self.store.upload_referenced(self.owner, upload, exclude_job=first['id']))
        self.store.patch(self.owner, 'job', first['id'], inputs=[])
        self.assertFalse(self.store.upload_referenced(self.owner, upload))
        self.assertTrue(self.store.upload_referenced(self.other, upload))
        self.put(1, inputs=[{'id': upload}], state='failed', fileExpires=0)
        self.assertTrue(self.store.upload_referenced(self.owner, upload))
        self.assertFalse(self.store.upload_referenced(self.owner, upload, now=1))
        self.store.delete(self.owner, first['id'])
        self.assertFalse(self.store.upload_referenced(self.owner, upload))

    def test_existing_metadata_migrates_references_without_losing_records(self):
        legacy_root = Path(self.temp.name) / 'legacy'
        legacy_root.mkdir()
        record = {'id': 'e' * 32, 'created': 1, 'state': 'queued', 'inputs': [{'id': 'f' * 32}]}
        with sqlite3.connect(legacy_root / 'metadata.sqlite3') as db:
            db.execute('CREATE TABLE records (id TEXT PRIMARY KEY,owner TEXT,kind TEXT,created REAL,data TEXT)')
            db.execute('INSERT INTO records VALUES (?,?,?,?,?)', (record['id'], self.owner, 'job', 1, json.dumps(record)))
        db.close()
        migrated = Store(legacy_root)
        self.assertEqual(migrated.get(self.owner, 'job', record['id']), record)
        self.assertTrue(migrated.upload_referenced(self.owner, 'f' * 32))
        self.assertEqual(Store(legacy_root).count(), 1)

    def test_record_iteration_does_not_repeat_rows_during_updates(self):
        for index in range(7): self.put(index)
        seen = []
        for owner, record in self.store.iter_records(batch=2):
            seen.append(record['id'])
            self.store.patch(owner, 'job', record['id'], hidden=True)
        self.assertEqual(len(set(seen)), 7)
        self.assertEqual(len(seen), 7)

    def test_batched_expiry_makes_progress_without_rescanning_cleaned_history(self):
        service = Service(Path(self.temp.name) / 'service', limits=LIMITS)
        try:
            for index in range(101):
                service.store.put(self.owner, 'job', {'id': f'{index:032x}', 'created': index,
                    'state': 'completed', 'inputs': [], 'fileExpires': 0,
                    'historyExpires': None, 'downloadAvailable': True, 'outputFile': 'output.zip'})
            self.assertTrue(service.cleanup())
            self.assertEqual(len(service.store.expired_jobs(time.time())), 1)
            self.assertFalse(service.cleanup())
            self.assertEqual(service.store.expired_jobs(time.time()), [])
            self.assertEqual(service.store.count(self.owner), 101)
        finally:
            service.close()


class DeletionPreviewRoutes(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = Service(self.temp.name, limits=LIMITS)
        self.server = LocalHTTPServer(('127.0.0.1', 0), handler(self.service))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}/api/process'
        self.client = build_opener(HTTPCookieProcessor(CookieJar()))

    def tearDown(self):
        self.service.close(); self.server.shutdown(); self.server.server_close()
        self.thread.join(3); self.temp.cleanup()

    def call(self, path, value=None, method='GET', headers=None, client=None, raw=False):
        body = value if raw else json.dumps(value).encode() if value is not None else None
        request = Request(self.base + path, data=body, method=method,
                          headers={'X-Hamma-Request': '1', **({'Content-Type': 'application/json'} if value is not None and not raw else {}), **(headers or {})})
        with (client or self.client).open(request, timeout=15) as response:
            payload = response.read()
            return payload if raw else json.loads(payload)

    def job(self, completed=False):
        data = b'deletion fixture'
        upload = self.call('/uploads', {'name': 'fixture.txt', 'size': len(data)}, 'POST')
        self.call('/uploads/' + upload['id'], data, 'PUT', {'Upload-Offset': '0'}, raw=True)
        job = self.call('/jobs', {'uploads': [upload['id']], 'operation': 'compress', 'target': 'zip'}, 'POST')
        if completed:
            owner = next(owner for owner, record in self.service.store.list() if record['id'] == job['id'])
            run_job(self.temp.name, owner, job['id'], LIMITS)
        return self.call('/jobs/' + job['id'])

    def assert_status(self, status, operation):
        with self.assertRaises(HTTPError) as caught: operation()
        self.assertEqual(caught.exception.code, status, caught.exception.read())

    def test_preview_counts_target_owner_and_history_is_distinct_from_file_deletion(self):
        completed = self.job(completed=True)
        active = self.job()
        self.call('/uploads', {'name': 'empty-folder', 'size': 0, 'directory': True}, 'POST')
        before = self.call('/deletion-preview')
        self.assertEqual({key: before[key] for key in ('historyRecords', 'inputFiles', 'outputFiles', 'activeJobs')},
                         {'historyRecords': 1, 'inputFiles': 3, 'outputFiles': 1, 'activeJobs': 1})
        other = build_opener(HTTPCookieProcessor(CookieJar()))
        theirs = self.call('/deletion-preview', client=other)
        self.assertEqual(theirs['inputFiles'], 0)
        self.assertNotEqual(theirs['historyToken'], before['historyToken'])
        self.call('/history', method='DELETE', headers={'X-Hamma-Deletion-Token': before['historyToken']})
        after = self.call('/deletion-preview')
        self.assertEqual(after['historyRecords'], 0)
        self.assertEqual(after['filesToken'], before['filesToken'])
        self.assertTrue(self.call('/jobs/' + completed['id'])['downloadAvailable'])
        self.assertEqual(self.call('/jobs/' + active['id'])['state'], 'queued')
        self.assertEqual(self.call('/jobs')['total'], 1)
        retained = self.call('/jobs?includeHiddenDownloads=1')
        self.assertEqual(retained['total'], 2)
        self.assertTrue(next(job for job in retained['jobs'] if job['id'] == completed['id'])['hidden'])
        self.assert_status(409, lambda: self.call('/history', method='DELETE', headers={'X-Hamma-Deletion-Token': before['historyToken']}))

    def test_changed_file_selection_rejects_before_any_mutation_and_valid_token_cancels_jobs(self):
        completed = self.job(completed=True)
        active = self.job()
        stale = self.call('/deletion-preview')
        self.call('/uploads', {'name': 'new-file', 'size': 0}, 'POST')
        self.assert_status(409, lambda: self.call('/files', method='DELETE', headers={'X-Hamma-Deletion-Token': stale['filesToken']}))
        self.assertTrue(self.call('/jobs/' + completed['id'])['downloadAvailable'])
        current = self.call('/deletion-preview')
        self.call('/files', method='DELETE', headers={'X-Hamma-Deletion-Token': current['filesToken']})
        after = self.call('/deletion-preview')
        self.assertEqual(after['inputFiles'], 0)
        self.assertEqual(after['outputFiles'], 0)
        self.assertEqual(after['activeJobs'], 0)
        self.assertFalse(self.call('/jobs/' + completed['id'])['downloadAvailable'])
        self.assertEqual(self.call('/jobs/' + active['id'])['state'], 'cancelled')

    def test_global_zero_byte_upload_and_queue_caps_cannot_be_bypassed_with_fresh_sessions(self):
        self.service.max_uploads = 2
        self.call('/uploads', {'name': 'one', 'size': 0}, 'POST')
        second = build_opener(HTTPCookieProcessor(CookieJar()))
        self.call('/uploads', {'name': 'two', 'size': 0}, 'POST', client=second)
        third = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assert_status(429, lambda: self.call('/uploads', {'name': 'three', 'size': 0}, 'POST', client=third))
        self.service.max_uploads = 100
        self.service.max_queued_jobs = 1
        self.job()
        uploaded = self.call('/uploads', {'name': 'other-empty', 'size': 0}, 'POST', client=third)
        self.assert_status(429, lambda: self.call('/jobs', {'uploads': [uploaded['id']], 'operation': 'compress', 'target': 'zip'}, 'POST', client=third))


def benchmark(path, optimized=False):
    with tempfile.TemporaryDirectory() as root:
        store = Store(root)
        owner = 'a' * 64
        rows = []
        for index in range(10000):
            record = {'id': f'{index:032x}', 'created': index, 'name': f'file-{index}.txt',
                      'state': 'completed', 'inputs': [], 'inputSize': 1024, 'outputSize': 512,
                      'downloadAvailable': True, 'outputFile': 'output.zip', 'fileExpires': 2e10,
                      'historyExpires': 2e10, 'hidden': False}
            rows.append((record['id'], owner, 'job', index, json.dumps(record)))
        with store.connect() as db:
            db.executemany('INSERT INTO records(id,owner,kind,created,data) VALUES (?,?,?,?,?)', rows)
        timings, peaks = [], []
        for _ in range(5):
            tracemalloc.start()
            started = time.perf_counter()
            if optimized:
                total, jobs = store.history_page(owner, offset=5000, limit=50, summary=True)
            else:
                jobs = [record for _, record in store.list(owner) if not record.get('hidden')]
                total = len(jobs)
                jobs = jobs[5000:5050]
            timings.append(time.perf_counter() - started)
            peaks.append(tracemalloc.get_traced_memory()[1])
            tracemalloc.stop()
            assert total == 10000 and len(jobs) == 50 and jobs[0]['created'] == 4999
        result = {'mode': 'sql-page' if optimized else 'legacy-full-list', 'records': 10000,
                  'pageOffset': 5000, 'pageSize': 50, 'seconds': timings,
                  'medianSeconds': statistics.median(timings), 'peakPythonBytes': max(peaks),
                  'scope': 'Synthetic retained-history query; includes SQLite connection and JSON decoding; no throughput guarantee'}
        Path(path).write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--benchmark':
        benchmark(sys.argv[2], optimized='--optimized' in sys.argv)
    else:
        unittest.main()
