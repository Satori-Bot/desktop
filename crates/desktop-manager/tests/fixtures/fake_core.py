"""HTTP fixture for manager lifecycle tests. Not a replacement MCP implementation."""
import argparse
import json
import os
import socketserver
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--version', action='store_true')
parser.add_argument('--workspace')
parser.add_argument('--host', default='127.0.0.1')
parser.add_argument('--port', type=int)
parser.add_argument('--permission-mode')
parser.add_argument('--oauth-mode', action='store_true')
args = parser.parse_args()
if args.version:
    print('coding-tools-mcp 0.5.0 fixture')
    raise SystemExit

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        data = {'server': {'name': 'coding-tools-mcp', 'version': '0.5.0'},
                'transport': {'endpoint': '/mcp'}}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_POST(self):
        if args.oauth_mode:
            self.send_response(401)
            self.end_headers()
            return
        token = os.environ.get('CODING_TOOLS_MCP_AUTH_TOKEN')
        if token and self.headers.get('Authorization') != f'Bearer {token}':
            self.send_response(401)
            self.end_headers()
            return
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"coding-tools-mcp","version":"0.5.0"}}}')

class LoopbackHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer normally reverse-resolves the bound address before listen.
        # setup-python on macOS runners can spend over 30 seconds resolving
        # 127.0.0.1 (actions/setup-python#1223). This local fixture needs no DNS.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


print('fixture: entering loopback HTTP bind', flush=True)
server = LoopbackHTTPServer((args.host, args.port), Handler)
print('fixture: loopback HTTP ready', flush=True)
server.serve_forever()
