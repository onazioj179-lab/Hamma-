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
