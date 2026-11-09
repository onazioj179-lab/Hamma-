import subprocess
import sys
import unittest
from unittest.mock import Mock
from processor.worker_limits import apply_worker_limits


class WorkerLimitTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'win32', 'Requires Windows Job Objects')
    def test_windows_job_caps_child_memory_and_reaps_surviving_children(self):
        program = """
import subprocess
import sys
from processor.worker_limits import apply_windows_worker_limits

apply_windows_worker_limits(128 * 1024**2)
child = subprocess.run([sys.executable, '-c', '''
try:
    bytearray(256 * 1024**2)
except MemoryError:
    raise SystemExit(0)
raise SystemExit(1)
'''], check=True)
# Inherit stdout so the outer process cannot finish reading until this child
# exits. It is still sleeping when the owning worker exits.
subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
print('worker complete')
"""
        result = subprocess.run([sys.executable, '-c', program], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('worker complete', result.stdout)

    def resource(self, hard=-1):
        resource = Mock(RLIM_INFINITY=-1, RLIMIT_AS=1, RLIMIT_CPU=2, RLIMIT_FSIZE=3)
        resource.getrlimit.return_value = (hard, hard)
        return resource

    def test_linux_keeps_address_space_cpu_and_file_caps(self):
        resource = self.resource()
        apply_worker_limits({'expanded': 1024, 'seconds': 30}, resource_module=resource, platform='linux')
        resource.setrlimit.assert_any_call(1, (2 * 1024**3, 2 * 1024**3))
        resource.setrlimit.assert_any_call(2, (30, 30))
        resource.setrlimit.assert_any_call(3, (1024 + 64 * 1024**2,) * 2)

    def test_inherited_limits_are_never_raised(self):
        resource = self.resource(hard=10)
        apply_worker_limits({'expanded': 1024, 'seconds': 30}, resource_module=resource, platform='linux')
        for call in resource.setrlimit.call_args_list:
            self.assertEqual(call.args[1], (10, 10))

    def test_macos_retains_supported_caps_without_invalid_address_space_request(self):
        resource = self.resource()
        apply_worker_limits({'expanded': 1024, 'seconds': 30}, resource_module=resource, platform='darwin')
        self.assertEqual({call.args[0] for call in resource.setrlimit.call_args_list}, {2, 3})
