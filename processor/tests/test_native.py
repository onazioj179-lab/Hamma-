import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from processor import native
from processor.engine import Context, ProcessingError, archive_formats, compress, extract
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
