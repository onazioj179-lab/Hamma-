import errno
import unittest
import zipfile
from processor.engine import ProcessingError
from processor.errors import describe_failure


class FailureDescriptions(unittest.TestCase):
    def test_categories_and_retry_eligibility(self):
        cases = [(MemoryError(), 'memory_limit', True),
                 (PermissionError('/private/name'), 'permission_denied', False),
                 (OSError(errno.ENOSPC, '/private/name'), 'insufficient_storage', True),
                 (zipfile.BadZipFile('/private/name'), 'corrupt_file', False),
                 (ProcessingError('Unsupported archive'), 'unsupported_format', False),
                 (ProcessingError('Processing time limit reached'), 'processing_timeout', True),
                 (ProcessingError('Unsafe filename'), 'invalid_input', False),
                 (ProcessingError('Storage full'), 'insufficient_storage', True),
                 (ProcessingError('Discovery entry quota reached'), 'resource_limit', False),
                 (ProcessingError('Expanded size limit reached'), 'resource_limit', False)]
        for error, category, retry in cases:
            with self.subTest(category=category):
                message, actual, eligible = describe_failure(error)
                self.assertEqual((actual, eligible), (category, retry))
                self.assertNotIn('/private', message)

    def test_unknown_exception_does_not_expose_details(self):
        self.assertEqual(describe_failure(RuntimeError('private contents')), ('Processing failed', 'conversion_failure', True))
