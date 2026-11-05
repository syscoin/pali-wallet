import gzip
import http.server
import subprocess
import sys
import threading
import time
from collections import Counter

CAP = 2 * 1024 * 1024
QUALIFIED = 16 * 1024 * 1024
LARGE_BODIES = {'/medium': 6_693_325, '/large': 13_106_047, '/limit': QUALIFIED}
PATHS = {
    '/exact', '/progress', '/empty', '/oversize-length', '/oversize-progress', '/oversize-chunked',
    '/encoded', '/multipart-replace', '/multipart', '/redirect', '/challenge', '/partial', '/truncated', '/held', '/reopened',
    '/deadline', '/after-deadline', '/retained', '/after-release', '/abandoned',
    '/after-retained-deadline', '/delayed-delivery', '/after-delayed-delivery',
    '/oversize-qualified-length', '/oversize-qualified-chunked',
} | LARGE_BODIES.keys()
requests = Counter()
violations = []


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_args):
        pass

    def start(self, status, length=None, *, content_type='application/json', **headers):
        self.send_response(status)
        self.send_header('Connection', 'close')
        self.send_header('Content-Type', content_type)
        if length is not None:
            self.send_header('Content-Length', str(length))
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.close_connection = True

    def chunked(self, extra=False, size=CAP):
        self.start(200, **{'Transfer-Encoding': 'chunked', 'Set-Cookie': 'blocked=1'})
        chunk = b'4000\r\n' + b'a' * 16384 + b'\r\n'
        for _ in range(size // 16384):
            self.wfile.write(chunk)
        if extra:
            self.wfile.write(b'1\r\nx\r\n')
        self.wfile.write(b'0\r\n\r\n')

    def do_GET(self):
        requests[self.path] += 1
        if self.path not in PATHS or any(self.headers.get(h) for h in ('Cookie', 'Authorization', 'Referer', 'Proxy-Authorization')):
            violations.append((self.path, 'unexpected route or credentials'))
            self.start(400, 0)
            return
        if (self.headers.get('Accept-Encoding') != 'identity' or self.headers.get('User-Agent') != 'PaliWallet'
                or self.headers.get('Cache-Control') != 'no-store, no-cache'):
            violations.append((self.path, 'wrong transport policy headers'))
            self.start(400, 0)
            return
        try:
            if self.path == '/exact':
                self.chunked()
            elif self.path in LARGE_BODIES:
                size = LARGE_BODIES[self.path]
                self.start(200, size)
                for position in range(0, size, 16384):
                    self.wfile.write(bytes([(position // 16384) % 251]) * min(16384, size - position))
            elif self.path == '/oversize-qualified-length':
                self.start(200, QUALIFIED + 1)
                self.wfile.write(b'x' * 1024)
                self.wfile.flush()
                time.sleep(0.5)
            elif self.path == '/oversize-qualified-chunked':
                self.chunked(extra=True, size=QUALIFIED)
            elif self.path == '/progress':
                self.start(202, 4096)
                self.wfile.write(b'b' * 4096)
            elif self.path == '/empty':
                self.start(200, 0)
            elif self.path == '/oversize-length':
                self.start(200, CAP + 1)
                self.wfile.write(b'x' * 1024)
                self.wfile.flush()
                time.sleep(0.5)
            elif self.path == '/oversize-progress':
                self.start(202, 4097)
                self.wfile.write(b'x' * 1024)
                self.wfile.flush()
                time.sleep(0.5)
            elif self.path == '/oversize-chunked':
                self.chunked(extra=True)
            elif self.path == '/encoded':
                compressed = gzip.compress(b'x' * (CAP + 1))
                self.start(200, len(compressed), **{'Content-Encoding': 'gzip'})
                self.wfile.write(compressed)
            elif self.path in ('/multipart-replace', '/multipart'):
                boundary = 'snapshot-part'
                media_type = 'multipart/x-mixed-replace' if self.path == '/multipart-replace' else 'Multipart/Mixed'
                part = f'--{boundary}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n'.encode()
                body = part + b'{}\r\n' + part + b'[]\r\n' + f'--{boundary}--\r\n'.encode()
                self.start(200, len(body), content_type=f'{media_type}; boundary={boundary}')
                self.wfile.write(body)
            elif self.path == '/redirect':
                self.start(302, 0, Location='/must-not-hit')
            elif self.path == '/challenge':
                self.start(401, 0, **{'WWW-Authenticate': 'Basic realm="fixture"'})
            elif self.path == '/partial':
                self.start(206, 0)
            elif self.path == '/truncated':
                self.start(200, 100)
                self.wfile.write(b'x')
            elif self.path in ('/held', '/deadline'):
                self.start(200, 100)
                self.wfile.write(b'x')
                self.wfile.flush()
                time.sleep(1)
            else:
                self.start(200, 5)
                self.wfile.write(b'again')
        except (BrokenPipeError, ConnectionResetError):
            pass


with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        subprocess.run([sys.argv[1], str(server.server_address[1])], check=True, timeout=25)
    finally:
        server.shutdown()
        thread.join()
    assert not violations, violations
    assert requests == Counter(dict.fromkeys(PATHS, 1)), requests
    print(f'{sum(requests.values())} exact loopback GETs. No redirect, credentials, or retry.')
