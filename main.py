import logging
import os
import threading
import functools
import http.server

import webview

from gui.api import Api
from gui.library import LibraryService
from gui.game_service import GameSessionManager
from data.game_ws_server import GameWsServer
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


def _start_file_server(directory: str, port: int) -> None:
    """Serve gui/web/ over localhost so WKWebView loads CSS/JS without file:// quirks."""
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler,
        directory=directory,
    )
    # suppress request log spam
    handler.log_message = lambda *a: None
    server = http.server.HTTPServer(("127.0.0.1", port), handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()


def main():
    _start_file_server(WEB_DIR, PORT)

    library      = LibraryService()
    ws_server    = GameWsServer()
    ws_server.start()
    game_service = GameSessionManager(library, ws_server=None)
    ws_server.set_game_service(game_service)
    game_service.ws_server = ws_server
    api = Api(library, game_service, ws_server)

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
