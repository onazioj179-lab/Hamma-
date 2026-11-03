"""Conservative selection hints; worker probing remains authoritative."""
import shutil


def action_registry():
    media = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))
    from .native import capability
    native = bool(capability())
    return [
        {'mime': ['image/png', 'image/jpeg', 'image/webp', 'image/avif'], 'extensions': ['png', 'jpg', 'jpeg', 'webp', 'avif'],
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
