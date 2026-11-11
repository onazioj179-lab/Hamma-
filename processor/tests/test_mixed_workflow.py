import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import unittest
import zipfile

import test_server


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Real media workflow requires FFmpeg and FFprobe')
class MixedWorkflowRoutes(unittest.TestCase):
    setUp = test_server.ServerTests.setUp
    tearDown = test_server.ServerTests.tearDown
    call = test_server.ServerTests.call
    upload = test_server.ServerTests.upload
    job = test_server.ServerTests.job
    execute = test_server.ServerTests.execute

    def test_real_mixed_inputs_keep_verified_outputs_after_one_corrupt_image(self):
        fixture = Path(self.temp.name) / 'fixture.png'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                        'color=c=red:s=16x16', '-frames:v', '1', '-threads', '1', str(fixture)],
                       check=True, capture_output=True, timeout=20)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as stream:
            stream.writestr('nested/世界.txt', b'verified archive fixture')
        contents = [fixture.read_bytes(), archive.getvalue(), b'verified document fixture', b'\x89PNG\r\n\x1a\ncorrupted']
        names = ['photo.png', 'archive.zip', 'note.txt', 'broken.png']
        uploads = [self.upload(data, name) for data, name in zip(contents, names)]
        detected = self.call('/inspect', {'entries': [{'head': data[:512].hex()} for data in contents]}, 'POST')
        self.assertEqual([entry['format'] for entry in detected['entries']], ['png', 'zip', 'file', 'png'])
        operations = [('convert', 'png'), ('extract', 'zip'), ('compress', 'zip'), ('convert', 'png')]
        jobs = [self.job(upload, operation=operation, target=target, projectId='mixed')
                for upload, (operation, target) in zip(uploads, operations)]
        rejected = self.execute(jobs[3])
        self.assertEqual(rejected['state'], 'failed')
        self.assertFalse(rejected['downloadAvailable'])
        for index, job in enumerate(jobs[:3]):
            completed = self.execute(job)
            self.assertEqual(completed['state'], 'completed', completed)
            data = self.call(completed['download'].removeprefix('/api/process'), raw=True)
            self.assertEqual(hashlib.sha256(data).hexdigest(), completed['sha256'])
            if index == 0:
                self.assertTrue(data.startswith(b'\x89PNG\r\n\x1a\n'))
            else:
                with zipfile.ZipFile(io.BytesIO(data)) as stream:
                    expected_name = 'nested/世界.txt' if index == 1 else 'note.txt'
                    expected = b'verified archive fixture' if index == 1 else contents[2]
                    self.assertEqual(stream.read(expected_name), expected)
        records = self.call('/jobs')['jobs']
        self.assertEqual(sum(job['state'] == 'completed' for job in records), 3)
        self.assertEqual(sum(job['state'] == 'failed' for job in records), 1)
