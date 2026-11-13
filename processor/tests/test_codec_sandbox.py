from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from processor.codec_sandbox import check_codec_isolation, codec_command
from processor.worker_limits import WorkerIsolationError


@unittest.skipUnless(sys.platform == 'linux', 'Requires Linux Landlock')
class CodecSandboxTests(unittest.TestCase):
    def test_codec_can_read_its_input_and_write_only_within_its_job(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assigned = root / 'uploads' / 'assigned.bin'
            unrelated = root / 'uploads' / 'unrelated.bin'
            assigned.parent.mkdir()
            assigned.write_bytes(b'job input')
            unrelated.write_bytes(b'unrelated upload')
            job = root / 'job'
            job.mkdir()
            program = """
assigned=$1
unrelated=$2
output=$3
read -r content < "$assigned"
[ "$content" = 'job input' ] || exit 1
if (: < "$unrelated") || (: > "$assigned") || (: > "${unrelated}.new"); then
    exit 2
fi
printf '%s' "$content" > "$output"
"""
            output = job / 'output'
            command = ['/bin/sh', '-c', program, 'sandbox-test', assigned, unrelated, output]
            result = subprocess.run(codec_command(command, assigned, job), capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_bytes(), assigned.read_bytes())
            self.assertEqual(unrelated.read_bytes(), b'unrelated upload')

    def test_setup_failure_stops_codec_and_has_specific_error(self):
        with tempfile.TemporaryDirectory() as folder:
            missing = Path(folder) / 'missing'
            command = [sys.executable, '-I', '-c', "print('Codec started')"]
            result = subprocess.run(codec_command(command, missing), capture_output=True, timeout=10)
            self.assertEqual(result.stdout, b'')
            with self.assertRaisesRegex(WorkerIsolationError, 'sandbox setup failed'):
                check_codec_isolation(result.returncode)
