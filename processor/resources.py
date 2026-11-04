"""Conservative admission control; never treats memory estimates as OS enforcement."""
import os
from pathlib import Path
import sys

MIB = 1024 ** 2


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
                    return int(line.split()[1]) * 1024
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
