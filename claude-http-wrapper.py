#!/usr/bin/env python3
"""
Claude CLI HTTP Wrapper Service
Exposes Claude Code CLI as an HTTP API for n8n to call.

Usage:
    python3 claude-http-wrapper.py [--port 8765] [--host 0.0.0.0]

Endpoints:
    POST /chat - Send a prompt to Claude CLI
    GET /health - Health check
"""

import subprocess
import json
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import threading
import sys

class ClaudeHTTPHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status=200, content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/health':
            self._set_headers(200)
            self.wfile.write(json.dumps({'status': 'ok', 'service': 'claude-http-wrapper'}).encode())
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({'error': 'Not found'}).encode())

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/chat':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')

            try:
                data = json.loads(body)
                prompt = data.get('prompt', '')
                system_prompt = data.get('system', '')
                max_tokens = data.get('max_tokens', 4096)

                if not prompt:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({'error': 'Missing prompt'}).encode())
                    return

                # Build claude command
                cmd = ['claude', '--print']

                if system_prompt:
                    cmd.extend(['--append-system-prompt', system_prompt])

                # Run claude CLI
                print(f"[Claude] Processing prompt: {prompt[:100]}...")

                result = subprocess.run(
                    cmd,
                    input=prompt,
                    capture_output=True,
                    text=True,
                    timeout=120  # 2 minute timeout
                )

                if result.returncode != 0:
                    print(f"[Claude] Error: {result.stderr}")
                    self._set_headers(500)
                    self.wfile.write(json.dumps({
                        'error': 'Claude CLI error',
                        'stderr': result.stderr,
                        'returncode': result.returncode
                    }).encode())
                    return

                output = result.stdout.strip()
                print(f"[Claude] Response: {output[:100]}...")

                self._set_headers(200)
                self.wfile.write(json.dumps({
                    'output': output,
                    'success': True
                }).encode())

            except json.JSONDecodeError:
                self._set_headers(400)
                self.wfile.write(json.dumps({'error': 'Invalid JSON'}).encode())
            except subprocess.TimeoutExpired:
                self._set_headers(504)
                self.wfile.write(json.dumps({'error': 'Claude CLI timeout'}).encode())
            except FileNotFoundError:
                self._set_headers(500)
                self.wfile.write(json.dumps({'error': 'Claude CLI not found. Is it installed and in PATH?'}).encode())
            except Exception as e:
                self._set_headers(500)
                self.wfile.write(json.dumps({'error': str(e)}).encode())
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({'error': 'Not found'}).encode())

    def log_message(self, format, *args):
        print(f"[HTTP] {args[0]}")


def run_server(host='0.0.0.0', port=8765):
    server = HTTPServer((host, port), ClaudeHTTPHandler)
    print(f"Claude HTTP Wrapper starting on http://{host}:{port}")
    print(f"Endpoints:")
    print(f"  POST /chat - Send prompt to Claude")
    print(f"  GET /health - Health check")
    print(f"Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Claude CLI HTTP Wrapper')
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind to (default: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=8765, help='Port to listen on (default: 8765)')
    args = parser.parse_args()

    run_server(args.host, args.port)
