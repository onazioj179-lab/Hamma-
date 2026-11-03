"""Public provider availability. No provider is enabled without an implemented flow."""
from dataclasses import dataclass


@dataclass(frozen=True)
class IdentityProvider:
    id: str
    name: str

    def public(self):
        return {'id': self.id, 'name': self.name, 'available': False,
                'message': f'{self.name} sign-in is not available yet. Use your username and password.'}


# Register future providers here only after defining their backend adapter.
PROVIDERS = (IdentityProvider('google', 'Google'), IdentityProvider('apple', 'Apple'))


def public_providers():
    return [provider.public() for provider in PROVIDERS]
