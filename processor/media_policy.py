"""Explicit conversion policy shared by HTTP validation and the media engine."""
AUDIO_TARGETS = ('wav', 'flac', 'mp3', 'aac', 'm4a', 'ogg', 'opus')
H264_TARGET = 'mp4-h264'
LOSSY_TARGETS = frozenset(('mp3', 'aac', 'm4a', 'ogg', 'opus', 'jpg', H264_TARGET))


def validate_conversion_options(target, quality_mode='lossless', metadata_policy='strip'):
    if quality_mode not in ('lossless', 'lossy') or metadata_policy not in ('strip', 'preserve'):
        raise ValueError('Invalid conversion quality or metadata policy')
    if target in LOSSY_TARGETS and quality_mode != 'lossy':
        raise ValueError('This format can reduce quality. Choose lossy conversion explicitly.')
