"""POSIX worker limits, respecting inherited caps and platform enforcement support."""
import sys


def apply_worker_limits(limits, *, resource_module=None, platform=None):
    if resource_module is None:
        import resource as resource_module
    if platform is None:
        platform = sys.platform

    def bounded(kind, requested):
        _, inherited_hard = resource_module.getrlimit(kind)
        maximum = requested if inherited_hard == resource_module.RLIM_INFINITY else min(requested, inherited_hard)
        resource_module.setrlimit(kind, (maximum, maximum))

    bounded(resource_module.RLIMIT_FSIZE, limits['expanded'] + 64 * 1024**2)
    bounded(resource_module.RLIMIT_CPU, limits['seconds'])
    # Darwin does not provide a usable RLIMIT_AS for these spawned workers and
    # rejects this setting with EINVAL. Keep byte/window/codec allocator caps and
    # CPU/file limits; do not pretend they are a whole-process RSS limit.
    if platform != 'darwin':
        bounded(resource_module.RLIMIT_AS, 2 * 1024**3)
