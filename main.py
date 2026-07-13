import logging
import os
import threading
import functools
import http.server

from gui.api import Api
from gui.library import LibraryService
from gui.dev_bridge import dev_bridge_enabled, make_handler
from paths import BASE_PATH, USER_DATA_ROOT

_LOG_PATH = USER_DATA_ROOT / "app.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_LOG_PATH, encoding="utf-8"),
    ],
)
logging.info("Resource base path resolved to: %s", BASE_PATH)
logging.info("Log file: %s", _LOG_PATH)

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gui", "web")
PORT = 18765


def _start_file_server(directory: str, port: int, api=None) -> None:
    """
    Serve gui/web/ over localhost so WKWebView loads CSS/JS without file:// quirks.

    When the dev bridge is enabled (FLASHCARD_DEV_BRIDGE=1, non-frozen) and an
    api object is supplied, the same server also answers POST /api so a plain
    browser or Playwright can drive the app without a native window.
    """
    if api is not None and dev_bridge_enabled():
        handler = make_handler(directory, api)
        logging.warning("Dev bridge ENABLED — POST /api is live (development only)")
    else:
        handler = functools.partial(
            http.server.SimpleHTTPRequestHandler,
            directory=directory,
        )
        # suppress request log spam
        handler.log_message = lambda *a: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()


def main():
    library = LibraryService()
    api = Api(library)

    _start_file_server(WEB_DIR, PORT, api)

    # Headless mode for tests / e2e: no native window (pywebview needs a GUI
    # backend that isn't present in CI containers). The HTTP + dev bridge server
    # above is enough to drive the SPA.
    if os.environ.get("FLASHCARD_NO_WINDOW") == "1":
        logging.warning("FLASHCARD_NO_WINDOW=1 — running headless; Ctrl-C to exit")
        import time
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        return

    import webview
    webview.create_window(
        title="FlashCard App",
        url=f"http://127.0.0.1:{PORT}/index.html",
        js_api=api,
        min_size=(900, 600),
        width=1100,
        height=700,
        resizable=True,
        text_select=False,
    )
    webview.start(debug=False)


if __name__ == "__main__":
    main()
