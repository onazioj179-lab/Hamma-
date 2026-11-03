"""Durable local account authority; raw passwords and session tokens are never persisted."""
import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time

HASH_SLOTS = threading.BoundedSemaphore(2)
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**17, 8, 1
SESSION_SECONDS = 86400


class AccountError(Exception):
    def __init__(self, status, message, retry_after=None):
        self.status, self.message, self.retry_after = status, message, retry_after


def plan(tier, limits):
    registered = tier == 'free'
    return {'tier': 'free' if registered else 'guest', 'historyRecords': 1000 if registered else 500,
            'maxQueuedJobs': 200 if registered else 100, 'maxConcurrentJobs': 2 if registered else 1,
            'maxUploadFiles': limits['files'], 'maxInputBytes': limits['input'],
            'maxStorageBytes': limits['storage']}


def username(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{2,63}', value):
        raise AccountError(400, 'Use a username of 3 to 64 letters, numbers, dots, underscores or hyphens.')
    return value.lower()


def password_bytes(value):
    if not isinstance(value, str) or not 12 <= len(value) <= 256:
        raise AccountError(400, 'Use a password of 12 to 256 characters.')
    try:
        encoded = value.encode('utf-8')
    except UnicodeError:
        raise AccountError(400, 'Password contains invalid text.') from None
    if len(encoded) > 1024:
        raise AccountError(400, 'Password is too long.')
    return encoded


def derive(password, salt):
    if not HASH_SLOTS.acquire(blocking=False):
        raise AccountError(503, 'Account service is busy. Try again shortly.')
    try:
        return hashlib.scrypt(password, salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                              dklen=32, maxmem=192 * 1024**2).hex()
    except (ValueError, MemoryError):
        raise AccountError(503, 'Password verification is temporarily unavailable.') from None
    finally:
        HASH_SLOTS.release()


class Accounts:
    def __init__(self, store):
        self.store = store
        self.rate_lock = threading.Lock()
        self.rates = {}
        self.auth_per_minute = 10
        with store.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,owner TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,credential_version INTEGER NOT NULL,created REAL NOT NULL,tier TEXT NOT NULL CHECK(tier=\'free\'))')
            db.execute('CREATE TABLE IF NOT EXISTS account_sessions (token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,credential_version INTEGER NOT NULL,created REAL NOT NULL,expires REAL NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions(expires)')
            db.execute('CREATE INDEX IF NOT EXISTS account_sessions_account ON account_sessions(account_id,created)')

    def admit(self, peer):
        now = time.monotonic()
        with self.rate_lock:
            self.rates = {key: value for key, value in self.rates.items() if now - value[0] < 60}
            if peer not in self.rates and len(self.rates) >= 4096:
                raise AccountError(429, 'Account request capacity reached. Try again later.', 60)
            started, used = self.rates.get(peer, (now, 0))
            if used >= self.auth_per_minute:
                raise AccountError(429, 'Too many account attempts. Try again later.', max(1, int(60 - (now - started)) + 1))
            self.rates[peer] = (started, used + 1)

    @staticmethod
    def public(row):
        return {'accountId': row['id'], 'username': row['username'], 'displayName': row['display_name'],
                'created': row['created'], 'plan': row['tier']}

    def by_owner(self, owner):
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM accounts WHERE owner=?', (owner,)).fetchone()
        return dict(row) if row else None

    def resolve(self, token):
        if not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{64}', token):
            return None
        hashed = hashlib.sha256(token.encode()).hexdigest()
        with self.store.connect() as db:
            row = db.execute('SELECT a.* FROM accounts AS a JOIN account_sessions AS s ON s.account_id=a.id AND s.credential_version=a.credential_version WHERE s.token_hash=? AND s.expires>?', (hashed, time.time())).fetchone()
        return dict(row) if row else None

    def _issue(self, db, account):
        now = time.time()
        db.execute('DELETE FROM account_sessions WHERE expires<=?', (now,))
        if db.execute('SELECT count(*) FROM account_sessions').fetchone()[0] >= 10000:
            raise AccountError(503, 'Account session capacity reached. Try again later.')
        excess = db.execute('SELECT count(*) FROM account_sessions WHERE account_id=?', (account['id'],)).fetchone()[0] - 9
        if excess > 0:
            db.execute('DELETE FROM account_sessions WHERE token_hash IN (SELECT token_hash FROM account_sessions WHERE account_id=? ORDER BY created LIMIT ?)', (account['id'], excess))
        token = secrets.token_hex(32)
        db.execute('INSERT INTO account_sessions VALUES (?,?,?,?,?)',
                   (hashlib.sha256(token.encode()).hexdigest(), account['id'], account['credential_version'], now, now + SESSION_SECONDS))
        return token

    def register(self, user, password, display_name=None):
        user = username(user)
        encoded = password_bytes(password)
        if display_name is None:
            display_name = user
        if (not isinstance(display_name, str) or not 1 <= len(display_name.strip()) <= 80 or
            any(ord(character) < 32 or ord(character) == 127 for character in display_name)):
            raise AccountError(400, 'Use a display name of 1 to 80 characters.')
        try:
            display_name.encode('utf-8')
        except UnicodeError:
            raise AccountError(400, 'Display name contains invalid text.') from None
        salt = secrets.token_bytes(32)
        hashed = derive(encoded, salt)
        account = {'id': secrets.token_hex(16), 'username': user, 'owner': secrets.token_hex(32),
                   'display_name': display_name.strip(), 'salt': salt.hex(), 'password_hash': hashed,
                   'credential_version': 1, 'created': time.time(), 'tier': 'free'}
        try:
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if db.execute('SELECT count(*) FROM accounts').fetchone()[0] >= 10000:
                    raise AccountError(503, 'Account capacity reached.')
                db.execute('INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?)', tuple(account.values()))
                token = self._issue(db, account)
        except sqlite3.IntegrityError:
            raise AccountError(409, 'That username is unavailable.') from None
        return account, token

    def login(self, user, password):
        user = username(user)
        encoded = password_bytes(password)
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM accounts WHERE username=?', (user,)).fetchone()
        account = dict(row) if row else None
        actual = derive(encoded, bytes.fromhex(account['salt']) if account else bytes(32))
        if not account or not hmac.compare_digest(actual, account['password_hash']):
            raise AccountError(401, 'Invalid username or password.')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT * FROM accounts WHERE id=?', (account['id'],)).fetchone()
            if not current or current['credential_version'] != account['credential_version']:
                raise AccountError(401, 'Credentials changed. Sign in again.')
            token = self._issue(db, account)
        return account, token

    def logout(self, token):
        with self.store.connect() as db:
            db.execute('DELETE FROM account_sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))

    def change_password(self, account, current_password, new_password):
        current_encoded, new_encoded = password_bytes(current_password), password_bytes(new_password)
        actual = derive(current_encoded, bytes.fromhex(account['salt']))
        if not hmac.compare_digest(actual, account['password_hash']):
            raise AccountError(401, 'Current password is incorrect.')
        salt = secrets.token_bytes(32)
        hashed = derive(new_encoded, salt)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT * FROM accounts WHERE id=?', (account['id'],)).fetchone()
            if not current or current['credential_version'] != account['credential_version']:
                raise AccountError(401, 'Credentials changed. Sign in again.')
            db.execute('UPDATE accounts SET salt=?,password_hash=?,credential_version=credential_version+1 WHERE id=?', (salt.hex(), hashed, account['id']))
            db.execute('DELETE FROM account_sessions WHERE account_id=?', (account['id'],))
            account = {**dict(current), 'salt': salt.hex(), 'password_hash': hashed,
                       'credential_version': current['credential_version'] + 1}
            token = self._issue(db, account)
        return account, token
