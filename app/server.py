"""
The local web server.

Serves the SPA from web/ and answers POST /api with JSON. It listens on the
loopback interface only, and rejects any request carrying a cross-origin
`Origin` header, so a page open in another tab cannot reach in and drive the
app behind your back.
"""

from __future__ import annotations

import http.server
import json
import logging
import socket
import threading
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

MAX_BODY_BYTES = 32 * 1024 * 1024  # generous: a big card paste is still just text
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}


def _origin_is_local(origin: str, port: int) -> bool:
    if not origin or origin == "null":
        return True  # same-origin fetch from a file-less page sends no Origin
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False
    return parsed.hostname in {"127.0.0.1", "localhost", "::1"} and parsed.port == port


def make_handler(web_dir: str, api: object):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=web_dir, **kwargs)

        def log_message(self, *args):
            pass  # the app log is for the app, not for request spam

        def end_headers(self):
            # The SPA and its data are local-only; keep both out of any cache
            # so an edit is never masked by a stale response.
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            super().end_headers()

        def do_POST(self):
            if urlparse(self.path).path.rstrip("/") != "/api":
                self.send_error(404, "Not found")
                return
            bound_port = self.server.server_address[1]
            if not _origin_is_local(self.headers.get("Origin", ""), bound_port):
                self.send_error(403, "Cross-origin requests are not allowed")
                return

            try:
                length = int(self.headers.get("Content-Length", 0))
            except ValueError:
                length = 0
            if length > MAX_BODY_BYTES:
                self._write_json({"error": "Request too large"}, status=413)
                return

            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
                method = payload.get("method", "")
                args = payload.get("args") or []
                kwargs = payload.get("kwargs") or {}
                handler = getattr(api, method, None)
                if not method or method.startswith("_") or not callable(handler):
                    result = {"error": f"Unknown API method: {method!r}"}
                else:
                    result = handler(*args, **kwargs)
            except Exception as exc:
                logger.exception("API dispatch failed")
                result = {"error": str(exc)}
            self._write_json(result)

        def _write_json(self, obj, status: int = 200):
            body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


class AppServer:
    def __init__(self, web_dir: str, api: object, port: int, host: str = "127.0.0.1"):
        self.web_dir = str(web_dir)
        self.api = api
        self.host = host
        self.port = port
        self._httpd = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    def start(self, background: bool = True) -> "AppServer":
        handler = make_handler(self.web_dir, self.api)
        self._httpd = http.server.ThreadingHTTPServer((self.host, self.port), handler)
        self._httpd.daemon_threads = True
        # Port 0 means "any free port"; read back what the OS actually gave us.
        self.port = self._httpd.server_address[1]
        if background:
            thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
            thread.start()
        else:
            self._httpd.serve_forever()
        return self

    def stop(self) -> None:
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None


def find_free_port(preferred: int, host: str = "127.0.0.1") -> int:
    """Use the preferred port when it is free, otherwise let the OS pick one."""
    if preferred and preferred > 0:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, preferred))
                return preferred
            except OSError:
                pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]
