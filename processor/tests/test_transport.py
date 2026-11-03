import http.client
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from processor.server import LocalHTTPServer
from processor.transport import TLSConfigurationError, configure_tls


def openssl_executable():
    found = shutil.which('openssl')
    if found:
        return found
    # Git for Windows commonly provides OpenSSL outside the process PATH.
    for candidate in (r'C:\Program Files\Git\usr\bin\openssl.exe',
                      r'C:\Program Files\Git\mingw64\bin\openssl.exe'):
        if Path(candidate).is_file():
            return candidate
    return None


class TransportTests(unittest.TestCase):
    def test_no_tls_is_explicit_local_transport(self):
        transport = configure_tls()
        self.assertIsNone(transport.context)
        self.assertFalse(transport.secure_cookies)

    def test_partial_empty_and_invalid_configuration_fails_closed(self):
        for cert, key in [('cert.pem', None), (None, 'key.pem'), ('', ''),
                          (' ', 'key.pem'), ('cert.pem', ''),
                          ('missing-cert.pem', 'missing-key.pem')]:
            with self.subTest(cert=cert, key=key):
                with self.assertRaises(TLSConfigurationError):
                    configure_tls(cert, key)
        with tempfile.TemporaryDirectory() as temp:
            bad = Path(temp) / 'bad.pem'
            bad.write_text('not a certificate or key', encoding='ascii')
            with self.assertRaises(TLSConfigurationError):
                configure_tls(bad, bad)


@unittest.skipUnless(openssl_executable(), 'OpenSSL unavailable for temporary TLS test certificates')
class HTTPSIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.temp.name)
        cls.cert = cls.directory / 'cert.pem'
        cls.key = cls.directory / 'key.pem'
        try:
            subprocess.run([openssl_executable(), 'req', '-x509', '-newkey', 'rsa:2048',
                            '-nodes', '-keyout', str(cls.key), '-out', str(cls.cert),
                            '-days', '1', '-subj', '/CN=localhost',
                            '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
                           check=True, capture_output=True, timeout=30)
        except BaseException:
            cls.temp.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_https_serves_only_with_explicit_client_trust(self):
        transport = configure_tls(self.cert, self.key)
        self.assertTrue(transport.secure_cookies)
        self.assertEqual(transport.context.protocol, ssl.PROTOCOL_TLS_SERVER)
        self.assertEqual(transport.context.minimum_version, ssl.TLSVersion.TLSv1_2)

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'tls-ok')

            def log_message(self, *args):
                pass

        server = LocalHTTPServer(('127.0.0.1', 0), Handler)
        server.tls_context = transport.context
        server.transport_secure = transport.secure_cookies
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            # The intentionally rejected handshake can also raise in its server
            # request thread; suppress only its expected diagnostic traceback.
            with patch.object(server, 'handle_error'):
                connection = http.client.HTTPSConnection('127.0.0.1', server.server_port, timeout=5)
                try:
                    with self.assertRaises(ssl.SSLCertVerificationError):
                        connection.request('GET', '/')
                finally:
                    connection.close()
            trusted = ssl.create_default_context(cafile=str(self.cert))
            connection = http.client.HTTPSConnection('127.0.0.1', server.server_port,
                                                     context=trusted, timeout=5)
            try:
                connection.request('GET', '/')
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), b'tls-ok')
            finally:
                connection.close()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)

    def test_stalled_raw_client_does_not_block_legitimate_tls_request(self):
        transport = configure_tls(self.cert, self.key)
        request_started = threading.Event()

        class Handler(BaseHTTPRequestHandler):
            def setup(self):
                # Reached only after LocalHTTPServer.get_request returns the
                # deferred-handshake socket and dispatches the request thread.
                request_started.set()
                super().setup()

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'not-blocked')

            def log_message(self, *args):
                pass

        server = LocalHTTPServer(('127.0.0.1', 0), Handler)
        server.tls_context = transport.context
        server.transport_secure = transport.secure_cookies
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        stalled = None
        connection = None
        try:
            # Send no ClientHello. A handshake in the accept loop would prevent
            # the second request from completing until the 10-second timeout.
            stalled = socket.create_connection(('127.0.0.1', server.server_port), timeout=2)
            self.assertTrue(request_started.wait(timeout=2), 'Stalled socket was not dispatched')
            trusted = ssl.create_default_context(cafile=str(self.cert))
            connection = http.client.HTTPSConnection('127.0.0.1', server.server_port,
                                                     context=trusted, timeout=2)
            connection.request('GET', '/')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b'not-blocked')
        finally:
            if connection:
                connection.close()
            # Stop accepting first, then release the intentionally incomplete
            # handshake while its expected server-side error is suppressed.
            server.shutdown()
            with patch.object(server, 'handle_error'):
                if stalled:
                    stalled.close()
                server.server_close()
            worker.join(timeout=5)

    def test_mismatched_private_key_is_rejected(self):
        other_key = self.directory / 'other-key.pem'
        subprocess.run([openssl_executable(), 'genrsa', '-out', str(other_key), '2048'],
                       check=True, capture_output=True, timeout=30)
        with self.assertRaises(TLSConfigurationError):
            configure_tls(self.cert, other_key)

    def test_request_capacity_rejects_overload_and_recovers_after_completion(self):
        transport = configure_tls(self.cert, self.key)
        first_started = threading.Event()
        release_first = threading.Event()
        dispatched = []
        first_results = []
        first_errors = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                dispatched.append(self.path)
                if self.path == '/first':
                    first_started.set()
                    if not release_first.wait(timeout=10):
                        self.send_error(503)
                        return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'slot-ok')

            def log_message(self, *args):
                pass

        server = LocalHTTPServer(('127.0.0.1', 0), Handler)
        server.tls_context = transport.context
        server.transport_secure = transport.secure_cookies
        server.request_slots = threading.BoundedSemaphore(1)
        trusted = ssl.create_default_context(cafile=str(self.cert))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()

        def first_request():
            connection = http.client.HTTPSConnection('127.0.0.1', server.server_port,
                                                     context=trusted, timeout=5)
            try:
                connection.request('GET', '/first')
                response = connection.getresponse()
                first_results.append((response.status, response.read()))
            except Exception as exc:
                first_errors.append(exc)
            finally:
                connection.close()

        first = threading.Thread(target=first_request, daemon=True)
        first.start()
        try:
            self.assertTrue(first_started.wait(timeout=3), 'First request did not acquire its slot')
            # The sole handler remains blocked. A second socket must be closed
            # before TLS handshaking or creating another handler thread.
            with socket.create_connection(('127.0.0.1', server.server_port), timeout=2) as overloaded:
                try:
                    self.assertEqual(overloaded.recv(1), b'')
                except ConnectionResetError:
                    pass  # Windows may report reset rather than EOF on close.
            self.assertEqual(dispatched, ['/first'])
            release_first.set()
            first.join(timeout=3)
            self.assertFalse(first.is_alive())
            self.assertEqual(first_errors, [])
            self.assertEqual(first_results, [(200, b'slot-ok')])
            # Response delivery may precede the handler's finally block. Wait
            # on the actual slot, then return it before making another request.
            self.assertTrue(server.request_slots.acquire(timeout=2), 'Completed handler leaked its slot')
            server.request_slots.release()
            connection = http.client.HTTPSConnection('127.0.0.1', server.server_port,
                                                     context=trusted, timeout=2)
            try:
                connection.request('GET', '/after')
                response = connection.getresponse()
                self.assertEqual((response.status, response.read()), (200, b'slot-ok'))
            finally:
                connection.close()
            self.assertEqual(dispatched, ['/first', '/after'])
        finally:
            release_first.set()
            first.join(timeout=3)
            server.shutdown()
            server.server_close()
            worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
