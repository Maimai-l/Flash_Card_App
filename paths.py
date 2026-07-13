"""
Utilities for locating bundled resources and a writable user data directory.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

APP_NAME = "FlashCardApp"


def _detect_base_path() -> Path:
    """
    In dev, return project root; in PyInstaller, use the extracted temp dir.
    """
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def _user_data_root() -> Path:
    """
    Return a per-user writable config/data directory.

    The FLASHCARD_USER_DATA environment variable overrides the default
    location. It is used by tests and headless/e2e runs to point the app at
    a throwaway directory instead of the real user profile.
    """
    override = os.environ.get("FLASHCARD_USER_DATA")
    if override:
        base = Path(override).expanduser()
    else:
        home = Path.home()
        if sys.platform == "darwin":
            base = home / "Library" / "Application Support" / APP_NAME
        elif sys.platform.startswith("win"):
            base = Path(os.environ.get("APPDATA", home)) / APP_NAME
        else:
            base = home / f".{APP_NAME.lower()}"
    base.mkdir(parents=True, exist_ok=True)
    return base


BASE_PATH: Path = _detect_base_path()
USER_DATA_ROOT: Path = _user_data_root()
WRITABLE_DATA_ROOT: Path = USER_DATA_ROOT / "data"


# Bump this integer whenever the bundled DB content changes.
# If the user's stored seed version is older, the bundled DB replaces the user DB.
BUNDLE_SEED_VERSION = 1

_SEED_VERSION_FILE = USER_DATA_ROOT / "seed_version"


def _read_user_seed_version() -> int:
    try:
        return int(_SEED_VERSION_FILE.read_text().strip())
    except Exception:
        return 0


def _write_user_seed_version(v: int) -> None:
    _SEED_VERSION_FILE.write_text(str(v))


def ensure_user_data_seeded() -> None:
    """
    Seed user data from the bundled resources when needed.

    Seeding happens when:
      - The user data directory does not exist yet (fresh install), OR
      - The bundled BUNDLE_SEED_VERSION is newer than what was last seeded
        (e.g. the app was reinstalled with an updated word database).

    In the version-mismatch case the bundled DB replaces the user DB so
    testers / new users always start from a known-good baseline.
    """
    src_data = resource_path("data")
    bundled_db = src_data / "database" / "vocabulary.db"

    first_run = not WRITABLE_DATA_ROOT.exists()
    stale_seed = _read_user_seed_version() < BUNDLE_SEED_VERSION

    if first_run:
        if src_data.exists():
            shutil.copytree(src_data, WRITABLE_DATA_ROOT)
        else:
            WRITABLE_DATA_ROOT.mkdir(parents=True, exist_ok=True)
        _write_user_seed_version(BUNDLE_SEED_VERSION)
        return

    if stale_seed and bundled_db.exists():
        # Replace only the DB file — keep other user data (logs, lists, etc.)
        user_db = WRITABLE_DATA_ROOT / "database" / "vocabulary.db"
        user_db.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(bundled_db, user_db)
        _write_user_seed_version(BUNDLE_SEED_VERSION)
        return


def resource_path(*parts: str) -> Path:
    """
    Build an absolute path to a bundled resource.
    """
    return BASE_PATH.joinpath(*parts)


def data_path(*parts: str) -> Path:
    """
    Writable data path under the user directory.
    """
    return WRITABLE_DATA_ROOT.joinpath(*parts)


def res_path(*parts: str) -> Path:
    return resource_path("res", *parts)


def ensure_parent_dir(target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
