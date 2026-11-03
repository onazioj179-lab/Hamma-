import unittest
from processor.ranges import download_range


class RangeTests(unittest.TestCase):
    def test_normal_and_suffix_ranges(self):
        for header, expected in [("bytes=2-20", (2, 20)), ("bytes=5-", (5, 99)), ("bytes=-8", (92, 99)), ("bytes=90-200", (90, 99)), ("bytes=-200", (0, 99))]:
            with self.subTest(header=header):
                self.assertEqual(download_range(header, 100), expected)

    def test_large_offsets_preserve_integer_precision(self):
        size = 2**54 + 31
        self.assertEqual(download_range(f"bytes={size-3}-", size), (size-3, size-1))

    def test_malformed_and_unsatisfiable_ranges(self):
        for header in ["bytes=-0", "bytes=-", "bytes=100-", "bytes=20-2", "bytes=0-1,4-5", "bytes=" + "9" * 10000 + "-"]:
            with self.subTest(header=header):
                self.assertRaises(ValueError, download_range, header, 100)
        self.assertRaises(ValueError, download_range, "bytes=0-", 0)
