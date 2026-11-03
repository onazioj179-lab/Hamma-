"""Real native contract tests, including adversarial inputs; no codec mocks."""
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest

BINARY = str(Path(sys.argv.pop(1)).resolve())


class NativeContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / '世界 input'
        self.output = self.root / 'output.zst'

    def tearDown(self):
        self.temp.cleanup()

    def run_codec(self, mode, source, output, *, input_limit=16 * 1024**2,
                  output_limit=16 * 1024**2, memory=128 * 1024**2, workers=0, success=True):
        process = subprocess.run([BINARY, mode, str(source), str(output), str(input_limit),
                                  str(output_limit), str(memory), str(workers), str(self.root / 'cancel')],
                                 capture_output=True, text=True, timeout=30)
        records = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertTrue(records, process.stderr)
        self.assertEqual(process.returncode, 0 if success else 2, records)
        self.assertEqual(records[-1]['event'], 'result' if success else 'error')
        if success:
            self.assertEqual(records[-1]['allocatorOutstanding'], 0)
        self.assertFalse(list(self.root.glob('*.part-*')), 'Partial output leaked')
        if not success:
            self.assertFalse(output.exists())
        return records[-1]

    def test_probe_and_signature(self):
        info = json.loads(subprocess.check_output([BINARY, 'probe']))
        self.assertEqual(info['protocol'], 1)
        self.assertFalse(info['gpuAcceleration'])
        self.assertIn(info['workers'], (0, 1, 2))
        self.source.write_bytes(b'PK\x03\x04ignored extension')
        detected = json.loads(subprocess.check_output([BINARY, 'inspect', str(self.source)]))
        self.assertEqual(detected['format'], 'zip')

    def test_streaming_roundtrips_empty_unicode_random_and_worker_modes(self):
        payloads = [b'', 'Hello 世界\n'.encode() * 10000, random.Random(7).randbytes(1048576), b'x' * (3 * 1024**2)]
        for index, payload in enumerate(payloads):
            for workers in (0, 2):
                with self.subTest(index=index, workers=workers):
                    self.source.write_bytes(payload)
                    packed = self.root / f'{index}-{workers}.zst'
                    result = self.run_codec('compress', self.source, packed, workers=workers)
                    self.assertTrue(result['verified'])
                    self.assertLessEqual(result['allocatorPeak'], 128 * 1024**2)
                    self.assertEqual(packed.read_bytes()[:4], b'\x28\xb5\x2f\xfd')
                    restored = self.root / f'{index}-{workers}.restored'
                    self.run_codec('decompress', packed, restored)
                    self.assertEqual(restored.read_bytes(), payload)

    def test_limits_memory_cancellation_and_no_output_overwrite(self):
        self.source.write_bytes(b'A' * 1024**2)
        for options in ({'input_limit': 1}, {'output_limit': 1}, {'memory': 1024**2}):
            with self.subTest(options=options):
                self.run_codec('compress', self.source, self.output, success=False, **options)
        (self.root / 'cancel').touch()
        self.run_codec('compress', self.source, self.output, success=False)
        (self.root / 'cancel').unlink()
        self.output.write_bytes(b'original must survive')
        result = subprocess.run([BINARY, 'compress', str(self.source), str(self.output),
                                 '2000000', '2000000', '134217728', '0', str(self.root / 'cancel')], capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.output.read_bytes(), b'original must survive')

    def test_corrupt_truncated_trailing_and_bomb_inputs_are_atomic(self):
        self.source.write_bytes(b'Z' * 1024**2)
        self.run_codec('compress', self.source, self.output)
        valid = self.output.read_bytes()
        for index, payload in enumerate((valid[:-1], valid + b'garbage', valid[:-1] + bytes([valid[-1] ^ 1]), b'')):
            self.source.write_bytes(payload)
            self.run_codec('decompress', self.source, self.root / f'bad-{index}', success=False)
        self.run_codec('decompress', self.output, self.root / 'bomb', output_limit=100, success=False)

    def test_deterministic_malformed_input_fuzz_corpus(self):
        generator = random.Random(42)
        for index in range(64):
            self.source.write_bytes(b'\x28\xb5\x2f\xfd' + generator.randbytes(index * 7))
            self.run_codec('decompress', self.source, self.root / f'fuzz-{index}', output_limit=1024**2, success=False)

    def test_symlink_input_is_rejected_when_platform_permits_creation(self):
        self.source.write_bytes(b'private')
        link = self.root / 'link'
        try:
            link.symlink_to(self.source)
        except OSError as error:
            self.skipTest(f'Symlink creation unavailable: {error}')
        self.run_codec('compress', link, self.output, success=False)

    def test_cancellation_during_streaming_removes_partial_output(self):
        self.source.write_bytes(b'0123456789abcdef' * (1024**2))
        process = subprocess.Popen([BINARY, 'compress', str(self.source), str(self.output),
                                    str(32 * 1024**2), str(32 * 1024**2), str(128 * 1024**2),
                                    '0', str(self.root / 'cancel')], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            first = json.loads(process.stdout.readline())
            self.assertEqual(first['event'], 'progress')
            (self.root / 'cancel').touch()
            stdout, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 2, (stdout, stderr))
            self.assertFalse(self.output.exists())
            self.assertFalse(list(self.root.glob('*.part-*')))
        finally:
            if process.poll() is None:
                process.kill(); process.communicate()


if __name__ == '__main__':
    unittest.main(verbosity=2)
