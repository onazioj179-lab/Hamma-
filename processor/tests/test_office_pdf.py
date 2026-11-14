import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from processor.engine import ProcessingError
from processor.office_pdf import enforce_work_limit


class OfficeWorkLimitTests(unittest.TestCase):
    def test_disappearing_profile_directory_preserves_storage_enforcement(self):
        with TemporaryDirectory() as directory:
            scratch = Path(directory)
            profile = scratch / 'profile'
            profile.mkdir()
            real_scandir = os.scandir

            def scandir(path):
                if Path(path) == profile:
                    profile.rmdir()
                return real_scandir(path)

            ctx = SimpleNamespace(limits={'storage': 1})
            with patch('processor.office_pdf.os.scandir', side_effect=scandir):
                enforce_work_limit(scratch, ctx)
            self.assertFalse(profile.exists())
            (scratch / 'document.pdf').write_bytes(b'pdf')
            with self.assertRaisesRegex(ProcessingError, 'working storage limit'):
                enforce_work_limit(scratch, ctx)
