"""Optional versioned SHANTE subprocess adapter; never loads native code into HTTP handlers."""
from functools import lru_cache
import json
import os
from pathlib import Path
import subprocess
import threading
import time

from .codec_sandbox import check_codec_isolation, codec_command


def binary():
    configured = os.environ.get('SHANTE_CORE_BINARY')
    return Path(configured).resolve() if configured else Path(__file__).resolve().parents[1] / 'native' / 'build' / ('shante-core.exe' if os.name == 'nt' else 'shante-core')


@lru_cache(maxsize=4)
def _probe(path, modified, size):
    try:
        result = subprocess.run([path, 'probe'], capture_output=True, timeout=5,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode or len(result.stdout) > 4096:
            return None
        info = json.loads(result.stdout)
        if not isinstance(info, dict):
            return None
        if info.get('protocol') != 1 or info.get('engine') != 'shante-core' or info.get('codec') != 'zstd':
            return None
        if type(info.get('workers')) is not int or not 0 <= info['workers'] <= 2:
            return None
        if type(info.get('availableMemory')) is not int or info['availableMemory'] < 0:
            return None
        return info
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def capability():
    try:
        path = binary()
        stat = path.stat()
        return _probe(str(path), stat.st_mtime_ns, stat.st_size)
    except OSError:
        return None


def run(operation, source, output, context, *, input_limit=None, output_limit=None, progress=True):
    from .engine import ProcessingError
    info = capability()
    if not info:
        raise ProcessingError('SHANTE native Zstandard engine is unavailable')
    if output.exists() or output.is_symlink():
        raise ProcessingError('Output already exists')
    maximum = context.limits['expanded'] if output_limit is None else output_limit
    input_limit = context.limits['input'] if input_limit is None else input_limit
    memory = 128 * 1024**2
    if info.get('availableMemory', 0):
        memory = max(16 * 1024**2, min(memory, info['availableMemory'] // 8))
    command = [str(binary()), operation, str(source), str(output), str(input_limit),
               str(maximum), str(memory), str(info['workers']), str(context.root / 'cancel')]
    state = {}
    base = context.bytes
    process = subprocess.Popen(codec_command(command, source, context.root), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               cwd=context.root, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)

    def read_events():
        try:
            while line := process.stdout.readline(4097):
                if len(line) > 4096:
                    raise ValueError('Oversized native event')
                event = json.loads(line)
                if not isinstance(event, dict) or event.get('event') not in ('progress', 'result', 'error'):
                    raise ValueError('Invalid native event')
                state[event['event']] = event
        except (ValueError, OSError):
            state['invalid'] = True

    reader = threading.Thread(target=read_events, daemon=True)
    reader.start()
    reported = None
    try:
        while process.poll() is None:
            context.check()
            if state.get('invalid'):
                raise ProcessingError('Invalid native engine response')
            event = state.get('progress')
            if event is not None and event != reported:
                if type(event.get('inputBytes')) is not int or not 0 <= event['inputBytes'] <= input_limit:
                    raise ProcessingError('Invalid native progress')
                if progress:
                    context.bytes = base + event['inputBytes']
                    context.report(processed=context.bytes, entries=context.count)
                if event.get('verifying'):
                    context.report(state='verifying')
                reported = event
            time.sleep(.05)
        reader.join(2)
        context.check()
        result = state.get('result', {})
        if check_codec_isolation(process.returncode) or state.get('invalid') or result.get('verified') is not True:
            code = state.get('error', {}).get('code')
            raise ProcessingError({'cancelled': 'Cancelled', 'limit': 'Native resource limit reached',
                                   'integrity': 'Corrupted archive', 'codec': 'Corrupted archive or native memory limit reached',
                                   'memory': 'Native memory limit reached'}.get(code, 'Native processing failed'))
        if (type(result.get('inputBytes')) is not int or not 0 <= result['inputBytes'] <= input_limit or
            type(result.get('outputBytes')) is not int or result['outputBytes'] != output.stat().st_size or result['outputBytes'] > maximum):
            raise ProcessingError('Native output verification failed')
        if progress:
            context.bytes = base + result['inputBytes']
            context.report(processed=context.bytes, entries=context.count)
        return result
    finally:
        if process.poll() is None:
            # The private sentinel lets C++ unwind RAII state before forced cleanup.
            try:
                process.wait(timeout=.5)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=3)
        reader.join(2)
        process.stdout.close()
        # Hard termination cannot unwind C++ destructors. This output belongs to
        # one private job; remove only its unpublished native temporary files.
        for partial in output.parent.glob(output.name + '.part-*'):
            partial.unlink(missing_ok=True)
