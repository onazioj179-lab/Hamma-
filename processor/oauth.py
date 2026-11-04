"""Bounded Google/Apple authorization-code adapters. Secrets never reach the UI."""
import hashlib
import hmac
import json
import ipaddress
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from .accounts import AccountError
try:
    import jwt
    if not {'RS256', 'ES256'}.issubset(jwt.algorithms.get_default_algorithms()):
        jwt = None
except (ImportError, AttributeError):
    jwt = None

PROVIDERS = {
    'google': dict(name='Google', issuer='https://accounts.google.com',
                   authorize='https://accounts.google.com/o/oauth2/v2/auth',
                   token='https://oauth2.googleapis.com/token', keys='https://www.googleapis.com/oauth2/v3/certs'),
    'apple': dict(name='Apple', issuer='https://appleid.apple.com',
                  authorize='https://appleid.apple.com/auth/authorize',
                  token='https://appleid.apple.com/auth/token', keys='https://appleid.apple.com/auth/keys'),
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http_json(url, fields=None):
    body = urlencode(fields).encode() if fields is not None else None
    request = Request(url, data=body, headers={'Accept': 'application/json', **({'Content-Type': 'application/x-www-form-urlencoded'} if body is not None else {})})
    try:
        with build_opener(NoRedirect()).open(request, timeout=10) as response:
            payload = response.read(256 * 1024 + 1)
        if len(payload) > 256 * 1024:
            raise ValueError('Response limit')
        result = json.loads(payload)
        if not isinstance(result, dict):
            raise ValueError('Invalid response')
        return result
    except Exception:
        raise AccountError(503, 'The sign-in provider could not be reached. Start sign-in again.') from None


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class OAuth:
    def __init__(self, store, env=None):
        self.store = store
        env = os.environ if env is None else env
        self.base = env.get('SHANTE_OAUTH_BASE_URL', '').rstrip('/')
        try:
            parsed = urlsplit(self.base)
            parsed.port
        except ValueError:
            self.base = ''
            parsed = urlsplit('')
        self.valid_base = bool(parsed.scheme == 'https' and parsed.hostname and parsed.path == '' and not parsed.query and not parsed.fragment and not parsed.username and not parsed.password)
        self.configs = {}
        self.cache = {}
        self.key_lock = threading.Lock()
        for provider in PROVIDERS:
            prefix = 'SHANTE_' + provider.upper() + '_'
            client_id = env.get(prefix + 'CLIENT_ID', '')
            if not self.valid_base or not client_id or len(client_id) > 512 or not jwt:
                continue
            if provider == 'google':
                self.configs[provider] = dict(client_id=client_id)
            else:
                try:
                    ipaddress.ip_address(parsed.hostname)
                    continue
                except ValueError:
                    pass
                if parsed.hostname == 'localhost' or '.' not in parsed.hostname:
                    continue
                team, key_id, filename = (env.get(prefix + name, '') for name in ('TEAM_ID', 'KEY_ID', 'PRIVATE_KEY_FILE'))
                if not re.fullmatch(r'[A-Za-z0-9]{10}', team) or not re.fullmatch(r'[A-Za-z0-9]{10}', key_id) or not filename:
                    continue
                try:
                    path = Path(filename)
                    if path.stat().st_size > 16384:
                        continue
                    key = path.read_text(encoding='ascii')
                    # Validate an ES256 private key before advertising availability.
                    jwt.encode({'test': True}, key, algorithm='ES256')
                except Exception:
                    continue
                self.configs[provider] = dict(client_id=client_id, team=team, key_id=key_id, key=key)
        with store.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS oauth_transactions (state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,browser_hash TEXT NOT NULL,nonce TEXT NOT NULL,created REAL NOT NULL,expires REAL NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS oauth_expiry ON oauth_transactions(expires)')

    @property
    def hostname(self):
        return urlsplit(self.base).hostname if self.valid_base else None

    def same_host(self, host, secure):
        return bool(secure and self.valid_base and host == urlsplit(self.base).netloc)

    def public(self, host, secure):
        return [dict(id=provider, name=info['name'], available=provider in self.configs and self.same_host(host, secure),
                     message='Use your username and password while provider sign-in is unavailable.') for provider, info in PROVIDERS.items()]

    def start(self, provider):
        if provider not in self.configs:
            raise AccountError(503, 'This sign-in provider is not configured.')
        state, browser, nonce = (secrets.token_urlsafe(32) for _ in range(3))
        now = time.time()
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM oauth_transactions WHERE expires<=?', (now,))
            if db.execute('SELECT count(*) FROM oauth_transactions').fetchone()[0] >= 1000:
                raise AccountError(503, 'Sign-in capacity reached. Try again shortly.')
            db.execute('INSERT INTO oauth_transactions VALUES (?,?,?,?,?,?)', (digest(state), provider, digest(browser), nonce, now, now + 600))
        return dict(state=state, nonce=nonce, clientId=self.configs[provider]['client_id'], redirectUri=self.base + '/'), browser

    def consume(self, provider, state, browser):
        if not isinstance(state, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', state) or not isinstance(browser, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', browser):
            raise AccountError(400, 'Sign-in expired or could not be verified. Start again.')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM oauth_transactions WHERE state_hash=?', (digest(state),)).fetchone()
            if not row or row['provider'] != provider or row['expires'] <= time.time() or not hmac.compare_digest(row['browser_hash'], digest(browser)):
                raise AccountError(400, 'Sign-in expired or could not be verified. Start again.')
            db.execute('DELETE FROM oauth_transactions WHERE state_hash=?', (digest(state),))
        return dict(row)

    def secret(self, provider):
        config = self.configs[provider]
        now = int(time.time())
        return jwt.encode(dict(iss=config['team'], iat=now, exp=now + 300, aud='https://appleid.apple.com', sub=config['client_id']), config['key'], algorithm='ES256', headers={'kid': config['key_id']})

    def signing_key(self, provider, kid):
        with self.key_lock:
            now = time.monotonic()
            cached = self.cache.get(provider)
            if not cached or now - cached[0] > 300 or kid not in cached[1] and now - cached[0] > 30:
                payload = http_json(PROVIDERS[provider]['keys'])
                keys = payload.get('keys')
                if not isinstance(keys, list) or not 1 <= len(keys) <= 32:
                    raise AccountError(503, 'The provider signing keys are unavailable.')
                mapping = {}
                for key in keys:
                    if isinstance(key, dict) and key.get('kty') == 'RSA' and key.get('use', 'sig') == 'sig' and key.get('alg', 'RS256') == 'RS256' and isinstance(key.get('kid'), str) and isinstance(key.get('n'), str) and len(key['n']) <= 1400 and isinstance(key.get('e'), str) and len(key['e']) <= 8:
                        mapping[key['kid']] = key
                self.cache[provider] = (now, mapping)
            raw = self.cache[provider][1].get(kid)
            if not raw:
                raise AccountError(401, 'The sign-in token could not be verified.')
            key = jwt.PyJWK.from_dict(raw).key
            if not 2048 <= key.key_size <= 8192:
                raise AccountError(401, 'The provider signing key was rejected.')
            return key

    def verify(self, provider, token, transaction):
        if not isinstance(token, str) or len(token) > 16384:
            raise AccountError(401, 'The sign-in token could not be verified.')
        try:
            header = jwt.get_unverified_header(token)
            if header.get('alg') != 'RS256' or not isinstance(header.get('kid'), str) or len(header['kid']) > 128:
                raise ValueError('Algorithm or key rejected')
            claims = jwt.decode(token, self.signing_key(provider, header['kid']), algorithms=['RS256'], audience=self.configs[provider]['client_id'], issuer=([PROVIDERS[provider]['issuer'], 'accounts.google.com'] if provider == 'google' else PROVIDERS[provider]['issuer']), leeway=30, options={'require': ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce']})
            if not isinstance(claims['sub'], str) or not 1 <= len(claims['sub']) <= 255 or not isinstance(claims['nonce'], str) or not hmac.compare_digest(claims['nonce'], transaction['nonce']):
                raise ValueError('Identity or nonce rejected')
            if claims['iat'] < transaction['created'] - 60 or claims.get('azp', self.configs[provider]['client_id']) != self.configs[provider]['client_id'] or isinstance(claims['aud'], list) and len(claims['aud']) > 1 and 'azp' not in claims:
                raise ValueError('Token binding rejected')
            return claims
        except AccountError:
            raise
        except Exception:
            raise AccountError(401, 'The sign-in token could not be verified.') from None

    def complete(self, provider, fields, browser):
        if provider not in self.configs:
            raise AccountError(503, 'This sign-in provider is not configured.')
        transaction = self.consume(provider, fields.get('state'), browser)
        if fields.get('error'):
            raise AccountError(400, 'Sign-in was not completed. You can try again.')
        if provider == 'google':
            claims = self.verify(provider, fields.get('credential'), transaction)
        else:
            code = fields.get('code')
            if not isinstance(code, str) or not 1 <= len(code) <= 8192:
                raise AccountError(400, 'The authorization response was invalid.')
            parameters = dict(grant_type='authorization_code', code=code, redirect_uri=self.base + '/', client_id=self.configs[provider]['client_id'], client_secret=self.secret(provider))
            response = http_json(PROVIDERS[provider]['token'], parameters)
            claims = self.verify(provider, response.get('id_token'), transaction)
        # Access/refresh tokens are intentionally discarded; only identity is needed.
        return PROVIDERS[provider]['issuer'], claims['sub'], claims.get('name')


    def content_security_policy(self, host, secure):
        scripts, frames, connects, styles = [], [], [], []
        if self.same_host(host, secure):
            if 'google' in self.configs:
                scripts.append('https://accounts.google.com/gsi/client')
                frames.append('https://accounts.google.com/gsi/')
                connects.append('https://accounts.google.com/gsi/')
                styles.append('https://accounts.google.com/gsi/style')
            if 'apple' in self.configs:
                scripts.append('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js')
                connects.append('https://appleid.apple.com')
                frames.append('https://appleid.apple.com')
        extra = lambda values: ''.join(' ' + value for value in values)
        return "default-src 'self'; script-src 'self'" + extra(scripts) + "; style-src 'self' 'unsafe-inline'" + extra(styles) + "; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'" + extra(connects) + "; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" + ('; frame-src ' + ' '.join(frames) if frames else '')


    def cleanup(self):
        with self.store.connect() as db:
            db.execute('DELETE FROM oauth_transactions WHERE expires<=?', (time.time(),))
