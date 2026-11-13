"""Render PDF pages through the codec subprocess and package verified PNG files."""

from pathlib import Path
import re
import shutil
import struct
import subprocess
from tempfile import TemporaryDirectory
import time

from .codec_sandbox import check_codec_isolation, codec_command
from .engine import ProcessingError, compress, detect


TARGET = "pdf-pages"
MAX_PAGES = 100
MAX_EDGE = 2048


def pdf_tools():
    return shutil.which("pdfinfo"), shutil.which("pdftoppm")


def run_pdf_command(args, source, destination, ctx, limit):
    with destination.open("wb") as stream:
        with subprocess.Popen(codec_command(args, source), stdin=subprocess.DEVNULL,
                              stdout=stream, stderr=subprocess.DEVNULL) as process:
            try:
                while process.poll() is None:
                    ctx.check()
                    if destination.stat().st_size > limit:
                        raise ProcessingError("PDF output size limit reached")
                    time.sleep(.05)
            finally:
                if process.poll() is None:
                    process.kill()
            if check_codec_isolation(process.returncode):
                raise ProcessingError("Invalid PDF or PDF rendering failed")
    if destination.stat().st_size > limit:
        raise ProcessingError("PDF output size limit reached")


def pdf_page_count(info_tool, source, info, ctx):
    run_pdf_command([info_tool, str(source)], source, info, ctx, 64 * 1024)
    data = info.read_bytes()
    if not re.search(rb"^Encrypted:[ \t]+no[ \t]*\r?$", data, re.MULTILINE):
        raise ProcessingError("Unsupported encrypted PDF")
    pages = re.search(rb"^Pages:[ \t]+([0-9]{1,9})[ \t]*\r?$", data, re.MULTILINE)
    if not pages or not 1 <= int(pages[1]) <= min(MAX_PAGES, ctx.limits["files"]):
        raise ProcessingError("PDF page limit reached")
    return int(pages[1])


def render_pdf(source, output, ctx):
    if detect(source) != "pdf":
        raise ProcessingError("Unsupported input for PDF rendering")
    info_tool, render_tool = pdf_tools()
    if not info_tool or not render_tool:
        raise ProcessingError("Unsupported PDF rendering without Poppler")

    with TemporaryDirectory(prefix="pdf-pages-", dir=ctx.root) as directory:
        root = Path(directory)
        count = pdf_page_count(info_tool, source, root / "info", ctx)
        ctx.report(tracks=count)
        remaining = ctx.limits["expanded"]
        entries = []
        for page in range(1, count + 1):
            path = root / f"page-{page:03d}.png"
            run_pdf_command([render_tool, "-f", str(page), "-l", str(page), "-singlefile",
                             "-scale-to", str(MAX_EDGE), "-png", str(source)], source, path, ctx, remaining)
            with path.open("rb") as stream:
                head = stream.read(24)
            if len(head) != 24 or head[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
                raise ProcessingError("Invalid PDF page image")
            if any(not 0 < edge <= MAX_EDGE for edge in struct.unpack(">II", head[16:24])):
                raise ProcessingError("PDF page dimensions exceed the limit")
            remaining -= path.stat().st_size
            entries.append({"name": path.name, "path": path})
            ctx.report(track=page)
        # The existing ZIP writer verifies every member against the rendered PNG.
        return compress(entries, output, "zip", ctx)
