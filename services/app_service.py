"""
Application state service: app_info.json, the study calendar, session
completion, and the reset operations.

Splits out of the former LibraryService god object. Owns no SQL beyond
delegating resets to the repositories.
"""
import datetime
import json
import logging

from paths import data_path, ensure_parent_dir

logger = logging.getLogger(__name__)

# Preset books created automatically on a fresh install, never by the user.
PRESET_BOOK_NAMES = {"Pre_Generate", "CET_4+6_edited", "TOEFL", "GRE_8000_Words"}

_DEFAULT_APP_INFO = {
    "last_session_date": None,
    "daily_new_limit": 20,
    "selected_book": None,
    "theme": "BLUE",
}


class AppService:
    def __init__(self, db_conn, word_repo, database_dir):
        self.db_conn = db_conn
        self.word_repo = word_repo
        self._database_dir = database_dir
        self._migrate_calendar_filename()
        self.renew_app_info()

    # ── app_info.json ─────────────────────────────────────────────────────────

    def _app_info_path(self):
        return data_path("app_info.json")

    def _initialize_app_info(self):
        path = self._app_info_path()
        ensure_parent_dir(path)
        with open(path, "w", encoding="UTF-8") as f:
            json.dump(dict(_DEFAULT_APP_INFO), f, indent=4)

    def renew_app_info(self):
        """Load app_info, creating or migrating from the legacy format if needed."""
        path = self._app_info_path()
        if not path.exists():
            self._initialize_app_info()
            return
        try:
            with open(path, "r", encoding="UTF-8") as f:
                info = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self._initialize_app_info()
            return

        # Legacy format (had last_open_date / last_learn_date) → modern format.
        if "last_open_date" in info or "last_learn_date" in info:
            new_info = {
                "last_session_date": None,
                "daily_new_limit": info.get("list_length", info.get("daily_new_limit", 20)),
                "selected_book": None,
                "theme": info.get("theme", "BLUE"),
            }
            with open(path, "w", encoding="UTF-8") as f:
                json.dump(new_info, f, indent=4)

    def get_app_info(self):
        from version import APP_VERSION
        with open(self._app_info_path(), "r", encoding="UTF-8") as f:
            info = json.load(f)
        info["app_version"] = APP_VERSION
        return info

    def update_app_info(self, app_info):
        with open(self._app_info_path(), "w", encoding="UTF-8") as f:
            json.dump(app_info, f, indent=4)

    # ── Calendar (renamed from the misspelled "calender") ─────────────────────

    def _calendar_path(self):
        return data_path("calendar_info.json")

    def _migrate_calendar_filename(self):
        """Rename a legacy calender_info.json to calendar_info.json if present."""
        legacy = data_path("calender_info.json")
        new = self._calendar_path()
        try:
            if legacy.exists() and not new.exists():
                legacy.rename(new)
        except Exception as e:
            logger.warning("calendar filename migration failed: %s", e)

    def initialize_calendar_info(self):
        path = self._calendar_path()
        ensure_parent_dir(path)
        with open(path, "w", encoding="UTF-8") as f:
            json.dump({}, f)  # a JSON object, not the string "{}"

    def _load_calendar(self) -> dict:
        path = self._calendar_path()
        if not path.exists():
            return {}
        try:
            with open(path, "r", encoding="UTF-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            data = None
        # Self-heal the historical "{}"-as-a-string corruption or any non-dict.
        if not isinstance(data, dict):
            self.initialize_calendar_info()
            return {}
        return data

    def add_calendar_info(self, value: int):
        data = self._load_calendar()
        data[datetime.date.today().isoformat()] = value
        with open(self._calendar_path(), "w", encoding="UTF-8") as f:
            json.dump(data, f, indent=4)

    def get_calendar_info(self) -> dict:
        return self._load_calendar()

    # ── Session completion ────────────────────────────────────────────────────

    def complete_session(self):
        """Mark today's session done: stamp last_session_date + a calendar dot."""
        info = self.get_app_info()
        info["last_session_date"] = str(datetime.date.today())
        self.update_app_info(info)
        self.add_calendar_info(1)

    # ── Resets ────────────────────────────────────────────────────────────────

    def soft_reset_data(self):
        """Reset progress + remove user-imported books; keep preset books."""
        self.word_repo.reset_progress_and_user_books(PRESET_BOOK_NAMES)
        info = self.get_app_info()
        info["last_session_date"] = None
        self.update_app_info(info)
        self.initialize_calendar_info()

    def reset_data(self):
        """Full factory reset — wipe the database dir and rebuild from scratch."""
        self._initialize_app_info()
        self._delete_dir_contents(self._database_dir)
        self.db_conn.initialize_database()
        self.initialize_calendar_info()

    def _delete_dir_contents(self, folder_path):
        import os
        try:
            if not os.path.exists(folder_path):
                return False
            for item in os.listdir(folder_path):
                item_path = os.path.join(folder_path, item)
                if os.path.isfile(item_path):
                    os.remove(item_path)
                elif os.path.isdir(item_path):
                    self._delete_dir_contents(item_path)
            return True
        except Exception as e:
            logger.exception("Error cleaning folder %s: %s", folder_path, e)
            return False
