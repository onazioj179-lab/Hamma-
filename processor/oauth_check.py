"""Print configuration readiness without credentials or network calls."""
import json
import tempfile
from .oauth import OAuth, jwt
from .server import Store


def main():
    with tempfile.TemporaryDirectory() as directory:
        oauth = OAuth(Store(directory))
        report = {'httpsOriginConfigured': oauth.valid_base, 'cryptoRuntimeInstalled': jwt is not None,
                  'googleConfigured': 'google' in oauth.configs, 'appleConfigured': 'apple' in oauth.configs,
                  'verification': 'Configuration only. No live provider sign-in was performed.'}
    print(json.dumps(report, indent=2))
    return 0 if report['googleConfigured'] or report['appleConfigured'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
