"""
Development-only HTTP JSON bridge.

Lets a plain browser (or a Playwright e2e run) call the very same ``Api``
object that pywebview exposes to the SPA, by POSTing::

    {"method": "get_app_info", "args": []}

to ``/api``. The response is the JSON-encoded return value.

This exists purely so the front-end can be driven without a native pywebview
window (which cannot open in a headless container). It is double-gated:

  * only wired up when ``FLASHCARD_DEV_BRIDGE=1`` is set, AND
  * never in a frozen PyInstaller build (``sys.frozen``),

so it can never be reached in a shipped release.
"""
from __future__ import annotations

import http.server
import json
import logging
import sys

logger = logging.getLogger(__name__)


def dev_bridge_enabled() -> bool:
    """True only when explicitly opted in and not running as a frozen app."""
    import os
    return os.environ.get("FLASHCARD_DEV_BRIDGE") == "1" and not getattr(sys, "frozen", False)


def make_handler(directory: str, api: object):
    """
    Build a request handler that serves static files from *directory* and
    dispatches ``POST /api`` calls to *api*.
    """

    class DevBridgeHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)

        def log_message(self, *args):  # silence request-log spam
            pass

        def do_POST(self):
            if self.path.rstrip("/") != "/api":
                self.send_error(404, "Not found")
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length else b"{}"
                payload = json.loads(raw or b"{}")
                method = payload.get("method", "")
                args = payload.get("args", []) or []
                fn = getattr(api, method, None)
                if not method or method.startswith("_") or not callable(fn):
                    result = {"error": f"Unknown API method: {method!r}"}
                else:
                    result = fn(*args)
            except Exception as e:  # never let the dev server 500 opaquely
                logger.exception("dev bridge call failed")
                result = {"error": str(e)}
            self._write_json(result)

        def _write_json(self, obj):
            body = json.dumps(obj).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return DevBridgeHandler
