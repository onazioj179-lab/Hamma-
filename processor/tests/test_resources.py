import unittest
from unittest.mock import patch
from processor.resources import MIB, available_memory, worker_capacity


class ResourceAdmissionTests(unittest.TestCase):
    def test_memory_pressure_and_recovery(self):
        self.assertEqual(worker_capacity(512 * MIB, 8), 0)
        self.assertEqual(worker_capacity(1280 * MIB, 8), 1)
        self.assertEqual(worker_capacity(2048 * MIB, 8), 2)
        self.assertEqual(worker_capacity(1280 * MIB, 8), 1)

    def test_unknown_memory_cpu_limit_and_hard_bound(self):
        self.assertEqual(worker_capacity(None, 16), 1)
        self.assertEqual(worker_capacity(64 * 1024 * MIB, 1), 1)
        self.assertEqual(worker_capacity(64 * 1024 * MIB, 64), 2)
        self.assertEqual(worker_capacity(-1, 4), 0)

    def test_linux_retains_container_headroom_without_host_meminfo(self):
        with (
            patch('processor.resources.sys.platform', 'linux'),
            patch('processor.resources.cgroup_available', return_value=0),
            patch('processor.resources.Path.read_text', side_effect=OSError),
        ):
            self.assertEqual(available_memory(), 0)
            self.assertEqual(worker_capacity(available_memory()), 0)

    def test_platform_probe_is_optional_nonnegative_measurement(self):
        measured = available_memory()
        self.assertTrue(measured is None or measured >= 0)
