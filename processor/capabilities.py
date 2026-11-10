"""Conservative selection hints; worker probing remains authoritative."""
from functools import lru_cache
import os
from pathlib import Path
import re
import shutil
import subprocess

from .media_policy import AUDIO_TARGETS, H264_TARGET


MEDIA_OUTPUTS = {
    'wav': ('wav', ('pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_s64le', 'pcm_f32le', 'pcm_f64le')),
    'flac': ('flac', ('flac',)),
    'mp3': ('mp3', ('libmp3lame',)),
    'aac': ('adts', ('aac',)),
    'm4a': ('ipod', ('aac',)),
    'ogg': ('ogg', ('libvorbis',)),
    'opus': ('opus', ('libopus',)),
    'mp4': ('mp4', ()),
    'mkv': ('matroska', ()),
    'webm': ('webm', ()),
    H264_TARGET: ('mp4', ('libx264', 'aac', 'mov_text')),
    'png': ('image2', ('png',)),
    'webp': ('webp', ('libwebp',)),
    'jpg': ('image2', ('mjpeg',)),
}


@lru_cache(maxsize=4)
def _media_targets(binary, modified, size):
    def listing(option):
        return subprocess.run([binary, '-hide_banner', option], check=True, capture_output=True,
                              encoding='utf-8', errors='replace', timeout=5,
                              creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0).stdout

    encoders = set(re.findall(r'^\s*[VAS][A-Z.]{5}[ \t]+([\w-]+)', listing('-encoders'), re.MULTILINE))
    muxers = {muxer for group in re.findall(r'^\s*(?:D)?\s*E[ \t]+([\w,-]+)', listing('-muxers'), re.MULTILINE)
              for muxer in group.split(',')}
    return tuple(target for target, (muxer, codecs) in MEDIA_OUTPUTS.items()
                 if muxer in muxers and encoders.issuperset(codecs))


def media_targets():
    binary = shutil.which('ffmpeg')
    if not binary or not shutil.which('ffprobe'):
        return ()
    try:
        path = Path(binary).resolve()
        info = path.stat()
        return _media_targets(str(path), info.st_mtime_ns, info.st_size)
    except (OSError, subprocess.SubprocessError):
        return ()


def action_registry():
    media = set(media_targets())
    def supported(*targets):
        return [target for target in targets if target in media]
    from .native import capability
    native = bool(capability())
    return [
        {'mime': ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'], 'extensions': ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'],
         'conversions': supported('png', 'webp', 'jpg'), 'extract': False},
        {'mime': ['audio/wav', 'audio/x-wav', 'audio/flac', 'audio/mpeg', 'audio/ogg'],
         'extensions': ['wav', 'flac', 'mp3', 'ogg', 'opus', 'm4a', 'aac'],
         'conversions': supported(*AUDIO_TARGETS), 'extract': False},
        {'mime': ['video/mp4', 'video/webm', 'video/x-matroska'], 'extensions': ['mp4', 'webm', 'mkv'],
         'conversions': supported('mp4', 'mkv', 'webm', H264_TARGET, *AUDIO_TARGETS), 'extract': False},
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
