"""Exercise a dedicated local backend using synthetic, disposable test data."""
import json
import os
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = os.environ.get('SPK_TEST_API', 'http://127.0.0.1:3011')
passed = 0

def request(path, data=None, expected=200, content_type='application/json'):
    if isinstance(data, dict):
        data = json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type':content_type})
    try:
        response = urllib.request.urlopen(req, timeout=30)
        status, body = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read()
    assert status == expected, f'{path}: HTTP {status}, expected {expected}: {body[:200]!r}'
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return body

def check(name, action):
    global passed
    action()
    passed += 1
    print(f'PASS {name}', flush=True)

check('health', lambda: request('/health'))
check('version', lambda: request('/version'))
check('reject weak password', lambda: request('/api/account/create', {'display_name':'Validation','password':'weak'}, expected=400))
password = 'LocalValidation123!'
created = request('/api/account/create', {'display_name':'Validation-' + uuid.uuid4().hex[:8], 'password':password})
assert created['success'] and len(created['recovery_phrase']) >= 12
passed += 1
print('PASS create synthetic account', flush=True)
account_id=created['account_id']
check('reject incorrect login', lambda: request('/api/account/login', {'account_id':account_id, 'password':'Incorrect123!'}, expected=401))
login=request('/api/account/login', {'account_id':account_id,'password':password})
assert login['success'] and login['account_id']==account_id
passed += 1
print('PASS login', flush=True)
check('reject invalid recovery', lambda: request('/api/account/recover', {'recovery_phrase':'invalid phrase', 'new_password':'Replacement123!'}, expected=401))
recovered=request('/api/account/recover', {'recovery_phrase':' '.join(created['recovery_phrase']), 'new_password':'Replacement123!'})
assert recovered['success'] and recovered['account_id']==account_id
passed += 1
print('PASS account recovery', flush=True)
check('old password stops working', lambda: request('/api/account/login', {'account_id':account_id,'password':password}, expected=401))
check('replacement password works', lambda: request('/api/account/login', {'account_id':account_id,'password':'Replacement123!'}))

boundary='spk-validation-' + uuid.uuid4().hex
source={'nested/fixture.txt': b'Exact bytes across HTTP compression.\n'*200, 'empty.bin':b'', 'binary.bin':bytes(range(256))*4}
body=bytearray()
for name,data in source.items():
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
    body.extend(data); body.extend(b'\r\n')
body.extend(f'--{boundary}--\r\n'.encode())
compressed=request('/api/compress', bytes(body), content_type='multipart/form-data; boundary='+boundary)
assert compressed['file_count']==len(source)
passed += 1
print('PASS multipart compression', flush=True)
info=request('/api/decompress/info', {'id':compressed['id']})
assert {file['path']:file['size'] for file in info['files']} == {name:len(data) for name,data in source.items()}
passed += 1
print('PASS archive manifest', flush=True)
fixture_dir = Path(__file__).resolve().parent.parent / 'validation' / 'fixtures'
fixture_dir.mkdir(parents=True, exist_ok=True)
(fixture_dir / 'test-account.json').write_text(json.dumps({'accountId':account_id,'password':'Replacement123!'}))
(fixture_dir / 'backend.spk').write_bytes(request(compressed['download_url']))
for name,data in source.items():
    extracted=request('/api/decompress/file', {'id':compressed['id'], 'path':name})
    restored=request(extracted['download_url'])
    assert restored==data, f'Restored bytes differ for {name}'
    passed += 1
    print(f'PASS extract {name}', flush=True)
check('reject missing archives', lambda: request('/api/decompress/info', {'id':'missing-validation-id'}, expected=404))

session=request('/api/session/create', {})
check('session API rejects unsupported password protection', lambda: request('/api/session/create',{'password':'Synthetic123!'},expected=501))
session_id=session['id']
session_source=b'Session chunks must produce a real archive.\n'*80
request(f'/api/session/{session_id}/pause',b'')
paused_body=f'--{boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="test.bin"\r\n\r\nREJECTED\r\n--{boundary}--\r\n'.encode()
check('paused sessions reject uploaded bytes', lambda: request(f'/api/session/{session_id}/upload',paused_body,expected=409,content_type='multipart/form-data; boundary='+boundary))
request(f'/api/session/{session_id}/resume',b'')
for chunk in [session_source[:700], session_source[700:]]:
    chunk_body=(f'--{boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="chunk.bin"\r\n\r\n'.encode()+chunk+f'\r\n--{boundary}--\r\n'.encode())
    request(f'/api/session/{session_id}/upload',chunk_body,content_type='multipart/form-data; boundary='+boundary)
session_archive=request(f'/api/session/{session_id}/finalize', b'')
session_file=request('/api/decompress/file', {'id':session_archive['id'],'path':'session.bin'})
assert request(session_file['download_url'])==session_source
passed+=1
print('PASS session upload/finalize/extract exact bytes',flush=True)

job=request('/api/compression/jobs', {'name':'unsupported-validation','userId':account_id,'totalSize':3})
job_body=f'--{boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="test.bin"\r\n\r\nabc\r\n--{boundary}--\r\n'.encode()
check('unfinished streaming upload returns 501 instead of discarding data', lambda: request(f"/api/compression/jobs/{job['jobId']}/upload",job_body,expected=501,content_type='multipart/form-data; boundary='+boundary))
password_body=(f'--{boundary}\r\nContent-Disposition: form-data; name="password"\r\n\r\nSynthetic123!\r\n'.encode()+bytes(body))
check('unsupported password protection never produces an unencrypted archive', lambda: request('/api/compress',password_body,expected=501,content_type='multipart/form-data; boundary='+boundary))
print(f'Complete: {passed} backend checks passed. Synthetic accounts and files are in this process only.')
