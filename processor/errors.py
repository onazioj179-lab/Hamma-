"""Public failure categories without exception details or private filesystem paths."""
import errno
import gzip
import lzma
import sqlite3
import tarfile
import zipfile

from .engine import ProcessingError


def describe_failure(error):
    message = str(error) if isinstance(error, ProcessingError) else 'Processing failed'
    category, retry = 'conversion_failure', True
    if isinstance(error, MemoryError):
        message, category = 'Memory limit reached', 'memory_limit'
    elif isinstance(error, PermissionError):
        message, category, retry = 'Missing permissions', 'permission_denied', False
    elif (isinstance(error, OSError) and error.errno == errno.ENOSPC or message == 'Storage full' or
          isinstance(error, sqlite3.OperationalError) and getattr(error, 'sqlite_errorcode', None) == sqlite3.SQLITE_FULL):
        message, category = 'Storage full', 'insufficient_storage'
    elif isinstance(error, (zipfile.BadZipFile, tarfile.TarError, gzip.BadGzipFile, lzma.LZMAError, EOFError)):
        message, category, retry = 'Corrupted archive', 'corrupt_file', False
    elif isinstance(error, TimeoutError) or message == 'Processing time limit reached':
        message, category = 'Processing time limit reached', 'processing_timeout'
    elif message.startswith('Unsupported') or message in ('No audio track', 'Choose a still image', 'Media engine unavailable'):
        category, retry = 'unsupported_format', False
    elif any(word in message.lower() for word in ('corrupt', 'truncated', 'integrity', 'incomplete', 'invalid archive')):
        category, retry = 'corrupt_file', False
    elif message.startswith('Unsafe') or message in ('Duplicate archive path', 'Conflicting archive paths'):
        category, retry = 'invalid_input', False
    elif any(word in message.lower() for word in ('limit reached', 'quota reached', 'too many')):
        category, retry = 'resource_limit', False
    return message, category, retry
