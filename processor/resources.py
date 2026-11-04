"""Conservative admission control; never treats memory estimates as OS enforcement."""
import os
from pathlib import Path
import sys

MIB = 1024 ** 2


def cgroup_available(root=Path('/sys/fs/cgroup'), membership=Path('/proc/self/cgroup')):
    """Remaining v1/v2 memory on standard Linux cgroup mounts, if readable.

    Check mounted root and each visible ancestor of our membership. A parent
    limit applies even when the leaf says ``max``. This is an admission hint;
    the kernel remains responsible for enforcing the container's memory limit.
    """
    candidates = {(root, 'memory.max', 'memory.current'),
                  (root / 'memory', 'memory.limit_in_bytes', 'memory.usage_in_bytes')}
    try:
        for line in membership.read_text().splitlines():
            _, controllers, relative = line.split(':', 2)
            if controllers and 'memory' not in controllers.split(','):
                continue
            parts = Path(relative.lstrip('/')).parts
            if '..' in parts:
                continue
            base = root / 'memory' if controllers else root
            names = ('memory.limit_in_bytes', 'memory.usage_in_bytes') if controllers else ('memory.max', 'memory.current')
            for depth in range(len(parts) + 1):
                candidates.add((base.joinpath(*parts[:depth]), *names))
    except (OSError, ValueError):
        pass
    remaining = []
    for directory, limit_name, usage_name in candidates:
        try:
            limit = int((directory / limit_name).read_text().strip())
            usage = int((directory / usage_name).read_text().strip())
            if 0 <= limit < 2**60 and usage >= 0:
                remaining.append(max(0, limit - usage))
        except (OSError, ValueError):
            pass
    return min(remaining) if remaining else None


def available_memory():
    try:
        if sys.platform == 'win32':
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
                    (name, ctypes.c_ulonglong) for name in
                    ('total', 'available', 'page_total', 'page_available', 'virtual_total', 'virtual_available', 'extended')]

            status = MemoryStatus()
            status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.available
        elif sys.platform.startswith('linux'):
            for line in Path('/proc/meminfo').read_text().splitlines():
                if line.startswith('MemAvailable:'):
                    host = int(line.split()[1]) * 1024
                    container = cgroup_available()
                    return min(host, container) if container is not None else host
    except (OSError, ValueError, AttributeError):
        pass
    return None


def worker_capacity(memory, cpu_count=None):
    """Keep a 512 MiB host reserve and budget 768 MiB per admitted worker.

    Unknown memory admits one worker; pressure blocks new admissions without
    terminating running work. The existing hard maximum remains two workers.
    """
    cpu_count = max(1, cpu_count or os.cpu_count() or 1)
    if memory is None:
        return 1
    return min(2, cpu_count, max(0, (memory - 512 * MIB) // (768 * MIB)))
