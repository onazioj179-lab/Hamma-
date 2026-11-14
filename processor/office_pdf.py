"""Export a bounded, macro-free Office package in an isolated codec process."""

import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

from .codec_sandbox import check_codec_isolation, codec_command
from .documents import validate_office_source
from .engine import ProcessingError, detect, file_digest
from .pdf_pages import pdf_page_count


TARGET = 'office-pdf'
RENDERER_LIBRARIES = {
    '.docx': ('libswlo.so',),
    '.pptx': ('libsdlo.so',),
    '.xlsx': ('libsclo.so', 'libscfiltlo.so'),
}
INPUT_LIMIT = 32 * 1024**2
WORK_LIMIT = 128 * 1024**2
PROGRAM = '/usr/lib/libreoffice/program'


def office_tools(suffix=None):
    if sys.platform != 'linux':
        return None
    helper = shutil.which('hamma-office-pdf')
    pdfinfo = shutil.which('pdfinfo')
    application_parts = ('libmergedlo.so', *RENDERER_LIBRARIES.get(suffix, ()))
    if helper and pdfinfo and all((Path(PROGRAM) / part).is_file() for part in application_parts):
        return helper, pdfinfo
    return None


def convert_office(source, name, output, ctx):
    suffix = Path(name).suffix.lower()
    if suffix not in RENDERER_LIBRARIES:
        raise ProcessingError('Unsupported Office filename for this package')
    tools = office_tools(suffix)
    if not tools:
        raise ProcessingError('Unsupported Office export without the Linux document renderer')
    if source.stat().st_size > INPUT_LIMIT:
        raise ProcessingError('Office input size limit reached')
    kind = validate_office_source(source, ctx)
    if suffix != '.' + kind:
        raise ProcessingError('Unsupported Office filename for this package')

    helper, pdfinfo = tools
    with TemporaryDirectory(prefix='office-pdf-', dir=ctx.root) as directory:
        scratch = Path(directory).resolve()
        # The renderer needs the canonical extension for selecting its importer.
        staged = scratch / ('document.' + kind)
        with source.open('rb') as stream, staged.open('wb') as target:
            ctx.copy(stream, target, maximum=INPUT_LIMIT)
        work = scratch / 'work'
        work.mkdir()
        profile = work / 'profile'
        profile.mkdir()
        candidate = work / 'document.pdf'
        command = [helper, PROGRAM, profile.as_uri(), staged.as_uri(), candidate.as_uri()]
        with subprocess.Popen(codec_command(command, staged, work), cwd=work,
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL) as process:
            try:
                while process.poll() is None:
                    ctx.check()
                    enforce_work_limit(scratch, ctx)
                    time.sleep(.1)
            finally:
                if process.poll() is None:
                    process.kill()
            status = check_codec_isolation(process.returncode)
            if status:
                raise ProcessingError({
                    10: 'Office renderer could not start',
                    11: 'Office renderer could not open the document',
                    12: 'Office renderer could not write the PDF',
                }.get(status, f'Office PDF conversion failed (renderer status {status})'))
        enforce_work_limit(scratch, ctx)
        if (not candidate.is_file() or candidate.is_symlink() or
                not 0 < candidate.stat().st_size <= ctx.limits['expanded'] or detect(candidate) != 'pdf'):
            raise ProcessingError('Office PDF verification failed')
        ctx.report(state='verifying')
        pages = pdf_page_count(pdfinfo, candidate, scratch / 'verified-info', ctx)
        os.replace(candidate, output)
        ctx.report(track=pages, tracks=pages)
        return [{'name': Path(name).stem + '.pdf', **file_digest(output, ctx)}]


def enforce_work_limit(scratch, ctx):
    total = 0
    entries = 0
    pending = [scratch]
    while pending:
        directory = pending.pop()
        try:
            paths = os.scandir(directory)
        except FileNotFoundError:
            # LibreOffice can remove a temporary profile directory between
            # discovering it and visiting it.
            continue
        with paths:
            for path in paths:
                entries += 1
                if entries > 4096:
                    raise ProcessingError('Office working file limit reached')
                try:
                    info = path.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if stat.S_ISDIR(info.st_mode):
                    pending.append(path.path)
                if stat.S_ISREG(info.st_mode):
                    total += info.st_size
                    if total > min(WORK_LIMIT, ctx.limits['storage']):
                        raise ProcessingError('Office working storage limit reached')
