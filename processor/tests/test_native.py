import hashlib
import json
import os
from pathlib import Path
import random
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from processor import native
from processor.engine import Context, ProcessingError, archive_formats, compress, extract, verify_archive
from test_engine import LIMITS


class NativeIntegration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'input'
        self.data = 'Native 世界 bytes\n'.encode() * 1000
        self.source.write_bytes(self.data)

    def tearDown(self):
        self.temp.cleanup()

    def context(self, **limits):
        return Context(self.root, {**LIMITS, **limits})

    def test_missing_binary_preserves_existing_formats_and_reports_unavailability(self):
        with patch.dict(os.environ, {'SHANTE_CORE_BINARY': str(self.root / 'missing')}):
            self.assertNotIn('zstd', archive_formats())
            self.assertNotIn('tar.zst', archive_formats())
            output = self.root / 'fallback.zip'
            compress([{'name': 'file.txt', 'path': str(self.source)}], output, 'zip', self.context())
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.read('file.txt'), self.data)
            with self.assertRaisesRegex(ProcessingError, 'unavailable'):
                native.run('compress', self.source, self.root / 'missing.zst', self.context())

    def require_native(self):
        if not native.capability():
            self.skipTest('Build native/shante-core or configure SHANTE_CORE_BINARY')

    def test_compress_and_extract_through_existing_engine_with_sha256(self):
        self.require_native()
        packed, restored = self.root / 'output.zstd', self.root / 'restored.zip'
        manifest = compress([{'name': 'nested/世界.txt', 'path': str(self.source)}], packed, 'zstd', self.context())
        self.assertEqual(manifest[0]['sha256'], hashlib.sha256(self.data).hexdigest())
        result = extract(packed, 'original.txt.zstd', restored, self.context())
        with zipfile.ZipFile(restored) as archive:
            self.assertEqual(archive.read('original.txt'), self.data)
        self.assertEqual(result[0]['sha256'], manifest[0]['sha256'])
        self.assertFalse((self.root / 'native-verify').exists())

    def test_nested_zstandard_keeps_original_and_restores_contents(self):
        self.require_native()
        packed = self.root / 'child.zst'
        compress([{'name': 'input', 'path': str(self.source)}], packed, 'zstd', self.context())
        outer = self.root / 'outer.zip'
        with zipfile.ZipFile(outer, 'w') as archive:
            archive.write(packed, 'child.txt.zst')
        output = self.root / 'nested.zip'
        extract(outer, 'outer.zip', output, self.context(), recursive=True)
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.read('child.txt.zst'), packed.read_bytes())
            self.assertEqual(archive.read('child.txt.zst.contents/child.txt'), self.data)

    def test_zstandard_tar_round_trips_through_tar_and_native_verification(self):
        self.require_native()
        self.assertIn('tar.zst', archive_formats())
        packed = self.root / 'bundle.tar.zst'
        random_file = self.root / 'random'
        random_bytes = random.Random(23).randbytes(32 * 1024)
        random_file.write_bytes(random_bytes)
        manifest = compress([
            {'name': 'nested/世界.txt', 'path': str(self.source)},
            {'name': 'random.bin', 'path': str(random_file)},
            {'name': 'empty/', 'directory': True},
        ], packed, 'tar.zst', self.context())
        self.assertEqual(manifest[0]['sha256'], hashlib.sha256(self.data).hexdigest())

        decoded = self.root / 'independent.tar'
        native.run('decompress', packed, decoded, self.context())
        with tarfile.open(decoded) as archive:
            self.assertEqual(archive.getnames(), ['nested/世界.txt', 'random.bin', 'empty'])
            self.assertEqual(archive.extractfile('random.bin').read(), random_bytes)

        output = self.root / 'restored.zip'
        extract(packed, 'bundle.tzst', output, self.context())
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.namelist(), ['nested/世界.txt', 'random.bin', 'empty/'])
            self.assertEqual(archive.read('nested/世界.txt'), self.data)
            self.assertEqual(archive.read('random.bin'), random_bytes)
        report = self.root / 'report.json'
        verify_archive(packed, 'bundle.tar.zstd', report, self.context())
        self.assertEqual(json.loads(report.read_bytes())['format'], 'tar.zst')
        outer = self.root / 'outer.zip'
        with zipfile.ZipFile(outer, 'w') as archive:
            archive.write(packed, 'child.tar.zst')
        nested = self.root / 'nested.zip'
        extract(outer, outer.name, nested, self.context(), recursive=True)
        with zipfile.ZipFile(nested) as archive:
            self.assertEqual(archive.read('child.tar.zst'), packed.read_bytes())
            self.assertEqual(archive.read('child.tar.zst.contents/random.bin'), random_bytes)
        self.assertFalse(list(self.root.glob('tar-zstd-*')))

    def test_named_zstandard_tar_rejects_non_tar_and_respects_expansion_limit(self):
        self.require_native()
        packed = self.root / 'payload.zst'
        native.run('compress', self.source, packed, self.context())
        with self.assertRaisesRegex(ProcessingError, 'not a TAR'):
            verify_archive(packed, 'renamed.tar.zst', self.root / 'report.json', self.context())

        archive = self.root / 'empty.tar.zst'
        compress([{'name': 'folder/', 'directory': True}], archive, 'tar.zst', self.context())
        with self.assertRaises(ProcessingError):
            verify_archive(archive, archive.name, self.root / 'report.json', self.context(expanded=4096))
        verify_archive(archive, archive.name, self.root / 'report.json', self.context())
        self.assertFalse(list(self.root.glob('tar-zstd-*')))
        rejected = self.root / 'rejected.tar.zst'
        with self.assertRaisesRegex(ProcessingError, 'expansion ratio'):
            compress([{'name': 'folder/', 'directory': True}], rejected, 'tar.zst', self.context(ratio=2))
        self.assertFalse(rejected.exists())

    def test_native_expansion_budget_and_cancellation(self):
        self.require_native()
        packed = self.root / 'packed.zst'
        compress([{'name': 'input', 'path': str(self.source)}], packed, 'zstd', self.context())
        with self.assertRaises(ProcessingError):
            extract(packed, 'bomb.zst', self.root / 'limited.zip', self.context(expanded=100))
        (self.root / 'cancel').touch()
        with self.assertRaisesRegex(ProcessingError, 'Cancelled'):
            native.run('compress', self.source, self.root / 'cancelled.zst', self.context())
        self.assertFalse((self.root / 'cancelled.zst').exists())
        self.assertFalse(list(self.root.glob('*.part-*')))
