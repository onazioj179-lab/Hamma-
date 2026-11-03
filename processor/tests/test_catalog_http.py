import hashlib
from http.cookiejar import CookieJar
import json
import tempfile
import threading
import unittest
from urllib.request import HTTPCookieProcessor, build_opener

from processor.server import LocalHTTPServer, Service, handler


class CatalogHTTPTests(unittest.TestCase):
    def test_guest_catalog_is_owner_scoped_and_never_exposes_disk_paths(self):
        with tempfile.TemporaryDirectory() as root:
            service = Service(root)
            server = LocalHTTPServer(('127.0.0.1', 0), handler(service))
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                base = f'http://127.0.0.1:{server.server_port}/api/process'
                jar = CookieJar()
                client = build_opener(HTTPCookieProcessor(jar))
                with client.open(base + '/capabilities', timeout=15) as response:
                    response.read()
                session = next(cookie.value.split('.')[0] for cookie in jar
                               if cookie.name.startswith('hamma_session_'))
                owner = hashlib.sha256(session.encode()).hexdigest()
                for index in range(3):
                    service.store.put(owner, 'upload', {
                        'id': str(index), 'name': f'file-{index}.txt', 'size': 10,
                        'sha256': 'matching' if index < 2 else 'different',
                        'created': index, 'path': '/private/never-return-this'})
                service.store.put('other-owner', 'upload', {
                    'id': 'secret', 'name': 'secret.txt', 'size': 10, 'created': 0})
                with client.open(base + '/files?limit=1&offset=1', timeout=15) as response:
                    page = json.load(response)
                self.assertEqual(page['total'], 3)
                self.assertEqual(len(page['files']), 1)
                self.assertNotIn('path', page['files'][0])
                with client.open(base + '/files?duplicates=1', timeout=15) as response:
                    self.assertEqual(json.load(response)['total'], 2)
                stranger = build_opener(HTTPCookieProcessor(CookieJar()))
                with stranger.open(base + '/files', timeout=15) as response:
                    self.assertEqual(json.load(response)['total'], 0)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(3)
                service.close()
