import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from processor.accounts import AccountError, Accounts
from processor.oauth import OAuth, PROVIDERS, jwt
from processor.server import Store

if jwt:
    from cryptography.hazmat.primitives.asymmetric import rsa, ec
    from cryptography.hazmat.primitives import serialization


@unittest.skipUnless(jwt, 'Install processor/requirements-oauth.txt to test provider cryptography')
class OAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.signer = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.apple_key = ec.generate_private_key(ec.SECP256R1())
        cls.jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.signer.public_key()))
        cls.jwk.update(kid='test-key', alg='RS256', use='sig')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.accounts = Accounts(self.store)
        self.key = Path(self.temp.name) / 'apple-key.pem'
        self.key.write_bytes(self.apple_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        self.env = {'SHANTE_OAUTH_BASE_URL': 'https://files.example.test', 'SHANTE_GOOGLE_CLIENT_ID': 'google-test-client',
                    'SHANTE_APPLE_CLIENT_ID': 'apple-test-client', 'SHANTE_APPLE_TEAM_ID': 'ABCDEFGHIJ',
                    'SHANTE_APPLE_KEY_ID': 'KLMNOPQRST', 'SHANTE_APPLE_PRIVATE_KEY_FILE': str(self.key)}
        self.oauth = OAuth(self.store, self.env)

    def tearDown(self):
        self.temp.cleanup()

    def token(self, setup, provider='google', **claims):
        now = int(time.time())
        value = dict(iss=PROVIDERS[provider]['issuer'], aud=self.oauth.configs[provider]['client_id'], sub='person-one', iat=now, exp=now + 300, nonce=setup['nonce'])
        value.update(claims)
        return jwt.encode(value, self.signer, algorithm='RS256', headers={'kid': 'test-key'})

    def keys(self, url, fields=None):
        return {'keys': [self.jwk]}

    def test_google_identity_is_verified_and_replay_is_rejected(self):
        setup, browser = self.oauth.start('google')
        self.assertEqual(setup['clientId'], 'google-test-client')
        self.assertNotIn('secret', setup)
        with patch('processor.oauth.http_json', side_effect=self.keys):
            identity = self.oauth.complete('google', {'state': setup['state'], 'credential': self.token(setup)}, browser)
            with self.assertRaises(AccountError):
                self.oauth.complete('google', {'state': setup['state'], 'credential': self.token(setup)}, browser)
        account, session = self.accounts.login_provider(*identity)
        self.assertEqual(self.accounts.resolve(session)['id'], account['id'])
        self.assertFalse(self.accounts.public(account)['passwordEnabled'])
        again, _ = self.accounts.login_provider(*identity)
        self.assertEqual(again['id'], account['id'])
        apple, _ = self.accounts.login_provider('https://appleid.apple.com', identity[1])
        self.assertNotEqual(apple['owner'], account['owner'])

    def test_state_is_browser_bound_hashed_expiring_and_one_use(self):
        setup, browser = self.oauth.start('google')
        with self.store.connect() as db:
            row = dict(db.execute('SELECT * FROM oauth_transactions').fetchone())
        self.assertNotIn(setup['state'], json.dumps(row))
        self.assertNotIn(browser, json.dumps(row))
        with self.assertRaises(AccountError):
            self.oauth.consume('google', setup['state'], 'a' * 43)
        with self.assertRaises(AccountError):
            self.oauth.consume('apple', setup['state'], browser)
        transaction = self.oauth.consume('google', setup['state'], browser)
        self.assertEqual(transaction['nonce'], setup['nonce'])
        setup, browser = self.oauth.start('google')
        with self.store.connect() as db:
            db.execute('UPDATE oauth_transactions SET expires=?', (time.time() - 1,))
        with self.assertRaises(AccountError):
            self.oauth.consume('google', setup['state'], browser)

    def test_invalid_tokens_are_rejected_before_session_creation(self):
        variations = [dict(aud='wrong'), dict(iss='https://attacker.example'), dict(nonce='wrong'),
                      dict(exp=int(time.time()) - 100), dict(iat=int(time.time()) + 100), dict(sub=''),
                      dict(azp='wrong'), dict(aud=['google-test-client', 'another']), dict(iat=int(time.time()) - 1000)]
        for claims in variations:
            with self.subTest(claims=claims):
                setup, browser = self.oauth.start('google')
                with patch('processor.oauth.http_json', side_effect=self.keys):
                    with self.assertRaises(AccountError) as caught:
                        self.oauth.complete('google', {'state': setup['state'], 'credential': self.token(setup, **claims)}, browser)
                self.assertEqual(caught.exception.status, 401)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM accounts').fetchone()[0], 0)

    def test_bad_signature_algorithm_missing_claim_and_oversized_token(self):
        for mode in ('signature', 'algorithm', 'missing', 'oversized'):
            with self.subTest(mode=mode):
                setup, browser = self.oauth.start('google')
                claims = jwt.decode(self.token(setup), options={'verify_signature': False})
                if mode == 'signature':
                    token = jwt.encode(claims, self.other, algorithm='RS256', headers={'kid': 'test-key'})
                elif mode == 'algorithm':
                    token = jwt.encode(claims, 'x' * 64, algorithm='HS256', headers={'kid': 'test-key'})
                elif mode == 'missing':
                    del claims['nonce']
                    token = jwt.encode(claims, self.signer, algorithm='RS256', headers={'kid': 'test-key'})
                else:
                    token = 'x' * 16385
                with patch('processor.oauth.http_json', side_effect=self.keys), self.assertRaises(AccountError):
                    self.oauth.complete('google', {'state': setup['state'], 'credential': token}, browser)

    def test_apple_code_exchange_uses_signed_client_secret_and_checks_nonce(self):
        setup, browser = self.oauth.start('apple')
        def remote(url, fields=None):
            if fields:
                self.assertEqual(url, PROVIDERS['apple']['token'])
                self.assertEqual(fields['code'], 'one-time-code')
                self.assertEqual(fields['redirect_uri'], 'https://files.example.test/')
                secret = jwt.decode(fields['client_secret'], self.apple_key.public_key(), algorithms=['ES256'], audience='https://appleid.apple.com', issuer='ABCDEFGHIJ')
                self.assertEqual(secret['sub'], 'apple-test-client')
                self.assertLessEqual(secret['exp'] - secret['iat'], 300)
                self.assertEqual(jwt.get_unverified_header(fields['client_secret'])['kid'], 'KLMNOPQRST')
                return {'id_token': self.token(setup, 'apple'), 'access_token': 'not-retained', 'refresh_token': 'not-retained'}
            return self.keys(url)
        with patch('processor.oauth.http_json', side_effect=remote):
            issuer, subject, _ = self.oauth.complete('apple', {'state': setup['state'], 'code': 'one-time-code'}, browser)
        self.assertEqual(issuer, 'https://appleid.apple.com')
        self.assertEqual(subject, 'person-one')
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM oauth_transactions').fetchone()[0], 0)

    def test_unconfigured_missing_dependency_and_insecure_origins_fail_closed(self):
        self.assertTrue(all(row['available'] for row in self.oauth.public('files.example.test', True)))
        self.assertFalse(any(row['available'] for row in self.oauth.public('files.example.test', False)))
        self.assertFalse(any(row['available'] for row in self.oauth.public('other.example.test', True)))
        for env in ({}, {**self.env, 'SHANTE_OAUTH_BASE_URL': 'http://files.example.test'}, {**self.env, 'SHANTE_OAUTH_BASE_URL': 'https://files.example.test/extra'}, {**self.env, 'SHANTE_OAUTH_BASE_URL': 'https://[bad'}, {**self.env, 'SHANTE_OAUTH_BASE_URL': 'https://files.example.test:wrong'}):
            oauth = OAuth(self.store, env)
            self.assertFalse(oauth.configs)
            with self.assertRaises(AccountError):
                oauth.start('google')
        with patch('processor.oauth.jwt', None):
            self.assertFalse(OAuth(self.store, self.env).configs)
        self.assertNotIn('accounts.google.com', self.oauth.content_security_policy('files.example.test', False))
        self.assertIn('https://accounts.google.com/gsi/client', self.oauth.content_security_policy('files.example.test', True))

    def test_provider_outage_and_denial_do_not_create_accounts(self):
        setup, browser = self.oauth.start('apple')
        with patch('processor.oauth.http_json', side_effect=AccountError(503, 'Provider unavailable')), self.assertRaises(AccountError):
            self.oauth.complete('apple', {'state': setup['state'], 'code': 'code'}, browser)
        setup, browser = self.oauth.start('google')
        with self.assertRaises(AccountError):
            self.oauth.complete('google', {'state': setup['state'], 'error': 'access_denied'}, browser)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM accounts').fetchone()[0], 0)


@unittest.skipUnless(jwt, 'Install processor/requirements-oauth.txt to test real TLS provider routes')
class OAuthHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import datetime
        import ipaddress
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes
        cls.directory = tempfile.TemporaryDirectory()
        cls.signer = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.signer.public_key()))
        cls.jwk.update(kid='route-key', alg='RS256', use='sig')
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(cls.signer.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=1))
                .not_valid_after(now + datetime.timedelta(hours=1))
                .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
                .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
                .sign(cls.signer, hashes.SHA256()))
        cls.cert_path = Path(cls.directory.name) / 'cert.pem'
        cls.key_path = Path(cls.directory.name) / 'key.pem'
        cls.cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        cls.key_path.write_bytes(cls.signer.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def setUp(self):
        import ssl
        import threading
        from http.cookiejar import CookieJar
        from urllib.request import build_opener, HTTPSHandler, HTTPCookieProcessor, ProxyHandler
        from processor.server import Service, LocalHTTPServer, handler
        self.temp = tempfile.TemporaryDirectory()
        self.service = Service(self.temp.name)
        self.server = LocalHTTPServer(('127.0.0.1', 0), handler(self.service))
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.cert_path, self.key_path)
        self.server.tls_context = context
        self.server.transport_secure = True
        self.base = 'https://127.0.0.1:' + str(self.server.server_port)
        self.service.oauth = OAuth(self.service.store, {'SHANTE_OAUTH_BASE_URL': self.base, 'SHANTE_GOOGLE_CLIENT_ID': 'route-client'})
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.jar = CookieJar()
        self.client_context = ssl.create_default_context(cafile=str(self.cert_path))
        self.client = build_opener(ProxyHandler({}), HTTPSHandler(context=self.client_context), HTTPCookieProcessor(self.jar))

    def tearDown(self):
        self.service.close(); self.server.shutdown(); self.server.server_close(); self.thread.join(3); self.temp.cleanup()

    def call(self, path, body=None, headers=None, client=None):
        from urllib.request import Request
        request = Request(self.base + '/api/process' + path, data=json.dumps(body).encode() if body is not None else None,
                          headers={'X-Hamma-Request': '1', 'Content-Type': 'application/json', **(headers or {})})
        with (client or self.client).open(request, timeout=10) as response:
            return json.loads(response.read()), response.headers

    def token(self, setup):
        now = int(time.time())
        return jwt.encode(dict(iss=PROVIDERS['google']['issuer'], aud='route-client', sub='route-person', nonce=setup['nonce'], iat=now, exp=now + 300), self.signer, algorithm='RS256', headers={'kid': 'route-key'})

    def test_real_https_completion_sets_session_cookie_and_preserves_guest_identity(self):
        guest, _ = self.call('/account/me')
        self.assertTrue(next(row for row in guest['providers'] if row['id'] == 'google')['available'])
        guest_cookie = next(cookie.value for cookie in self.jar if cookie.name.startswith('hamma_session_'))
        setup, headers = self.call('/account/oauth/google/start', {})
        cookie = headers.get('Set-Cookie')
        for flag in ('HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=600'):
            self.assertIn(flag, cookie)
        credential = self.token(setup)
        with patch('processor.oauth.http_json', return_value={'keys': [self.jwk]}):
            account, headers = self.call('/account/oauth/google/complete', {'state': setup['state'], 'credential': credential})
        self.assertTrue(account['authenticated'])
        self.assertFalse(account['account']['passwordEnabled'])
        self.assertNotIn(credential, json.dumps(account))
        self.assertIn('HttpOnly', str(headers))
        self.assertEqual(next(cookie.value for cookie in self.jar if cookie.name.startswith('hamma_session_')), guest_cookie)
        self.assertTrue(self.call('/account/me')[0]['authenticated'])
        self.call('/account/logout', {})
        self.assertFalse(self.call('/account/me')[0]['authenticated'])
        self.assertEqual(next(cookie.value for cookie in self.jar if cookie.name.startswith('hamma_session_')), guest_cookie)

    def test_normal_origin_csrf_host_and_browser_binding_guards_are_unchanged(self):
        from urllib.error import HTTPError
        from urllib.request import Request, build_opener, HTTPSHandler, ProxyHandler
        for headers in ({'Origin': 'https://attacker.example'}, {'Origin': self.base.replace('https:', 'http:')}, {'Sec-Fetch-Site': 'cross-site'}, {'Host': 'attacker.example'}):
            with self.subTest(headers=headers), self.assertRaises(HTTPError) as caught:
                self.call('/account/oauth/google/start', {}, headers=headers)
            self.assertEqual(caught.exception.code, 403)
        request = Request(self.base + '/api/process/account/oauth/google/start', data=b'{}', headers={'Content-Type': 'application/json'})
        with self.assertRaises(HTTPError) as caught:
            self.client.open(request)
        self.assertEqual(caught.exception.code, 403)
        setup, _ = self.call('/account/oauth/google/start', {})
        foreign = build_opener(ProxyHandler({}), HTTPSHandler(context=self.client_context))
        with self.assertRaises(HTTPError) as caught:
            self.call('/account/oauth/google/complete', {'state': setup['state'], 'credential': self.token(setup)}, client=foreign)
        self.assertEqual(caught.exception.code, 400)
        with patch('processor.oauth.http_json', return_value={'keys': [self.jwk]}):
            self.assertTrue(self.call('/account/oauth/google/complete', {'state': setup['state'], 'credential': self.token(setup)})[0]['authenticated'])
