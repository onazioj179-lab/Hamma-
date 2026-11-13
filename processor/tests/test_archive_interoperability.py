"""Verify standard archives against libarchive rather than only HAMMA itself."""
import hashlib
import lzma
import os
import shutil
import subprocess
import zipfile

from processor.engine import compress, extract, verify_archive
from processor.tests.test_engine import EngineFixture


FORMAT_OPTIONS = {
    "zip": ("--format", "zip"),
    "tar": ("--format", "pax"),
    "tar.gz": ("--format", "pax", "-z"),
    "tar.bz2": ("--format", "pax", "-j"),
    "tar.xz": ("--format", "pax", "-J"),
}


class ArchiveInteroperabilityTests(EngineFixture):
    def setUp(self):
        self.bsdtar = shutil.which("bsdtar")
        if self.bsdtar is None:
            tar = shutil.which("tar")
            if tar and b"bsdtar" in subprocess.check_output([tar, "--version"], timeout=10):
                self.bsdtar = tar
        if self.bsdtar is None:
            self.skipTest("bsdtar is not installed")

        super().setUp()
        self.fixture = self.root / "fixture"
        # Windows inbox tar uses the system code page for archive member names.
        self.files = {
            ("folder/hello world.txt" if os.name == "nt" else "folder/\u4e16\u754c.txt"): self.data,
            "folder/" + "long-" * 22 + ".bin": bytes(range(256)) * 4,
            "zero.txt": b"",
        }
        for name, data in self.files.items():
            path = self.fixture / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.empty = "folder/empty"
        (self.fixture / self.empty).mkdir()

    def run_bsdtar(self, *args, cwd=None):
        return subprocess.run([self.bsdtar, *args], cwd=cwd, capture_output=True, timeout=30)

    def assert_bsdtar_succeeded(self, result):
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))

    def create_bsdtar_archive(self, archive, target):
        options = FORMAT_OPTIONS[target]
        members = ("folder", "zero.txt")
        result = self.run_bsdtar("-cf", archive, *options, *members, cwd=self.fixture)
        if (target == "tar.xz" and result.returncode
                and b"Unsupported compression option --xz" in result.stderr):
            # Older Windows inbox tar can read XZ but lacks the write filter.
            raw = self.root / "bsdtar-plain.tar"
            result = self.run_bsdtar("-cf", raw, *FORMAT_OPTIONS["tar"], *members, cwd=self.fixture)
            self.assert_bsdtar_succeeded(result)
            with raw.open("rb") as source, lzma.open(archive, "wb") as compressed:
                shutil.copyfileobj(source, compressed)
        else:
            self.assert_bsdtar_succeeded(result)

    def test_bsdtar_extracts_hamma_archives(self):
        inputs = [{"name": name, "path": str(self.fixture / name)} for name in self.files]
        inputs.append({"name": self.empty, "directory": True})
        for target in FORMAT_OPTIONS:
            with self.subTest(target=target):
                archive = self.root / f"hamma.{target}"
                restored = self.root / f"bsdtar-restored-{target}"
                restored.mkdir()
                compress(inputs, archive, target, self.context())
                self.assert_bsdtar_succeeded(self.run_bsdtar("-xf", archive, cwd=restored))
                actual = {
                    path.relative_to(restored).as_posix(): path.read_bytes()
                    for path in restored.rglob("*") if path.is_file()
                }
                self.assertEqual(actual, self.files)
                self.assertEqual(list((restored / self.empty).iterdir()), [])

    def test_hamma_verifies_and_extracts_bsdtar_archives(self):
        for target in FORMAT_OPTIONS:
            with self.subTest(target=target):
                archive = self.root / f"bsdtar.{target}"
                self.create_bsdtar_archive(archive, target)
                entries = verify_archive(archive, archive.name, self.root / "report.json", self.context())
                self.assertEqual(
                    {entry["name"]: (entry["size"], entry["sha256"])
                     for entry in entries if not entry["directory"]},
                    {name: (len(data), hashlib.sha256(data).hexdigest()) for name, data in self.files.items()},
                )
                restored = self.root / "restored.zip"
                extract(archive, archive.name, restored, self.context())
                with zipfile.ZipFile(restored) as result:
                    actual = {info.filename: result.read(info) for info in result.infolist() if not info.is_dir()}
                    self.assertEqual(actual, self.files)
                    self.assertTrue(result.getinfo(self.empty + "/").is_dir())

    def test_hamma_extracts_only_selected_bsdtar_zip_members(self):
        archive = self.root / "selection.zip"
        self.create_bsdtar_archive(archive, "zip")
        chosen = next(iter(self.files))
        with zipfile.ZipFile(archive) as source:
            index = source.namelist().index(chosen)
        restored = self.root / "selection-restored.zip"
        extract(archive, archive.name, restored, self.context(), zip_indexes=[index])
        with zipfile.ZipFile(restored) as result:
            self.assertEqual(result.namelist(), [chosen])
            self.assertEqual(result.read(chosen), self.files[chosen])
