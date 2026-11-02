"""
HAMMA Server

Main entry point for the HAMMA microservice.
Runs as local service, serverless function, or embedded.

Creator: Onazi Treasure (OJ)
"""

import asyncio
import logging
from typing import Optional

import uvicorn

from .api.fastapi_app import app


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("hamma")


class HammaServer:
    """
    HAMMA server manager.
    
    Supports:
    - Local microservice mode (desktop)
    - Embedded mode (native mobile wrappers)
    - Serverless mode (cloud deployment)
    """
    
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8765,
        workers: int = 1,
        low_memory_mode: bool = False,
    ):
        self.host = host
        self.port = port
        self.workers = workers
        self.low_memory_mode = low_memory_mode
        
        self._server: Optional[uvicorn.Server] = None
        self._is_running = False
    
    def start(self):
        """Start the server (blocking)"""
        logger.info(f"Starting HAMMA server on {self.host}:{self.port}")
        
        config = uvicorn.Config(
            app=app,
            host=self.host,
            port=self.port,
            workers=self.workers,
            log_level="info",
            access_log=False,  # Disable for performance
        )
        
        self._server = uvicorn.Server(config)
        self._is_running = True
        
        try:
            self._server.run()
        finally:
            self._is_running = False
    
    async def start_async(self):
        """Start the server (async)"""
        logger.info(f"Starting HAMMA server (async) on {self.host}:{self.port}")
        
        config = uvicorn.Config(
            app=app,
            host=self.host,
            port=self.port,
            log_level="info",
            access_log=False,
        )
        
        self._server = uvicorn.Server(config)
        self._is_running = True
        
        try:
            await self._server.serve()
        finally:
            self._is_running = False
    
    def stop(self):
        """Stop the server"""
        if self._server and self._is_running:
            logger.info("Stopping HAMMA server")
            self._server.should_exit = True
    
    @property
    def is_running(self) -> bool:
        return self._is_running


def start_server(
    host: str = "127.0.0.1",
    port: int = 8765,
    workers: int = 1,
    low_memory_mode: bool = False,
):
    """Convenience function to start server"""
    server = HammaServer(
        host=host,
        port=port,
        workers=workers,
        low_memory_mode=low_memory_mode,
    )
    server.start()


# CLI entry point
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="HAMMA - AI Acceleration Engine")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind to")
    parser.add_argument("--workers", type=int, default=1, help="Number of workers")
    parser.add_argument("--low-memory", action="store_true", help="Enable low memory mode")
    
    args = parser.parse_args()
    
    start_server(
        host=args.host,
        port=args.port,
        workers=args.workers,
        low_memory_mode=args.low_memory,
    )
