import json
import shutil
import subprocess
import unittest

from processor.engine import ProcessingError, convert, decoded_digest, probe, detect
from processor.media_policy import validate_conversion_options
from test_engine import EngineFixture


class ConversionPolicyTests(unittest.TestCase):
    def test_lossy_encoders_require_explicit_permission(self):
        for target in ('mp3', 'aac', 'm4a', 'ogg', 'opus', 'jpg'):
            with self.subTest(target=target):
                with self.assertRaisesRegex(ValueError, 'explicitly'):
                    validate_conversion_options(target)
                validate_conversion_options(target, 'lossy', 'strip')
        for quality, metadata in [('invalid', 'strip'), ('lossless', 'invalid'), (None, 'strip'), ('lossy', False)]:
            with self.assertRaises(ValueError):
                validate_conversion_options('png', quality, metadata)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg not installed')
class MediaQualityTests(EngineFixture):
    def ffmpeg(self, *args):
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', *args], capture_output=True, check=True)

    def test_webp_lossless_preserves_pixels_and_png_dimensions(self):
        source = self.root / 'pattern.png'
        self.ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=37x29:duration=0.1', '-frames:v', '1', str(source))
        output = self.root / 'lossless.webp'
        convert(source, output, 'webp', self.context())
        original = decoded_digest(source, self.context(), stream='0:v:0', encoding='rgba', container='rawvideo')
        restored = decoded_digest(output, self.context(), stream='0:v:0', encoding='rgba', container='rawvideo')
        self.assertEqual(original, restored)
        self.assertEqual(probe(output)['streams'][0]['width'], 37)

    def test_jpeg_rejects_implicit_loss_and_transparency(self):
        source = self.root / 'alpha.png'
        self.ffmpeg('-f', 'lavfi', '-i', 'color=c=blue@0.5:s=16x16,format=rgba', '-frames:v', '1', str(source))
        with self.assertRaisesRegex(ProcessingError, 'explicitly'):
            convert(source, self.root / 'implicit.jpg', 'jpg', self.context())
        with self.assertRaisesRegex(ProcessingError, 'transparency'):
            convert(source, self.root / 'flattened.jpg', 'jpg', self.context(), quality_mode='lossy')
        self.assertFalse((self.root / 'flattened.jpg').exists())

    def test_float_audio_is_not_silently_quantized_to_flac(self):
        source = self.root / 'floating.wav'
        self.ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=500:duration=0.1', '-c:a', 'pcm_f32le', str(source))
        with self.assertRaisesRegex(ProcessingError, 'precision'):
            convert(source, self.root / 'quantized.flac', 'flac', self.context())
        convert(source, self.root / 'retained.wav', 'wav', self.context())

    def test_audio_metadata_policy_is_explicit_and_opus_is_real(self):
        source = self.root / 'tagged.wav'
        self.ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-metadata', 'title=Private test title', str(source))
        stripped, retained = self.root / 'stripped.flac', self.root / 'retained.flac'
        convert(source, stripped, 'flac', self.context())
        convert(source, retained, 'flac', self.context(), metadata_policy='preserve')
        self.assertNotIn('Private test title', json.dumps(probe(stripped)))
        self.assertIn('Private test title', json.dumps(probe(retained)))
        output = self.root / 'actual.opus'
        convert(source, output, 'opus', self.context(), quality_mode='lossy')
        self.assertEqual(probe(output)['streams'][0]['codec_name'], 'opus')

    def test_decoded_verification_has_an_expansion_limit(self):
        source = self.root / 'source.png'
        self.ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', str(source))
        with self.assertRaisesRegex(ProcessingError, 'verification limit'):
            decoded_digest(source, self.context(expanded=100), stream='0:v:0', encoding='rgba64le', container='rawvideo')


    def test_avif_still_image_decodes_and_preserves_pixels_in_png(self):
        source = self.root / 'image-with-wrong-extension.bin'
        self.ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=48x32:duration=0.1', '-frames:v', '1', '-threads', '1', '-f', 'avif', str(source))
        self.assertEqual(detect(source), 'avif')
        output = self.root / 'decoded.png'
        convert(source, output, 'png', self.context())
        self.assertEqual(decoded_digest(source, self.context(), stream='0:v:0', encoding='rgba', container='rawvideo'),
                         decoded_digest(output, self.context(), stream='0:v:0', encoding='rgba', container='rawvideo'))

    def test_single_frame_video_is_not_accepted_as_a_still_image(self):
        source = self.root / 'video.mp4'
        self.ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=48x32:duration=0.1', '-frames:v', '1', '-pix_fmt', 'yuv420p', str(source))
        with self.assertRaisesRegex(ProcessingError, 'still image'):
            convert(source, self.root / 'invalid.png', 'png', self.context())
