"""Launch Linux codecs with access to their input, runtime, and job output."""

import os
from pathlib import Path
import sys


ISOLATION_FAILURE = 125


def codec_command(command, source, output_dir=None):
    if sys.platform != 'linux':
        return command
    executable, *arguments = command
    return [sys.executable, '-I', str(Path(__file__).resolve()),
            str(Path(source).resolve()), str(Path(output_dir).resolve()) if output_dir else '',
            str(Path(executable).resolve()), *arguments]


def check_codec_isolation(status):
    if sys.platform == 'linux' and status == ISOLATION_FAILURE:
        from .worker_limits import WorkerIsolationError

        raise WorkerIsolationError(
            'Codec sandbox setup failed. Check for Linux Landlock ABI 3 support.',
            public_message='Linux codec filesystem isolation is unavailable',
        )
    return status


def restrict_filesystem(executable, source, output_dir):
    import ctypes

    class Ruleset(ctypes.Structure):
        _fields_ = [('handled_access_fs', ctypes.c_uint64)]

    class PathRule(ctypes.Structure):
        _pack_ = 1
        _fields_ = [('allowed_access', ctypes.c_uint64), ('parent_fd', ctypes.c_int32)]

    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    seccomp = ctypes.CDLL('libseccomp.so.2')
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int

    def system_call(name, *arguments):
        number = seccomp.seccomp_syscall_resolve_name(name)
        if number < 0:
            raise RuntimeError(f'{name.decode()} is unavailable')
        result = libc.syscall(ctypes.c_long(number), *arguments)
        if result < 0:
            code = ctypes.get_errno()
            raise OSError(code, f'{name.decode()}: {os.strerror(code)}')
        return result

    create = b'landlock_create_ruleset'
    if system_call(create, ctypes.c_void_p(), ctypes.c_size_t(0), ctypes.c_uint(1)) < 3:
        raise RuntimeError('Landlock ABI 3 or newer is required')

    execute, write_file, read_file, read_dir = (1 << bit for bit in range(4))
    remove_dir, remove_file = 1 << 4, 1 << 5
    make_dir, make_file = 1 << 7, 1 << 8
    refer, truncate = 1 << 13, 1 << 14
    attributes = Ruleset((1 << 15) - 1)  # All filesystem rights through ABI 3.
    ruleset = system_call(create, ctypes.byref(attributes), ctypes.sizeof(attributes), ctypes.c_uint(0))
    try:
        def permit(path, access):
            fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                rule = PathRule(access, fd)
                system_call(b'landlock_add_rule', ctypes.c_int(ruleset), ctypes.c_int(1),
                            ctypes.byref(rule), ctypes.c_uint(0))
            finally:
                os.close(fd)

        permit(executable, execute | read_file)
        permit(source, read_file)
        # The dynamic linker and shared objects are host runtime files.
        for path in ('/lib', '/lib64', '/usr/lib', '/usr/lib64', '/usr/local/lib'):
            if os.path.isdir(path):
                permit(path, execute | read_file | read_dir)
        for path in ('/etc/ld.so.cache', '/dev/urandom'):
            if os.path.exists(path):
                permit(path, read_file)
        if Path(executable).name == 'pdftoppm':
            for path in ('/etc/fonts', '/usr/share/fontconfig', '/usr/share/fonts'):
                if os.path.isdir(path):
                    permit(path, read_file | read_dir)
        permit('/dev/null', read_file | write_file)
        if output_dir:
            permit(output_dir, read_file | read_dir | write_file | truncate |
                   remove_dir | remove_file | make_dir | make_file | refer)
        if libc.prctl(38, 1, 0, 0, 0):  # PR_SET_NO_NEW_PRIVS
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code))
        system_call(b'landlock_restrict_self', ctypes.c_int(ruleset), ctypes.c_uint(0))
    finally:
        os.close(ruleset)


if __name__ == '__main__':
    source, output_dir, executable, *arguments = sys.argv[1:]
    try:
        restrict_filesystem(executable, source, output_dir)
        environment = {'LANG': 'C.UTF-8', 'PATH': os.defpath}
        if output_dir:
            environment['TMPDIR'] = output_dir
        os.execve(executable, [executable, *arguments], environment)
    except (OSError, RuntimeError) as error:
        print(f'Codec sandbox: {error}', file=sys.stderr)
        sys.exit(ISOLATION_FAILURE)
