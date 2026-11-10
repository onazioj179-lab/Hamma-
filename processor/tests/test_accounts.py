import hashlib
from http.cookiejar import CookieJar
import ipaddress
import json
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from processor.accounts import Accounts, AccountError, HASH_SLOTS, derive
from processor.server import LocalHTTPServer, Service, Store, handler


PASSWORD = 'correct horse battery staple'
LIMITS = {'expanded': 1024**2, 'files': 20, 'ratio': 1000, 'depth': 3,
          'seconds': 60, 'input': 1024**2, 'storage': 16 * 1024**2}


class AccountAuthorityTests(unittest.TestCase):
    def test_durable_hashed_credentials_sessions_and_password_revocation(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            authority = Accounts(store)
            account, first = authority.register('Alice', PASSWORD, 'Alice 世界')
            self.assertRegex(account['owner'], r'^[a-f0-9]{64}$')
            self.assertNotIn(PASSWORD, str(account))
            restarted = Accounts(Store(root))
            self.assertEqual(restarted.resolve(first)['owner'], account['owner'])
            _, second = restarted.login('ALICE', PASSWORD)
            with store.connect() as db:
                sessions = [row[0] for row in db.execute('SELECT token_hash FROM account_sessions')]
                self.assertIn(hashlib.sha256(first.encode()).hexdigest(), sessions)
                self.assertNotIn(first, sessions)
                self.assertEqual(len(db.execute('SELECT salt FROM accounts').fetchone()[0]), 64)
            changed, third = restarted.change_password(account, PASSWORD, 'new correct password value')
            self.assertIsNone(restarted.resolve(first))
            self.assertIsNone(restarted.resolve(second))
            self.assertEqual(restarted.resolve(third)['owner'], account['owner'])
            with self.assertRaises(AccountError) as error:
                restarted.login('alice', PASSWORD)
            self.assertEqual(error.exception.status, 401)
            _, fourth = restarted.login('alice', 'new correct password value')
            restarted.logout(fourth)
            self.assertIsNone(restarted.resolve(fourth))
            with store.connect() as db:
                db.execute('UPDATE account_sessions SET expires=0')
            self.assertIsNone(restarted.resolve(third))
            self.assertEqual(changed['credential_version'], 2)

    def test_validation_hash_work_bound_and_attempt_limit(self):
        with tempfile.TemporaryDirectory() as root:
            authority = Accounts(Store(root))
            for user, password, name in [('ab', PASSWORD, None), ('valid', 'short', None),
                                         ('valid', PASSWORD, '\ud800')]:
                with self.assertRaises(AccountError) as error:
                    authority.register(user, password, name)
                self.assertEqual(error.exception.status, 400)
            HASH_SLOTS.acquire(); HASH_SLOTS.acquire()
            try:
                with self.assertRaises(AccountError) as error:
                    derive(PASSWORD.encode(), bytes(32))
                self.assertEqual(error.exception.status, 503)
            finally:
                HASH_SLOTS.release(); HASH_SLOTS.release()
            authority.auth_per_minute = 1
            authority.admit('one-peer')
            with self.assertRaises(AccountError) as error:
                authority.admit('one-peer')
            self.assertEqual(error.exception.status, 429)
            self.assertGreater(error.exception.retry_after, 0)
            authority.admit('another-peer')


class AccountHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = Service(self.temp.name, limits=LIMITS)
        self.server = LocalHTTPServer(('127.0.0.1', 0), handler(self.service))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}/api/process'
        self.jar = CookieJar()
        self.client = build_opener(HTTPCookieProcessor(self.jar))

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(3)
        self.service.close(); self.temp.cleanup()

    def call(self, path, data=None, client=None, headers=None):
        request = Request(self.base + path, method='POST' if data is not None else 'GET',
                          data=json.dumps(data).encode() if data is not None else None,
                          headers={'X-Hamma-Request': '1', 'Content-Type': 'application/json', **(headers or {})})
        with (client or self.client).open(request, timeout=15) as response:
            return json.loads(response.read()), response.headers

    def assert_status(self, status, function):
        with self.assertRaises(HTTPError) as error:
            function()
        self.assertEqual(error.exception.code, status, error.exception.read())

    def register(self, name='alice'):
        return self.call('/account/register', {'username': name, 'password': PASSWORD})[0]

    def test_account_switch_does_not_merge_guest_files_and_catalog_is_owner_scoped(self):
        guest = self.call('/account/me')[0]
        self.assertFalse(guest['authenticated'])
        self.assertEqual(guest['plan']['historyRecords'], 500)
        upload = self.call('/uploads', {'name': 'guest.txt', 'size': 0})[0]
        registered = self.register()
        self.assertTrue(registered['authenticated'])
        self.assertEqual(registered['plan']['historyRecords'], 1000)
        self.assertEqual(registered['plan']['maxConcurrentJobs'], 2)
        self.assertFalse(registered['billingEnabled'])
        self.assertNotIn('token', json.dumps(registered).lower())
        self.assertEqual(self.call('/files')[0]['total'], 0)
        self.assert_status(404, lambda: self.call('/uploads/' + upload['id']))
        own = self.call('/uploads', {'name': 'account.txt', 'size': 0})[0]
        caps = self.call('/capabilities')[0]
        self.assertEqual(caps['plan'], registered['plan'])
        stranger = build_opener(HTTPCookieProcessor(CookieJar()))
        self.assertEqual(self.call('/files', client=stranger)[0]['total'], 0)
        self.call('/account/logout', {})
        self.assertEqual(self.call('/files')[0]['files'][0]['id'], upload['id'])
        self.call('/account/login', {'username': 'alice', 'password': PASSWORD}, client=stranger)
        listing = self.call('/files', client=stranger)[0]
        self.assertEqual(listing['files'][0]['id'], own['id'])
        self.assertNotIn('path', listing['files'][0])
        self.assert_status(409, lambda: self.register())

    def test_password_endpoint_rotates_cookie_and_revokes_other_client(self):
        self.register()
        other = build_opener(HTTPCookieProcessor(CookieJar()))
        self.call('/account/login', {'username': 'alice', 'password': PASSWORD}, client=other)
        previous = next(c.value for c in self.jar if c.name.startswith('shante_account_'))
        result, headers = self.call('/account/password-change',
                                    {'currentPassword': PASSWORD, 'newPassword': 'replacement password long'})
        self.assertTrue(result['authenticated'])
        current = next(c.value for c in self.jar if c.name.startswith('shante_account_'))
        self.assertNotEqual(previous, current)
        self.assertIn('HttpOnly', headers.get('Set-Cookie'))
        self.assertIn('SameSite=Strict', headers.get('Set-Cookie'))
        self.assertFalse(self.call('/account/me', client=other)[0]['authenticated'])

    def test_plain_network_credentials_are_rejected_even_with_forwarded_tls_headers(self):
        real_ip = ipaddress.ip_address
        with patch('processor.server.ipaddress.ip_address', side_effect=lambda value: real_ip('192.168.1.9')):
            me = self.call('/account/me')[0]
            self.assertFalse(me['credentialsAllowed'])
            self.assert_status(403, lambda: self.call('/account/register',
                {'username': 'alice', 'password': PASSWORD}, headers={'X-Forwarded-Proto': 'https'}))
            self.assertEqual(self.call('/files')[0]['total'], 0)

    def test_secure_transport_cookie_flags_and_invalid_paid_option(self):
        self.assert_status(400, lambda: self.call('/account/register',
            {'username': 'alice', 'password': PASSWORD, 'plan': 'pro'}))
        # The real TLS listener is covered by test_transport_security. Here inspect both
        # response cookie attributes with the listener's verified transport flag set.
        self.server.transport_secure = True
        _, headers = self.call('/account/register', {'username': 'alice', 'password': PASSWORD},
                               client=build_opener())
        cookies = headers.get_all('Set-Cookie')
        self.assertEqual(len(cookies), 2)
        self.assertTrue(all('Secure' in cookie and 'HttpOnly' in cookie for cookie in cookies))

    def test_guest_and_free_queue_limits_are_enforced_before_job_creation(self):
        for registered, count in ((False, 100), (True, 200)):
            if registered:
                self.register()
            upload = self.call('/uploads', {'name': 'input.txt', 'size': 0})[0]
            owner = next(owner for owner, record in self.service.store.iter_records(kind='upload') if record['id'] == upload['id'])
            for index in range(count):
                self.service.store.put(owner, 'job', {'id': f'{index:032x}', 'created': index,
                    'state': 'queued', 'name': 'queued', 'inputs': []})
            self.assert_status(429, lambda: self.call('/jobs',
                {'uploads': [upload['id']], 'operation': 'compress', 'target': 'zip'}))
            self.assertEqual(self.service.store.count(owner, states=('queued',)), count)

    def test_plan_history_retention_and_scheduler_concurrency_are_enforced(self):
        for registered, history_limit, concurrency in ((False, 500, 1), (True, 1000, 2)):
            if registered:
                self.register()
            upload = self.call('/uploads', {'name': 'input.txt', 'size': 0})[0]
            owner = next(owner for owner, record in self.service.store.iter_records(kind='upload') if record['id'] == upload['id'])
            # Exercise creation's real history trim, preserving terminal download metadata.
            for index in range(history_limit + 1):
                self.service.store.put(owner, 'job', {'id': f'{index:032x}', 'created': index,
                    'state': 'completed', 'name': 'retained', 'inputs': [], 'downloadAvailable': False})
            for _ in range(2):
                self.call('/jobs', {'uploads': [upload['id']], 'operation': 'compress', 'target': 'zip'})
            self.assertEqual(self.service.store.count(owner, visible=True), history_limit)
            # Isolate account quotas from host CPU/memory admission, which has
            # its own tests and can legitimately allow fewer workers.
            with patch('processor.server.multiprocessing.get_context') as context, patch('processor.server.worker_capacity', return_value=2):
                self.service.tick()
                self.assertEqual(sum(item[1] == owner for item in self.service.running.values()), concurrency)
            # Complete synthetic workers so the next owner is measured independently.
            for job_id, (_, running_owner, _) in list(self.service.running.items()):
                self.service.store.patch(running_owner, 'job', job_id, state='completed')
            self.service.running.clear()
            for queued_owner, record in self.service.store.iter_records(states=('queued',)):
                self.service.store.patch(queued_owner, 'job', record['id'], state='completed')


if __name__ == '__main__':
    unittest.main()
