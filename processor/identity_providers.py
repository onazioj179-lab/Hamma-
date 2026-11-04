"""Compatibility view of the provider registry; availability comes from OAuth."""
from .oauth import PROVIDERS


def public_providers():
    return [dict(id=provider, name=info['name'], available=False,
                 message=info['name'] + ' sign-in needs configuration. Use your username and password.')
            for provider, info in PROVIDERS.items()]
