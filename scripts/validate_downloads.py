"""Validate synthetic files downloaded during browser checks."""
import argparse
import json
import urllib.request
import uuid
import zipfile
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--archive',type=Path,required=True)
parser.add_argument('--zip',type=Path,required=True)
parser.add_argument('--api',default='http://127.0.0.1:3011')
args=parser.parse_args()
boundary='spk-download-'+uuid.uuid4().hex
body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="download.spk"\r\n\r\n'.encode()
      +args.archive.read_bytes()+f'\r\n--{boundary}--\r\n'.encode())
request=urllib.request.Request(args.api+'/api/files/upload',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary})
with urllib.request.urlopen(request,timeout=30) as response: uploaded=json.load(response)
request=urllib.request.Request(args.api+'/api/decompress/file',data=json.dumps({'id':uploaded['id'],'path':'roundtrip.txt'}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=30) as response: extracted=json.load(response)
with urllib.request.urlopen(args.api+extracted['download_url'],timeout=30) as response: restored=response.read()
fixture=Path(__file__).resolve().parent.parent/'validation'/'fixtures'/'roundtrip.txt'
assert restored==fixture.read_bytes(), 'Browser-downloaded archive did not preserve bytes'
print('PASS browser-downloaded SPK restores exact source bytes')
expected={'nested/fixture.txt':b'Exact bytes across HTTP compression.\n'*200,'empty.bin':b'','binary.bin':bytes(range(256))*4}
with zipfile.ZipFile(args.zip) as archive:
    assert set(archive.namelist())==set(expected),'ZIP filenames differ'
    for name,data in expected.items(): assert archive.read(name)==data,f'ZIP content differs: {name}'
print('PASS browser-downloaded restored ZIP preserves all 3 filenames and exact bytes')
