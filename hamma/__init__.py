"""
HAMMA - AI Acceleration Engine for SPK
Python-powered intelligent compression optimization

Creator: Onazi Treasure (OJ)
License: See LICENSE file

HAMMA processes ONLY structural metadata and binary-pattern signatures.
HAMMA does NOT analyze or inspect user file contents.
"""

__version__ = "1.0.0"
__author__ = "Onazi Treasure (OJ)"

from .server import start_server, HammaServer
from .api.fastapi_app import app

__all__ = ["start_server", "HammaServer", "app", "__version__"]
