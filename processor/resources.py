"""Conservative admission control; never treats memory estimates as OS enforcement."""
import os
import re
from pathlib import Path, PurePosixPath
import sys

MIB = 1024 ** 2


def configured_limits(environ=None):
    environ = os.environ if environ is None else environ
    defaults = {'input': 8 * 1024**3, 'expanded': 2 * 1024**3, 'files': 5000,
                'ratio': 1000, 'depth': 8, 'seconds': 1800, 'storage': 20 * 1024**3}
    names = {'input': 'SHANTE_MAX_INPUT_BYTES', 'expanded': 'SHANTE_MAX_OUTPUT_BYTES',
             'files': 'SHANTE_MAX_FILES', 'ratio': 'SHANTE_MAX_EXPANSION_RATIO',
             'depth': 'SHANTE_MAX_ARCHIVE_DEPTH', 'seconds': 'SHANTE_MAX_JOB_SECONDS',
             'storage': 'SHANTE_MAX_STORAGE_BYTES'}
    for key, name in names.items():
        value = environ.get(name)
        if value is None:
            continue
        if not isinstance(value, str) or not value.isascii() or not value.isdecimal() or len(value) > 19:
            raise ValueError(f'{name} must be a positive integer')
        number = int(value)
        if not 1 <= number <= 2**63 - 1 - 64 * MIB:
            raise ValueError(f'{name} is outside the resource policy range')
        defaults[key] = number
    return defaults


def _memory_mounts(mountinfo):
    try:
        lines = mountinfo.read_text().splitlines()
    except OSError:
        return
    for line in lines:
        before, separator, after = line.partition(' - ')
        fields, filesystem = before.split(), after.split()
        if not separator or len(fields) < 5 or len(filesystem) < 3:
            continue
        kind = filesystem[0]
        if kind == 'cgroup2' or (kind == 'cgroup' and 'memory' in filesystem[2].split(',')):
            mount_root, mount_path = (
                re.sub(r'\\([0-7]{3})', lambda match: chr(int(match[1], 8)), value)
                for value in fields[3:5]
            )
            yield kind, PurePosixPath(mount_root), Path(mount_path)


def cgroup_available(root=Path('/sys/fs/cgroup'), membership=Path('/proc/self/cgroup'),
                     mountinfo=None):
    """Return the tightest readable memory headroom across visible cgroup ancestors."""
    v2_names = ('memory.max', 'memory.current')
    v1_names = ('memory.limit_in_bytes', 'memory.usage_in_bytes')
    candidates = {(root, *v2_names), (root / 'memory', *v1_names)}
    if mountinfo is None:
        mountinfo = membership.with_name('mountinfo')
    mounts = list(_memory_mounts(mountinfo))
    try:
        lines = membership.read_text().splitlines()
    except OSError:
        lines = []
    for line in lines:
        fields = line.split(':', 2)
        if len(fields) != 3:
            continue
        _, controllers, relative = fields
        if controllers and 'memory' not in controllers.split(','):
            continue
        path = PurePosixPath(relative)
        if not path.is_absolute() or '..' in path.parts:
            continue
        names = v1_names if controllers else v2_names
        kind = 'cgroup' if controllers else 'cgroup2'
        standard = root / 'memory' if controllers else root
        for mount_kind, mount_root, directory in [*mounts, (kind, PurePosixPath('/'), standard)]:
            if mount_kind != kind or not path.is_relative_to(mount_root):
                continue
            parts = path.relative_to(mount_root).parts
            for depth in range(len(parts) + 1):
                candidates.add((directory.joinpath(*parts[:depth]), *names))
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
