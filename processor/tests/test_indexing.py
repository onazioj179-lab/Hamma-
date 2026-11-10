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
