import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

from processor.indexing import DirectoryIndex, IndexQuotaError


class DurableDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'inputs'
        self.root.mkdir()
        self.database = self.base / 'index.sqlite3'

    def index(self, quota=100, batch=2):
        return DirectoryIndex(self.database, self.root, max_entries=quota, batch_size=batch)

    def test_interruption_reopen_stable_ids_and_streamed_manifest(self):
        (self.root / 'nested').mkdir()
        for number in range(12):
            (self.root / 'nested' / f'{number}.txt').write_bytes(b'payload')
        index = self.index()
        calls = 0

        def cancelled():
            nonlocal calls
            calls += 1
            return calls >= 9

        self.assertFalse(index.discover(cancelled=cancelled))
        before = {row['path']: row['id'] for row in index.page()}
        reopened = self.index()
        self.assertTrue(reopened.discover())
        rows = reopened.page()
        self.assertEqual(len(rows), 13)
        self.assertEqual(len({row['path'] for row in rows}), 13)
        self.assertTrue(all(row['id'] == before[row['path']] for row in rows if row['path'] in before))
        out = io.StringIO()
        reopened.manifest(out)
        self.assertEqual([json.loads(line) for line in out.getvalue().splitlines()], rows)
        self.assertTrue(reopened.discover())
        self.assertEqual(reopened.page(), rows)

    def test_quota_failure_rolls_back_batch_and_can_resume_with_larger_quota(self):
        for number in range(5):
            (self.root / str(number)).write_bytes(b'data')
        index = self.index(quota=3)
        with self.assertRaises(IndexQuotaError):
            index.discover()
        self.assertEqual(len(index.page()), 2)
        reopened = self.index(quota=5)
        self.assertTrue(reopened.discover())
        self.assertEqual(len(reopened.page()), 5)
        with reopened.connect() as db:
            self.assertEqual(db.execute("SELECT value FROM metadata WHERE key='entry_count'").fetchone()[0], '5')

    def test_large_offsets_and_keyset_pages(self):
        index = self.index()
        # Metadata only: this does not read or process a multi-terabyte payload.
        index._commit([('huge.bin', 'file', 5 * 1024**4, 1, None), ('second', 'file', 1, 2, None)])
        first = index.page(limit=1)
        self.assertEqual(first[0]['size'], 5 * 1024**4)
        self.assertEqual(index.page(after=first[0]['id'], limit=1)[0]['path'], 'second')
        self.assertEqual(index.page(after=2**63 - 1), [])
        with self.assertRaises(ValueError):
            index.page(after=2**64)

    def test_links_are_not_followed_and_wrong_root_is_rejected(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'secret').write_text('private')
        link = self.root / 'link'
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError as error:
            if sys.platform != 'win32' or error.winerror != 1314:
                raise
            # A junction exercises the Windows reparse-point path without
            # requiring the account privilege to create a symbolic link.
            subprocess.run([
                'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                'New-Item -ItemType Junction -Path $env:SHANTE_TEST_LINK '
                '-Target $env:SHANTE_TEST_TARGET -ErrorAction Stop | Out-Null',
            ], env={**os.environ, 'SHANTE_TEST_LINK': str(link), 'SHANTE_TEST_TARGET': str(outside)},
                check=True, capture_output=True, timeout=20)
        index = self.index()
        self.assertTrue(index.discover())
        self.assertEqual([(row['path'], row['kind']) for row in index.page()], [('link', 'link')])
        with self.assertRaises(ValueError):
            DirectoryIndex(self.database, outside, max_entries=100)

    def test_rejects_database_in_source_tree(self):
        with self.assertRaises(ValueError):
            DirectoryIndex(self.root / 'index.sqlite3', self.root, max_entries=100)

    def test_actual_process_exit_after_commit_replays_without_duplicates(self):
        for number in range(7):
            (self.root / str(number)).write_bytes(b'payload')
        code = '''
import os, sys
from processor.indexing import DirectoryIndex
index = DirectoryIndex(sys.argv[1], sys.argv[2], max_entries=20, batch_size=2)
commit = index._commit
def crash(rows):
    commit(rows)
    os._exit(17)
index._commit = crash
index.discover()
'''
        child = subprocess.run([sys.executable, '-c', code, str(self.database), str(self.root)], timeout=20)
        self.assertEqual(child.returncode, 17)
        index = self.index()
        self.assertEqual(len(index.page()), 2)
        self.assertTrue(index.discover())
        self.assertEqual(index.summary(), {'entries': 7, 'errors': 0, 'pendingDirectories': 0})

    def test_directory_failure_is_durable_and_not_silently_omitted(self):
        from unittest.mock import patch
        index = self.index()
        with patch('processor.indexing.os.scandir', side_effect=PermissionError('denied')):
            self.assertTrue(index.discover())
        self.assertEqual(index.summary(), {'entries': 1, 'errors': 1, 'pendingDirectories': 0})
        self.assertIn('denied', index.page()[0]['error'])

    def test_compare_cli_reports_additions_deletions_and_metadata_changes(self):
        nested = self.root / 'nested'
        nested.mkdir()
        (nested / 'keep.txt').write_bytes(b'same')
        (nested / 'remove.txt').write_bytes(b'gone')
        edited = self.root / 'edit.txt'
        edited.write_bytes(b'old')
        old_mtime = edited.stat().st_mtime_ns
        (self.root / 'kind').write_bytes(b'file')
        self.assertTrue(self.index().discover())

        (nested / 'remove.txt').unlink()
        (nested / 'new.txt').write_bytes(b'new')
        edited.write_bytes(b'new')
        os.utime(edited, ns=(old_mtime, old_mtime + 2_000_000_000))
        (self.root / 'kind').unlink()
        (self.root / 'kind').mkdir()
        current = self.base / 'new scan #1.sqlite3'
        command = [
            sys.executable, '-m', 'processor.indexing', str(self.root),
            '--database', str(current), '--max-entries', '100',
            '--compare-to', str(self.database),
        ]
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=20)
        rows = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([(row['path'], row['change']) for row in rows], [
            ('edit.txt', 'changed'), ('kind', 'changed'),
            ('nested/new.txt', 'added'), ('nested/remove.txt', 'removed'),
        ])
        self.assertEqual(rows[0]['before']['size'], rows[0]['after']['size'])
        self.assertNotEqual(rows[0]['before']['mtime_ns'], rows[0]['after']['mtime_ns'])
        self.assertEqual((rows[1]['before']['kind'], rows[1]['after']['kind']), ('file', 'directory'))
        self.assertIsNone(rows[2]['before'])
        self.assertIsNone(rows[3]['after'])
        self.assertEqual(json.loads(result.stderr)['changes'], {'added': 1, 'removed': 1, 'changed': 2})
        repeated = subprocess.run(command, check=True, capture_output=True, text=True, timeout=20)
        self.assertEqual(repeated.stdout, result.stdout)
        self.assertIn('nested/remove.txt', {row['path'] for row in self.index().page()})

    def test_compare_refuses_invalid_or_incomplete_scans_before_writing(self):
        baseline = self.index()
        current = DirectoryIndex(self.base / 'current.sqlite3', self.root, max_entries=10)
        stream = io.StringIO()
        with self.assertRaisesRegex(ValueError, 'different database'):
            baseline.changes(self.database, stream)
        self.assertTrue(baseline.discover())
        with self.assertRaisesRegex(ValueError, 'must be complete'):
            current.changes(self.database, stream)
        from unittest.mock import patch
        with patch('processor.indexing.os.scandir', side_effect=PermissionError('denied')):
            self.assertTrue(current.discover())
        with self.assertRaisesRegex(ValueError, 'discovery errors'):
            current.changes(self.database, stream)
        other = self.base / 'other'
        other.mkdir()
        wrong = DirectoryIndex(self.base / 'wrong.sqlite3', other, max_entries=10)
        self.assertTrue(wrong.discover())
        with self.assertRaisesRegex(ValueError, 'same root'):
            wrong.changes(self.database, stream)
        self.assertEqual(stream.getvalue(), '')

    def test_compare_unchanged_scans_with_escaped_baseline_filename(self):
        (self.root / 'keep.txt').write_bytes(b'same')
        baseline_path = self.base / 'baseline #1.sqlite3'
        baseline = DirectoryIndex(baseline_path, self.root, max_entries=10)
        self.assertTrue(baseline.discover())
        current = self.index()
        self.assertTrue(current.discover())
        stream = io.StringIO()
        self.assertEqual(current.changes(baseline_path, stream), {'added': 0, 'removed': 0, 'changed': 0})
        self.assertEqual(stream.getvalue(), '')
