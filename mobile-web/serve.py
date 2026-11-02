#!/usr/bin/env python3
"""
Simple HTTP server for Singularity Pack mobile web app.
Serves the mobile-web directory with proper CORS headers.
"""
import http.server
import socketserver
import os
import json

PORT = int(os.environ.get('SPK_MOBILE_PORT', '8080'))

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?', 1)[0] == '/config.js':
            body = ('window.SPK_API_BASE = ' + json.dumps(os.environ.get('SPK_API_BASE')) + ';').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
        print(f"Singularity Pack Mobile Web")
        print(f"Serving at: http://localhost:{PORT}")
        print(f"Mobile access: http://<your-ip>:{PORT}")
        print(f"HAMMA backend: http://localhost:3000")
        print(f"\nMobile web ready! Open on your device.")
        print(f"Make sure backend is running: ../target/release/spk-server\n")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nServer stopped")
