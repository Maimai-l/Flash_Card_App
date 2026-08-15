"""
Entry point: start the local server and open the app in a browser.

    python main.py                run and open a browser
    python main.py --no-browser   run without opening one
    python main.py --port 9000    use a specific port
"""

from __future__ import annotations

import argparse
import logging
import sys
import threading
import webbrowser

from paths import LOG_PATH, WEB_DIR
from version import __version__

DEFAULT_PORT = 8737


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(LOG_PATH, encoding="utf-8")],
    )


def _parse_args(argv):
    parser = argparse.ArgumentParser(description="Knowledge Cards — local flashcard server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    _configure_logging(args.verbose)

    from app.api import Api
    from app.context import AppContext
    from app.server import AppServer, find_free_port

    context = AppContext()
    server = AppServer(str(WEB_DIR), Api(context), find_free_port(args.port)).start()

    logging.info("Knowledge Cards %s", __version__)
    logging.info("Database: %s", context.db_path)
    print(f"\n  Knowledge Cards is running at {server.url}\n  Press Ctrl-C to stop.\n")

    if not args.no_browser:
        threading.Timer(0.4, webbrowser.open, args=(server.url,)).start()

    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\n  Stopping.\n")
        server.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
