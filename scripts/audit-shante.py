"""Query OSV for pinned native and optional processor dependencies."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def pinned_dependencies():
    lock = json.loads((ROOT / 'native/vcpkg.json').read_text(encoding='utf-8'))
    version = next(row['version'] for row in lock['overrides'] if row['name'] == 'zstd')
    yield {'package': {'ecosystem': 'GIT', 'name': 'https://github.com/facebook/zstd.git'},
           'version': 'v' + version}
    for raw in (ROOT / 'processor/requirements-oauth.txt').read_text(encoding='utf-8').splitlines():
        pin = raw.partition('#')[0].strip()
        if not pin:
            continue
        match = re.fullmatch(r'([A-Za-z0-9_.-]+)(?:\[[A-Za-z0-9_.,-]+\])?==([A-Za-z0-9_.+-]+)', pin)
        if not match:
            raise ValueError('OAuth dependencies must use exact version pins')
        name, version = match.groups()
        yield {'package': {'ecosystem': 'PyPI', 'name': name}, 'version': version}


def advisories(query):
    findings = []
    for page in range(20):
        request = Request('https://api.osv.dev/v1/query', json.dumps(query).encode(),
                          headers={'Content-Type': 'application/json', 'User-Agent': 'SHANTE-dependency-audit/1'})
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
        findings.extend(item['id'] for item in result.get('vulns', []))
        token = result.get('next_page_token')
        if not token:
            return sorted(set(findings))
        query = {**query, 'page_token': token}
    raise RuntimeError('Pagination limit exceeded')


def write_json(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + '\n', encoding='utf-8')


def processor_sbom(dependencies, timestamp):
    components = []
    for item in dependencies:
        name, ecosystem = item['package']['name'], item['package']['ecosystem']
        version = item['version']
        if ecosystem == 'GIT':
            component = {'name': 'Zstandard', 'version': version.removeprefix('v'),
                         'purl': 'pkg:github/facebook/zstd@' + quote(version, safe=''),
                         'externalReferences': [{'type': 'vcs', 'url': name}]}
        else:
            normalized = re.sub(r'[-_.]+', '-', name.lower())
            component = {'name': name, 'version': version, 'scope': 'optional',
                         'purl': f'pkg:pypi/{normalized}@' + quote(version, safe='')}
        components.append({'type': 'library', 'bom-ref': component['purl'], **component})
    return {'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'serialNumber': f'urn:uuid:{uuid4()}',
            'version': 1, 'metadata': {'timestamp': timestamp,
                'component': {'type': 'application', 'name': 'HAMMA processor',
                              'description': 'Source-pinned native and optional OAuth libraries'}},
            'components': components}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', default='validation/shante-dependency-audit.json', type=Path)
    parser.add_argument('--sbom', type=Path, help='Write the pinned processor components as CycloneDX JSON')
    args = parser.parse_args()
    report = {'scope': 'Pinned Zstandard source and optional processor OAuth packages',
              'checkedAtUTC': datetime.now(timezone.utc).isoformat(), 'dependencies': []}
    dependencies = list(pinned_dependencies())
    if args.sbom:
        write_json(args.sbom, processor_sbom(dependencies, report['checkedAtUTC']))
    for query in dependencies:
        try:
            report['dependencies'].append({**query, 'advisories': advisories(query)})
        except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
            report['dependencies'].append({**query, 'error': type(error).__name__})
    count = sum(len(row.get('advisories', ())) for row in report['dependencies'])
    failures = sum('error' in row for row in report['dependencies'])
    report['status'] = 'unverified' if failures else 'findings' if count else 'no-advisories-returned'
    write_json(args.report, report)
    print(json.dumps({'status': report['status'], 'packages': len(report['dependencies']),
                      'findings': count, 'queryFailures': failures}))
    return 0 if report['status'] == 'no-advisories-returned' else 1


if __name__ == '__main__':
    sys.exit(main())
