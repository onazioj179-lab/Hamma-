"""Conservative selection hints; worker probing remains authoritative."""
import shutil


def action_registry():
    media = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))
    from .native import capability
    native = bool(capability())
    return [
        {'mime': ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'], 'extensions': ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'],
         'conversions': ['png', 'webp', 'jpg'] if media else [], 'extract': False},
        {'mime': ['audio/wav', 'audio/x-wav', 'audio/flac', 'audio/mpeg', 'audio/ogg'],
         'extensions': ['wav', 'flac', 'mp3', 'ogg', 'opus', 'm4a', 'aac'],
         'conversions': ['wav', 'flac', 'mp3', 'aac', 'm4a', 'ogg', 'opus'] if media else [], 'extract': False},
        {'mime': ['video/mp4', 'video/webm', 'video/x-matroska'], 'extensions': ['mp4', 'webm', 'mkv'],
         'conversions': ['mp4', 'mkv', 'webm'] if media else [], 'extract': False},
        {'mime': ['application/zip', 'application/gzip', 'application/x-tar', 'application/x-xz', 'application/x-bzip2'],
         'extensions': ['zip', 'gz', 'tar', 'xz', 'bz2'], 'conversions': [], 'extract': True},
        *([{'mime': ['application/zstd'], 'extensions': ['zst', 'zstd'], 'conversions': [], 'extract': True}] if native else []),
    ]


def inspect_headers(entries):
    """Bounded signature hints, never codec validation or a completion claim."""
    from .engine import detect_header
    if not isinstance(entries, list) or not 1 <= len(entries) <= 32:
        raise ValueError('Inspect between 1 and 32 entries')
    registry = action_registry()
    result = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('head'), str) or len(entry['head']) > 1024:
            raise ValueError('Invalid inspection header')
        try:
            head = bytes.fromhex(entry['head'])
        except ValueError:
            raise ValueError('Invalid inspection header') from None
        detected = detect_header(head)
        extension = {'gzip': 'gz', 'bzip2': 'bz2'}.get(detected, detected)
        row = next((row for row in registry if extension in row['extensions']), None)
        result.append({'format': detected, 'conversions': row['conversions'] if row else [],
                       'extract': bool(row and row['extract'])})
    return result


def single_file_archives():
    from .engine import archive_formats
    return [name for name in archive_formats() if name in ('gzip', 'bzip2', 'xz', 'zstd')]
