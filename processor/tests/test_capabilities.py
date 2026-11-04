import unittest
from unittest.mock import patch
from processor.capabilities import action_registry

class RegistryTests(unittest.TestCase):
    def test_missing_engines_hide_media_and_native_extraction(self):
        with patch('processor.capabilities.shutil.which', return_value=None), patch('processor.native.capability', return_value=None):
            rows = action_registry()
        self.assertTrue(all(not row['conversions'] for row in rows))
        self.assertFalse(any('zstd' in row['extensions'] for row in rows))
        self.assertTrue(next(row for row in rows if 'zip' in row['extensions'])['extract'])

    def test_images_never_receive_audio_targets(self):
        with patch('processor.capabilities.shutil.which', return_value='engine'), patch('processor.native.capability', return_value={'version': 1}):
            rows = action_registry()
        image = next(row for row in rows if 'png' in row['extensions'])
        self.assertEqual(image['conversions'], ['png', 'webp', 'jpg'])
        self.assertTrue(next(row for row in rows if 'zstd' in row['extensions'])['extract'])


    def test_signature_inspection_is_bounded_and_ignores_names(self):
        from processor.capabilities import inspect_headers
        with patch('processor.capabilities.shutil.which', return_value='engine'):
            result = inspect_headers([{'head': b'\x89PNG\r\n\x1a\n'.hex(), 'name': 'fake.wav'}])[0]
        self.assertEqual(result['format'], 'png')
        self.assertNotIn('wav', result['conversions'])
        for entries in ([], [{}], [{'head': 'zz'}], [{'head': '00' * 513}], [{'head': ''}] * 33):
            with self.assertRaises(ValueError):
                inspect_headers(entries)


    def test_heic_and_animated_avif_do_not_receive_video_actions(self):
        from processor.capabilities import inspect_headers
        for brand, expected in [(b'heic', 'heic'), (b'avis', 'avif-sequence')]:
            row = inspect_headers([{'head': (b'\x00\x00\x00\x18ftyp' + brand).hex()}])[0]
            self.assertEqual(row['format'], expected)
            self.assertEqual(row['conversions'], [])
            self.assertFalse(row['extract'])
