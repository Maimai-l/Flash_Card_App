"""
PyWebView API bridge — the single js_api object exposed to the SPA. Every
method here is a thin delegation to a service on the AppContext; the shared
error boundary lives in the @api_call decorator so each method reads as one line.

`webview` is imported lazily inside the few methods that need the native window
(file dialogs), so the bridge stays importable in headless/test environments.
"""
import functools
import logging
import shutil
from pathlib import Path

from paths import USER_DATA_ROOT

logger = logging.getLogger(__name__)

# Sentinels for the @api_call fallback: default returns {"error": str(e)};
# ERROR_STR returns the bare str(e) (some import methods return plain strings).
_ERROR_DICT = object()
_ERROR_STR = object()


def api_call(fallback=_ERROR_DICT):
    """Wrap an API method so exceptions become the method's documented error shape."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(self, *args, **kwargs):
            try:
                return fn(self, *args, **kwargs)
            except Exception as e:
                logger.exception("API %s failed", fn.__name__)
                if fallback is _ERROR_DICT:
                    return {"error": str(e)}
                if fallback is _ERROR_STR:
                    return str(e)
                return fallback() if callable(fallback) else fallback
        return wrapper
    return deco


class Api:
    def __init__(self, context):
        self.ctx = context

    # ── App info ──────────────────────────────────────────────────────────────

    @api_call()
    def get_app_info(self):
        return self.ctx.app.get_app_info()

    @api_call()
    def update_app_info(self, app_info):
        self.ctx.app.update_app_info(app_info)
        return {"ok": True}

    # ── Books ─────────────────────────────────────────────────────────────────

    @api_call(fallback=[])
    def get_book_names(self):
        return [n for n in self.ctx.study.get_book_names() if n != "All"]

    def create_book(self, name):
        try:
            ok = self.ctx.book_repo.add_book(name)
            return {"ok": ok, "error": f"Book '{name}' already exists" if not ok else None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @api_call(fallback={"Percentage": 0, "Completed": 0, "Total": 0})
    def get_book_complete_percentage(self, book_name):
        return self.ctx.study.get_book_complete_percentage(book_name)

    # ── FSRS session ──────────────────────────────────────────────────────────

    @api_call()
    def get_today_stats(self, book_name=None):
        return self.ctx.study.get_today_stats(book_name)

    @api_call()
    def get_session_words(self, book_name, limit=20):
        return self.ctx.study.get_session_words(book_name, limit)

    @api_call()
    def get_due_words(self, book_name, exclude_words=None):
        return self.ctx.study.get_due_words_for_refresh(book_name, exclude_words or [])

    @api_call()
    def record_answer(self, word, rating):
        """rating: 1=Again, 2=Hard, 3=Good, 4=Easy."""
        return self.ctx.fsrs.record_answer(word, rating)

    @api_call()
    def complete_session(self):
        self.ctx.app.complete_session()
        return {"ok": True}

    # ── Words-only lookup / import ────────────────────────────────────────────

    @api_call(fallback=[])
    def lookup_words(self, raw_text):
        return self.ctx.imports.lookup_words(raw_text)

    @api_call(fallback=_ERROR_STR)
    def import_word_matches(self, matches, bookname, new_book):
        return self.ctx.imports.import_word_matches(matches, bookname, new_book)

    # ── Word management ───────────────────────────────────────────────────────

    @api_call()
    def get_book_words(self, book_name, offset=0, limit=100, search='', missing_example=False):
        return self.ctx.word_repo.get_book_words(
            book_name, offset, limit, search, bool(missing_example))

    @api_call()
    def update_word(self, word_id, definition, example, chinese):
        return self.ctx.word_repo.update_word(int(word_id), definition, example, chinese)

    @api_call()
    def apply_word_overrides(self, overrides):
        return self.ctx.word_repo.apply_word_overrides(overrides)

    @api_call()
    def remove_word_from_book(self, word_id, book_name):
        return self.ctx.word_repo.remove_word_from_book(int(word_id), book_name)

    # ── Calendar ──────────────────────────────────────────────────────────────

    @api_call(fallback={})
    def get_calendar_info(self):
        return self.ctx.app.get_calendar_info()

    # ── Import (files / clipboard) ────────────────────────────────────────────

    @api_call(fallback=_ERROR_STR)
    def import_clipboard(self, text, bookname, field_sep, entry_sep, new_book, ex_idx=2, cn_idx=3):
        return self.ctx.imports.import_clipboard(
            text, field_sep, entry_sep, bookname, new_book=new_book,
            example_field_index=int(ex_idx), example_chinese_field_index=int(cn_idx))

    @api_call(fallback=_ERROR_STR)
    def import_excel(self, path, bookname, sheet_name, word_col, def_col, ex_col, cn_col, new_book):
        return self.ctx.imports.import_excel(
            path, sheet_name, word_col, def_col, ex_col, cn_col, bookname, new_book=new_book)

    @api_call(fallback=_ERROR_STR)
    def import_json(self, path, bookname, vocab_key, def_key, ex_key, cn_key, new_book):
        return self.ctx.imports.import_json(
            path, vocab_key, def_key, ex_key, cn_key, bookname, new_book=new_book)

    @api_call(fallback=_ERROR_STR)
    def import_txt(self, path, bookname, field_sep, entry_sep, new_book, ex_idx=2, cn_idx=3):
        return self.ctx.imports.import_txt(
            path, field_sep, entry_sep, bookname, new_book=new_book,
            example_field_index=int(ex_idx), example_chinese_field_index=int(cn_idx))

    # ── Data export / import (native dialogs) ─────────────────────────────────

    def export_data(self):
        """Copy vocabulary.db to a user-chosen location as a backup."""
        import webview
        db_src = Path(self.ctx.db_path)
        if not db_src.exists():
            return {"error": "Database file not found."}
        try:
            result = webview.windows[0].create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename="flashcard_backup.db",
                file_types=("Database files (*.db)", "All files (*.*)"),
            )
            dest = result[0] if isinstance(result, (list, tuple)) else result
            if not dest:
                return {"cancelled": True}
            shutil.copy2(db_src, dest)
            return {"ok": True, "path": dest}
        except Exception as e:
            return {"error": str(e)}

    def import_data(self, src_path: str):
        """Replace vocabulary.db with the user-supplied backup. App must restart."""
        db_dest = Path(self.ctx.db_path)
        src = Path(src_path)
        if not src.exists():
            return {"error": "File not found."}
        try:
            with open(src, "rb") as f:
                magic = f.read(16)
            if not magic.startswith(b"SQLite format 3"):
                return {"error": "File does not appear to be a valid SQLite database."}
        except Exception as e:
            return {"error": str(e)}
        try:
            backup_path = db_dest.parent / "vocabulary.db.pre_import"
            if db_dest.exists():
                shutil.copy2(db_dest, backup_path)
            shutil.copy2(src, db_dest)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def export_log(self):
        """Open a save-file dialog and copy app.log to the chosen location."""
        import webview
        log_src = USER_DATA_ROOT / "app.log"
        if not log_src.exists():
            return {"error": "No log file found."}
        try:
            result = webview.windows[0].create_file_dialog(
                webview.FileDialog.SAVE, save_filename="flashcardapp.log")
            dest = result[0] if isinstance(result, (list, tuple)) else result
            if not dest:
                return {"cancelled": True}
            shutil.copy2(log_src, dest)
            return {"ok": True, "path": dest}
        except Exception as e:
            return {"error": str(e)}

    def open_file_dialog(self, file_types=None):
        import webview
        try:
            types = tuple(file_types) if file_types else ("All files (*.*)",)
            result = webview.windows[0].create_file_dialog(
                webview.FileDialog.OPEN, allow_multiple=False, file_types=types)
            return result[0] if result else None
        except Exception:
            return None

    # ── Updates ───────────────────────────────────────────────────────────────

    @api_call()
    def check_for_updates(self):
        return self.ctx.updates.check_for_updates()

    def get_update_progress(self):
        return self.ctx.updates.get_update_progress()

    @api_call()
    def download_and_install_update(self, asset_url: str):
        return self.ctx.updates.download_and_install_update(asset_url)

    def open_url(self, url):
        """Open a URL in the system default browser."""
        import subprocess
        import sys
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["open", url])
            elif sys.platform.startswith("win"):
                subprocess.Popen(["start", url], shell=True)
            else:
                subprocess.Popen(["xdg-open", url])
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    # ── Debug ─────────────────────────────────────────────────────────────────

    @api_call()
    def get_debug_words(self, book_name=None, limit=20):
        return self.ctx.study.get_debug_words(book_name, limit)

    @api_call()
    def get_db_stats(self):
        return self.ctx.study.get_db_stats()

    # ── Settings ──────────────────────────────────────────────────────────────

    @api_call()
    def soft_reset(self):
        self.ctx.app.soft_reset_data()
        return {"ok": True}

    @api_call()
    def reset_data(self):
        self.ctx.app.reset_data()
        return {"ok": True}
