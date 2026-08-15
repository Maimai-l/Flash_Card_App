"""Filesystem locations: bundled resources and the writable user data directory."""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "KnowledgeCards"


def _detect_base_path() -> Path:
    """Project root in development, the extracted bundle dir under PyInstaller."""
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def _user_data_root() -> Path:
    """
    Per-user writable data directory.

    KC_USER_DATA overrides the platform default; tests and e2e runs use it to
    point the app at a throwaway directory instead of the real user profile.
    """
    override = os.environ.get("KC_USER_DATA")
    if override:
        base = Path(override).expanduser()
    else:
        home = Path.home()
        if sys.platform == "darwin":
            base = home / "Library" / "Application Support" / APP_NAME
        elif sys.platform.startswith("win"):
            base = Path(os.environ.get("APPDATA", home)) / APP_NAME
        else:
            base = Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share")) / APP_NAME
    base.mkdir(parents=True, exist_ok=True)
    return base


BASE_PATH: Path = _detect_base_path()
USER_DATA_ROOT: Path = _user_data_root()

WEB_DIR: Path = BASE_PATH / "web"
SAMPLES_DIR: Path = BASE_PATH / "samples"
DB_PATH: Path = USER_DATA_ROOT / "knowledge.db"
LOG_PATH: Path = USER_DATA_ROOT / "app.log"
