import unittest
from unittest.mock import Mock
from processor.worker_limits import apply_worker_limits


class WorkerLimitTests(unittest.TestCase):
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
