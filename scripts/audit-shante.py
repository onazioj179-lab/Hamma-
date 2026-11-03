"""Query OSV for the locked native dependency's upstream Git release tag."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', default='validation/shante-dependency-audit.json')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
lock = json.loads((root / 'native/vcpkg.json').read_text(encoding='utf-8'))
version = next(row['version'] for row in lock['overrides'] if row['name'] == 'zstd')
query = {'package': {'ecosystem': 'GIT', 'name': 'https://github.com/facebook/zstd.git'}, 'version': 'v' + version}
report = {'scope': 'Locked Zstandard source only; excludes OS, compiler, Python and web dependencies',
          'checkedAtUTC': datetime.now(timezone.utc).isoformat(), 'query': query, 'vulnerabilities': []}
try:
    for page in range(20):
        request = Request('https://api.osv.dev/v1/query', json.dumps(query).encode(),
                          headers={'Content-Type': 'application/json', 'User-Agent': 'SHANTE-dependency-audit/1'})
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
        report['vulnerabilities'].extend(result.get('vulns', []))
        token = result.get('next_page_token')
        if not token:
            report['status'] = 'findings' if report['vulnerabilities'] else 'no-advisories-returned'
            break
        query = {**query, 'page_token': token}
    else:
        raise RuntimeError('Pagination limit exceeded')
except Exception as error:
    report['status'] = 'unverified'
    report['error'] = type(error).__name__
Path(args.report).parent.mkdir(parents=True, exist_ok=True)
Path(args.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'status': report['status'], 'findings': len(report['vulnerabilities'])}))
sys.exit(0 if report['status'] == 'no-advisories-returned' else 1)
