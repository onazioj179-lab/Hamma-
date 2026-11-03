"""Explicit, fail-closed TLS configuration for the processor listener."""

from dataclasses import dataclass
from pathlib import Path
import ssl


class TLSConfigurationError(ValueError):
    """The requested TLS configuration cannot safely start a listener."""


@dataclass(frozen=True)
class TransportSecurity:
    context: ssl.SSLContext | None
    secure_cookies: bool


def configure_tls(cert_path: str | Path | None = None,
                  key_path: str | Path | None = None) -> TransportSecurity:
    """Load an operator-supplied certificate/key, or select existing local HTTP.

    A caller must separately enforce its existing loopback/private-network bind
    restrictions. This helper neither enables public binds nor generates or
    installs certificates. Cookie security follows the actual listener TLS.
    """
    if cert_path is None and key_path is None:
        return TransportSecurity(context=None, secure_cookies=False)
    if cert_path is None or key_path is None:
        raise TLSConfigurationError('TLS requires both certificate and private key paths')
    if not str(cert_path).strip() or not str(key_path).strip():
        raise TLSConfigurationError('TLS certificate and private key paths must not be empty')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    try:
        # An encrypted key must not prompt on an unattended production server.
        # No password support is implied by this explicit file-only contract.
        context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path), password=lambda: '')
    except (OSError, ValueError, ssl.SSLError) as exc:
        raise TLSConfigurationError('Unable to load the configured TLS certificate and private key') from exc
    return TransportSecurity(context=context, secure_cookies=True)
