"""Operating system limits for processing workers and their codec children."""
import errno
import sys


class WorkerIsolationError(RuntimeError):
    """The operating system did not install the required worker filter."""

    def __init__(self, message, *, public_message='Linux worker network isolation is unavailable'):
        super().__init__(message)
        self.public_message = public_message


def restrict_worker_sockets():
    """Disable Linux worker socket creation and socket server/client setup."""
    import ctypes

    try:
        seccomp = ctypes.CDLL('libseccomp.so.2')
    except OSError as error:
        raise WorkerIsolationError('Install libseccomp2 to run Linux processing jobs') from error

    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    seccomp.seccomp_rule_add.restype = ctypes.c_int
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_load.restype = ctypes.c_int
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.restype = None

    allow = 0x7FFF0000  # SCMP_ACT_ALLOW
    deny = 0x00050000 | errno.EPERM  # SCMP_ACT_ERRNO(EPERM)
    policy = seccomp.seccomp_init(allow)
    if not policy:
        raise WorkerIsolationError('Could not initialize Linux worker network isolation')
    try:
        # Workers use files and pipes. Deny socket acquisition and io_uring
        # submission setup, which can issue socket operations without socket().
        for name in (b'socket', b'socketpair', b'connect', b'bind', b'listen',
                     b'accept', b'accept4', b'io_uring_setup', b'pidfd_getfd'):
            syscall = seccomp.seccomp_syscall_resolve_name(name)
            if syscall == -1 or seccomp.seccomp_rule_add(policy, deny, syscall, 0):
                raise WorkerIsolationError('Could not configure Linux worker network isolation')
        # libseccomp enables no_new_privs when loading the filter. The worker
        # is single threaded here and subsequently created codec children inherit it.
        if seccomp.seccomp_load(policy):
            raise WorkerIsolationError('Could not enforce Linux worker network isolation')
    finally:
        seccomp.seccomp_release(policy)


def apply_windows_worker_limits(memory=2 * 1024**3):
    """Limit committed memory across this Windows worker and its descendants."""
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
            ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
            ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
            ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
            ("scheduling", wintypes.DWORD),
        ]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("basic", BasicLimits), ("io_counters", ctypes.c_ulonglong * 6),
            ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
            ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL

    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    options = ExtendedLimits()
    job_memory_limit = 0x00000200
    kill_on_job_close = 0x00002000
    extended_limit_information = 9
    options.basic.flags = job_memory_limit | kill_on_job_close
    options.job_memory = memory
    if not (
        kernel.SetInformationJobObject(job, extended_limit_information, ctypes.byref(options), ctypes.sizeof(options))
        and kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess())
    ):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise ctypes.WinError(error)
    # The worker owns this non-inheritable handle until exit. The OS closes it
    # and terminates any surviving members of the job, including child codecs.


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
