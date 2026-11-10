from pathlib import Path
import tempfile
import unittest

from processor.resources import cgroup_available, worker_capacity, MIB


class ContainerMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.membership = self.root / 'membership'

    def write(self, relative, limit, usage, v1=False):
        folder = self.root / relative
        folder.mkdir(parents=True, exist_ok=True)
        (folder / ('memory.limit_in_bytes' if v1 else 'memory.max')).write_text(str(limit))
        (folder / ('memory.usage_in_bytes' if v1 else 'memory.current')).write_text(str(usage))

    def test_parent_limit_applies_when_leaf_is_unlimited(self):
        self.membership.write_text('0::/jobs/worker\n')
        self.write('', 'max', 0)
        self.write('jobs', 2048 * MIB, 1024 * MIB)
        self.write('jobs/worker', 'max', 10 * MIB)
        available = cgroup_available(self.root, self.membership)
        self.assertEqual(available, 1024 * MIB)
        self.assertEqual(worker_capacity(available, 16), 0)

    def test_v1_memory_controller_and_pressure(self):
        self.membership.write_text('4:cpu:/other\n5:memory:/jobs\n')
        self.write('memory', 2**63 - 4096, 0, v1=True)
        self.write('memory/jobs', 1024, 2048, v1=True)
        self.assertEqual(cgroup_available(self.root, self.membership), 0)

    def test_absent_malformed_and_outside_membership_are_optional(self):
        self.assertIsNone(cgroup_available(self.root, self.membership))
        self.membership.write_text('malformed\n')
        self.assertIsNone(cgroup_available(self.root, self.membership))
        self.membership.write_text('0::/../../outside\n')
        self.write('', 'max', 0)
        self.assertIsNone(cgroup_available(self.root, self.membership))
