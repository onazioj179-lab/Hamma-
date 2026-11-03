import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest
import wave
import zipfile

from processor.engine import Context, ProcessingError, compress, convert, detect, extract, safe_path


LIMITS = {"expanded": 32 * 1024**2, "files": 5000, "ratio": 1000, "depth": 3, "seconds": 60, "input": 64 * 1024**2, "storage": 256 * 1024**2}


class EngineFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = ("Hello 世界 🌍\n" * 100).encode()
        self.source = self.root / "input"
        self.source.write_bytes(self.data)

    def tearDown(self):
        self.temp.cleanup()

    def context(self, **limits):
        return Context(self.root, {**LIMITS, **limits})


class EngineTests(EngineFixture):
    def test_standard_compression_roundtrips_with_unicode_and_empty_directories(self):
        for target in ("zip", "tar", "tar.gz", "tar.bz2", "tar.xz"):
            with self.subTest(target=target):
                output = self.root / ("result." + target)
                records = compress([{"name": "folder/世界.txt", "path": str(self.source)}, {"name": "folder/empty/", "directory": True}], output, target, self.context())
                self.assertEqual(records[0]["sha256"], hashlib.sha256(self.data).hexdigest())
                restored = self.root / "restored.zip"
                extract(output, output.name, restored, self.context())
                with zipfile.ZipFile(restored) as archive:
                    self.assertEqual(archive.read("folder/世界.txt"), self.data)
                    self.assertIn("folder/empty/", archive.namelist())

    def test_single_stream_roundtrips_and_rejects_multiple_inputs(self):
        for target, suffix in (("gzip", "gz"), ("bzip2", "bz2"), ("xz", "xz")):
            with self.subTest(target=target):
                output = self.root / ("result." + suffix)
                compress([{"name": "input.txt", "path": str(self.source)}], output, target, self.context())
                self.assertEqual(detect(output), target)
                restored = self.root / "restored.zip"
                extract(output, output.name, restored, self.context())
                with zipfile.ZipFile(restored) as archive:
                    self.assertEqual(archive.read("result"), self.data)
                with self.assertRaises(ProcessingError):
                    compress([{"name": "a", "path": str(self.source)}, {"name": "b", "path": str(self.source)}], output, target, self.context())

    def test_magic_detection_ignores_extension(self):
        fake = self.root / "video.mp4"
        with zipfile.ZipFile(fake, "w") as archive:
            archive.writestr("text", self.data)
        self.assertEqual(detect(fake), "zip")

    def test_unsafe_names_are_rejected(self):
        for name in ("../escape", "/etc/passwd", "C:/a", "a/../b", "a\\..\\b", "a//b", "a\x00b", "a:stream", "CON", "dir/nul.txt", "file. ", "file\nname"):
            with self.subTest(name=name), self.assertRaises(ProcessingError):
                safe_path(name)

    def test_zip_traversal_links_case_collisions_and_parent_conflicts(self):
        for names, symlink in ((["../escape"], False), (["link"], True), (["A.txt", "a.txt"], False), (["a", "a/b"], False)):
            with self.subTest(names=names):
                source = self.root / "unsafe.zip"
                with zipfile.ZipFile(source, "w") as archive:
                    for name in names:
                        info = zipfile.ZipInfo(name)
                        if symlink:
                            info.create_system = 3
                            info.external_attr = (stat.S_IFLNK | 0o777) << 16
                        archive.writestr(info, b"outside")
                with self.assertRaises(ProcessingError):
                    extract(source, source.name, self.root / "out.zip", self.context())
                self.assertFalse((self.root.parent / "escape").exists())

    def test_tar_links_and_devices_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE):
            source = self.root / "unsafe.tar"
            with tarfile.open(source, "w") as archive:
                info = tarfile.TarInfo("link")
                info.type, info.linkname = kind, "../outside"
                archive.addfile(info)
            with self.assertRaises(ProcessingError):
                extract(source, source.name, self.root / "out.zip", self.context())

    def test_cumulative_size_count_and_recursion_budgets(self):
        source = self.root / "large.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("first", b"1" * 100)
            archive.writestr("second", b"2" * 100)
        with self.assertRaisesRegex(ProcessingError, "(Expanded|Output) size"):
            extract(source, source.name, self.root / "out.zip", self.context(expanded=150))
        with self.assertRaisesRegex(ProcessingError, "Too many"):
            extract(source, source.name, self.root / "out.zip", self.context(files=1))
        with self.assertRaisesRegex(ProcessingError, "nesting"):
            extract(self.nested(), "nested.zip", self.root / "out.zip", self.context(depth=0), recursive=True)

    def nested(self):
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, "w") as archive:
            archive.writestr("text.txt", self.data)
        source = self.root / "nested.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("inner.zip", inner.getvalue())
        return source

    def test_recursive_archives_keep_originals_and_verify_nested_contents(self):
        output = self.root / "out.zip"
        records = extract(self.nested(), "nested.zip", output, self.context(), recursive=True)
        self.assertEqual(len(records), 2)
        with zipfile.ZipFile(output) as archive:
            self.assertIn("inner.zip", archive.namelist())
            self.assertEqual(archive.read("inner.zip.contents/text.txt"), self.data)

    def test_compressed_stream_budget_and_corruption(self):
        source = self.root / "data.gz"
        source.write_bytes(gzip.compress(b"X" * 4096))
        with self.assertRaisesRegex(ProcessingError, "Expanded size"):
            extract(source, "data.gz", self.root / "out.zip", self.context(expanded=1024))
        source.write_bytes(source.read_bytes()[:-5])
        with self.assertRaises((EOFError, OSError)):
            extract(source, "data.gz", self.root / "out.zip", self.context())

    def test_corrupt_zip_crc_fails_instead_of_returning_success(self):
        source = self.root / "corrupt.zip"
        with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("hello", b"sentinel")
        data = source.read_bytes().replace(b"sentinel", b"broken!!", 1)
        source.write_bytes(data)
        with self.assertRaises(zipfile.BadZipFile):
            extract(source, source.name, self.root / "out.zip", self.context())

    def test_cancel_stops_streaming(self):
        (self.root / "cancel").touch()
        with self.assertRaisesRegex(ProcessingError, "Cancelled"):
            compress([{"name": "text", "path": str(self.source)}], self.root / "out.zip", "zip", self.context())

    def test_tar_extended_header_allocation_is_bounded(self):
        source = self.root / "metadata.tar"
        info = tarfile.TarInfo("pax")
        info.type = tarfile.XHDTYPE
        info.size = 2 * 1024**2
        source.write_bytes(info.tobuf(format=tarfile.USTAR_FORMAT))
        with self.assertRaisesRegex(ProcessingError, "metadata"):
            extract(source, source.name, self.root / "out.zip", self.context())

    def test_zip_directory_allocation_and_output_writes_are_bounded(self):
        import struct
        source = self.root / "count.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("text", self.data)
        content = bytearray(source.read_bytes())
        index = content.rfind(b"PK\x05\x06")
        struct.pack_into("<HH", content, index + 8, 6000, 6000)
        source.write_bytes(content)
        with self.assertRaisesRegex(ProcessingError, "Too many"):
            extract(source, source.name, self.root / "out.zip", self.context())
        with self.assertRaisesRegex(ProcessingError, "Output size"):
            compress([{"name": "a", "path": str(self.source)}], self.root / "small.zip", "zip", self.context(expanded=40))


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg not installed")
class MediaTests(EngineFixture):
    def wav(self):
        source = self.root / "source.wav"
        with wave.open(str(source), "wb") as audio:
            audio.setnchannels(2)
            audio.setsampwidth(2)
            audio.setframerate(48000)
            audio.writeframes(b"\x01\x00\x02\x00" * 4800)
        return source

    def test_real_wav_and_flac_conversion_preserves_pcm(self):
        source = self.wav()
        for target in ("wav", "flac", "mp3", "aac", "m4a", "ogg"):
            with self.subTest(target=target):
                output = self.root / ("output." + target)
                manifest = convert(source, output, target, self.context(), quality_mode='lossless' if target in ('wav', 'flac') else 'lossy')
                self.assertTrue(manifest[0]["size"] > 0)
                if target in ("wav", "flac"):
                    decoded = subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-i", str(output), "-f", "s16le", "-"], capture_output=True, check=True).stdout
                    with wave.open(str(source), "rb") as audio:
                        self.assertEqual(decoded, audio.readframes(audio.getnframes()))

    def test_all_video_audio_tracks_are_extracted(self):
        source = self.root / "two-tracks.mkv"
        subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=400:duration=0.2", "-f", "lavfi", "-i", "sine=frequency=800:duration=0.2", "-map", "0:a", "-map", "1:a", "-c:a", "pcm_s16le", str(source)], check=True, capture_output=True)
        output = self.root / "output.wav"
        manifest = convert(source, output, "wav", self.context())
        self.assertEqual(len(manifest), 2)
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.namelist(), ["audio-1.wav", "audio-2.wav"])
            for name in archive.namelist():
                with wave.open(io.BytesIO(archive.read(name))) as audio:
                    self.assertEqual(audio.getframerate(), 44100)
                    self.assertEqual(audio.getnchannels(), 1)

    def test_still_image_conversion_and_missing_audio_error(self):
        source = self.root / "source.png"
        subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=32x32", "-frames:v", "1", str(source)], check=True, capture_output=True)
        for target in ("webp", "png", "jpg"):
            with self.subTest(target=target):
                output = self.root / ("out." + target)
                convert(source, output, target, self.context(), quality_mode='lossy' if target == 'jpg' else 'lossless')
                self.assertEqual(detect(output), target)
        with self.assertRaisesRegex(ProcessingError, "No audio"):
            convert(source, self.root / "out.wav", "wav", self.context())

    def test_animated_images_are_rejected_without_dropping_frames(self):
        source = self.root / "animated.gif"
        subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=5:d=0.4", str(source)], check=True, capture_output=True)
        with self.assertRaisesRegex(ProcessingError, "still image"):
            convert(source, self.root / "out.png", "png", self.context())


if __name__ == "__main__":
    unittest.main()
