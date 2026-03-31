"""
PyWebView API bridge — all methods callable from JS via window.pywebview.api
"""
import os
import shutil
from pathlib import Path
import webview
import data.fsrs_system as fsrs
from gui.library import LibraryService
from paths import USER_DATA_ROOT


class Api:
    def __init__(self, library: LibraryService, game_service=None, ws_server=None):
        self.library      = library
        self.game_service = game_service
        self.ws_server    = ws_server

    # ── App info ────────────────────────────────────────────────────────────

    def get_app_info(self):
        try:
            return self.library.get_app_info()
        except Exception as e:
            return {"error": str(e)}

    def update_app_info(self, app_info):
        try:
            self.library.update_app_info(app_info)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    # ── Books ───────────────────────────────────────────────────────────────

    def get_book_names(self):
        try:
            return [n for n in self.library.get_book_names() if n != "All"]
        except Exception:
            return []

    def create_book(self, name):
        try:
            ok = self.library.book_repo.add_book(name)
            return {"ok": ok, "error": f"Book '{name}' already exists" if not ok else None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_book_complete_percentage(self, book_name):
        try:
            return self.library.get_book_complete_percentage(book_name)
        except Exception:
            return {"Percentage": 0, "Completed": 0, "Total": 0}

    # ── FSRS session ────────────────────────────────────────────────────────

    def get_today_stats(self, book_name=None):
        """
        Automatically checks FSRS due words — no manual trigger needed.
        Returns: new_count, review_count, total_due, today_done, daily_new_limit
        """
        try:
            return self.library.get_today_stats(book_name)
        except Exception as e:
            return {"error": str(e)}

    def get_session_words(self, book_name, limit=20):
        """
        Returns today's combined session words (due reviews + new words).
        FSRS determines what's due — caller just picks a book and daily limit.
        """
        try:
            return self.library.get_session_words(book_name, limit)
        except Exception as e:
            return {"error": str(e)}

    def get_due_words(self, book_name, exclude_words=None):
        """
        Return words that are currently due and NOT in exclude_words.
        Called after every answer to auto-detect words due mid-session.
        exclude_words: list of vocab strings already in the practice queue.
        """
        try:
            return self.library.get_due_words_for_refresh(book_name, exclude_words or [])
        except Exception as e:
            return {"error": str(e)}

    def record_answer(self, word, rating):
        """
        Record one FSRS review answer and immediately update the DB.
        rating: 1=Again, 2=Hard, 3=Good, 4=Easy
        Returns {ok, due_date, stability, difficulty, state} or {error}
        """
        try:
            return fsrs.record_answer(self.library.db_path, word, rating)
        except Exception as e:
            return {"error": str(e)}

    def complete_session(self):
        """Mark today's session as done. Updates app_info and writes calendar entry."""
        try:
            self.library.complete_session()
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    # ── Words-only lookup ────────────────────────────────────────────────────

    def lookup_words(self, raw_text):
        """
        Parse one-word-per-line text, look up each word in the database.
        Returns list of {input, matched, definition, example, chinese, found, method}
        method: 'exact' | 'fuzzy' | 'none'
        """
        import difflib
        import sqlite3

        words = [w.strip().lower() for w in raw_text.splitlines() if w.strip()]
        if not words:
            return []

        results = []
        conn = sqlite3.connect(self.library.db_path)
        cursor = conn.cursor()

        for word in words:
            # 1. Exact match (case-insensitive)
            cursor.execute(
                "SELECT vocab, definition_zh, example_en, example_zh "
                "FROM Words_Effective WHERE vocab = ? COLLATE NOCASE LIMIT 1",
                (word,)
            )
            row = cursor.fetchone()
            if row:
                results.append({
                    "input": word, "matched": row[0],
                    "definition": row[1] or "", "example": row[2] or "",
                    "chinese": row[3] or "", "found": True, "method": "exact",
                })
                continue

            # 2. Starts-with search then pick closest via difflib
            cursor.execute(
                "SELECT vocab, definition_zh, example_en, example_zh "
                "FROM Words_Effective WHERE vocab LIKE ? LIMIT 20",
                (f"{word}%",)
            )
            rows = cursor.fetchall()
            if not rows:
                cursor.execute(
                    "SELECT vocab, definition_zh, example_en, example_zh "
                    "FROM Words_Effective WHERE vocab LIKE ? LIMIT 20",
                    (f"%{word}%",)
                )
                rows = cursor.fetchall()

            if rows:
                vocabs = [r[0] for r in rows]
                close = difflib.get_close_matches(word, vocabs, n=1, cutoff=0.6)
                best_idx = vocabs.index(close[0]) if close else 0
                row = rows[best_idx]
                results.append({
                    "input": word, "matched": row[0],
                    "definition": row[1] or "", "example": row[2] or "",
                    "chinese": row[3] or "", "found": True, "method": "fuzzy",
                })
                continue

            results.append({
                "input": word, "matched": None,
                "definition": "", "example": "", "chinese": "",
                "found": False, "method": "none",
            })

        conn.close()
        return results

    def import_word_matches(self, matches, bookname, new_book):
        """Import pre-looked-up word matches into a book."""
        try:
            if new_book:
                ok = self.library.book_repo.add_book(bookname)
                if not ok:
                    return f"Book '{bookname}' already exists!"
            words_dict = {
                m["matched"]: {
                    "Definition": m.get("definition", ""),
                    "ExampleSentence": m.get("example", ""),
                    "Example_Chinese": m.get("chinese", ""),
                }
                for m in matches
                if m.get("found") and m.get("matched")
            }
            if not words_dict:
                return "No matching words to import."
            self.library.word_repo.add_words_to_book(bookname, words_dict, fetch_missing=False)
            return f"Successfully added {len(words_dict)} words!"
        except Exception as e:
            return str(e)

    # ── Word management ─────────────────────────────────────────────────────

    def get_book_words(self, book_name, offset=0, limit=100, search='', missing_example=False):
        """Return paginated word list for a book. Each item: {id, vocab, definition, example, chinese}."""
        try:
            return self.library.word_repo.get_book_words(
                book_name, offset, limit, search, bool(missing_example))
        except Exception as e:
            return {"error": str(e)}

    def update_word(self, word_id, definition, example, chinese):
        """Store user edits in Word_Overrides (non-destructive). Reset restores originals."""
        try:
            return self.library.word_repo.update_word(int(word_id), definition, example, chinese)
        except Exception as e:
            return {"error": str(e)}

    def apply_word_overrides(self, overrides):
        """
        Bulk-write overrides by vocab name.
        overrides: {vocab: {definition, example, chinese}}
        Only writes non-empty values; never touches the base Words table.
        """
        try:
            return self.library.word_repo.apply_word_overrides(overrides)
        except Exception as e:
            return {"error": str(e)}

    def remove_word_from_book(self, word_id, book_name):
        """Unlink a word from a book without deleting it globally."""
        try:
            return self.library.word_repo.remove_word_from_book(int(word_id), book_name)
        except Exception as e:
            return {"error": str(e)}

    # ── Calendar ────────────────────────────────────────────────────────────

    def get_calendar_info(self):
        try:
            return self.library.get_calender_info()
        except Exception:
            return {}

    # ── Import ──────────────────────────────────────────────────────────────

    def import_clipboard(self, text, bookname, field_sep, entry_sep, new_book, ex_idx=2, cn_idx=3):
        try:
            return self.library.import_clipboard(
                text, field_sep, entry_sep, bookname, new_book=new_book,
                example_field_index=int(ex_idx), example_chinese_field_index=int(cn_idx),
            )
        except Exception as e:
            return str(e)

    def import_excel(self, path, bookname, sheet_name, word_col, def_col, ex_col, cn_col, new_book):
        try:
            return self.library.import_excel(
                path, sheet_name, word_col, def_col, ex_col, cn_col, bookname, new_book=new_book
            )
        except Exception as e:
            return str(e)

    def import_json(self, path, bookname, vocab_key, def_key, ex_key, cn_key, new_book):
        try:
            return self.library.import_json(
                path, vocab_key, def_key, ex_key, cn_key, bookname, new_book=new_book
            )
        except Exception as e:
            return str(e)

    def import_txt(self, path, bookname, field_sep, entry_sep, new_book, ex_idx=2, cn_idx=3):
        try:
            return self.library.import_txt(
                path, field_sep, entry_sep, bookname, new_book=new_book,
                example_field_index=int(ex_idx), example_chinese_field_index=int(cn_idx),
            )
        except Exception as e:
            return str(e)

    def export_data(self):
        """Copy vocabulary.db to a user-chosen location as a backup."""
        db_src = Path(self.library.db_path)
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
        import sqlite3 as _sqlite3
        db_dest = Path(self.library.db_path)
        src = Path(src_path)
        if not src.exists():
            return {"error": "File not found."}
        # Minimal sanity check: confirm it's a SQLite3 file
        try:
            with open(src, "rb") as f:
                magic = f.read(16)
            if not magic.startswith(b"SQLite format 3"):
                return {"error": "File does not appear to be a valid SQLite database."}
        except Exception as e:
            return {"error": str(e)}
        try:
            # Back up current db just in case
            backup_path = db_dest.parent / "vocabulary.db.pre_import"
            if db_dest.exists():
                shutil.copy2(db_dest, backup_path)
            shutil.copy2(src, db_dest)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def export_log(self):
        """Open a save-file dialog and copy app.log to the chosen location."""
        log_src = USER_DATA_ROOT / "app.log"
        if not log_src.exists():
            return {"error": "No log file found."}
        try:
            result = webview.windows[0].create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename="flashcardapp.log",
            )
            dest = result[0] if isinstance(result, (list, tuple)) else result
            if not dest:
                return {"cancelled": True}
            shutil.copy2(log_src, dest)
            return {"ok": True, "path": dest}
        except Exception as e:
            return {"error": str(e)}

    def open_file_dialog(self, file_types=None):
        try:
            types = tuple(file_types) if file_types else ("All files (*.*)",)
            result = webview.windows[0].create_file_dialog(
                webview.FileDialog.OPEN,
                allow_multiple=False,
                file_types=types,
            )
            return result[0] if result else None
        except Exception:
            return None

    # ── Update check ────────────────────────────────────────────────────────

    def check_for_updates(self):
        """
        Fetch the latest GitHub release and compare with local APP_VERSION.
        Returns {up_to_date, current, latest, download_url, asset_url, release_notes} or {error}.
        asset_url is the direct zip download link (if found in release assets).
        """
        import urllib.request
        import json as _json
        from version import APP_VERSION

        RELEASES_API = "https://api.github.com/repos/Maimai-l/Flash_Card_App/releases/latest"
        RELEASES_PAGE = "https://github.com/Maimai-l/Flash_Card_App/releases/latest"

        try:
            req = urllib.request.Request(
                RELEASES_API,
                headers={"User-Agent": "FlashCardApp-updater/1.0",
                         "Accept": "application/vnd.github+json"},
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = _json.loads(resp.read().decode())

            latest_tag    = data.get("tag_name", "").lstrip("v")
            release_notes = data.get("body", "").strip()
            download_url  = data.get("html_url", RELEASES_PAGE)

            # Find direct zip asset (e.g. FlashCardApp-mac.zip)
            asset_url = None
            for asset in data.get("assets", []):
                name = asset.get("name", "").lower()
                if name.endswith(".zip") and "mac" in name:
                    asset_url = asset.get("browser_download_url")
                    break

            def _ver_tuple(v):
                try:
                    return tuple(int(x) for x in v.split("."))
                except Exception:
                    return (0,)

            up_to_date = _ver_tuple(APP_VERSION) >= _ver_tuple(latest_tag)
            return {
                "up_to_date":     up_to_date,
                "current":        APP_VERSION,
                "latest":         latest_tag,
                "download_url":   download_url,
                "asset_url":      asset_url,
                "release_notes":  release_notes[:400] if release_notes else "",
            }
        except Exception as e:
            return {"error": str(e)}

    # Shared progress state for the active download (only one at a time)
    _update_progress = {"state": "idle", "pct": 0, "error": None}

    def get_update_progress(self):
        """JS polls this to track download progress."""
        return dict(self._update_progress)

    def download_and_install_update(self, asset_url: str):
        """
        Download the zip from asset_url in a background thread, then:
          1. Write updater.sh to a temp dir
          2. Launch updater.sh as an independent process
          3. Quit the app

        JS should poll get_update_progress() to track state:
          state: 'downloading' | 'extracting' | 'launching' | 'done' | 'error'
          pct:   0-100 (download progress)
          error: str or null
        """
        import sys
        import tempfile
        import threading
        import urllib.request
        import zipfile

        if not asset_url:
            return {"error": "No download URL available for this release."}

        Api._update_progress = {"state": "downloading", "pct": 0, "error": None}

        def _run():
            try:
                # ── 1. Download ──────────────────────────────────────────
                cache_dir = Path(tempfile.gettempdir()) / "FlashCardApp_update"
                cache_dir.mkdir(parents=True, exist_ok=True)
                zip_path  = cache_dir / "update.zip"
                extract_dir = cache_dir / "extracted"

                req = urllib.request.Request(
                    asset_url,
                    headers={"User-Agent": "FlashCardApp-updater/1.0"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    total = int(resp.headers.get("Content-Length", 0))
                    downloaded = 0
                    with open(zip_path, "wb") as f:
                        while True:
                            chunk = resp.read(65536)
                            if not chunk:
                                break
                            f.write(chunk)
                            downloaded += len(chunk)
                            if total:
                                Api._update_progress["pct"] = int(downloaded / total * 90)

                Api._update_progress = {"state": "extracting", "pct": 90, "error": None}

                # ── 2. Validate zip ──────────────────────────────────────
                if not zipfile.is_zipfile(zip_path):
                    raise ValueError("Downloaded file is not a valid zip archive.")

                # ── 3. Find app install path ─────────────────────────────
                if getattr(sys, "frozen", False):
                    # Running as .app bundle: executable is .app/Contents/MacOS/FlashCardApp
                    app_path = Path(sys.executable).parent.parent.parent
                else:
                    # Dev mode: fall back to /Applications for testing
                    app_path = Path("/Applications/FlashCardApp.app")

                # ── 4. Write updater.sh ──────────────────────────────────
                updater_path = cache_dir / "updater.sh"
                updater_script = f"""#!/bin/bash
set -e
APP_PATH="{app_path}"
ZIP_PATH="{zip_path}"
EXTRACT_DIR="{extract_dir}"

sleep 2

# Extract
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
unzip -o "$ZIP_PATH" -d "$EXTRACT_DIR"

# Find the .app
EXTRACTED_APP=$(find "$EXTRACT_DIR" -name "*.app" -maxdepth 3 | head -1)
if [ -z "$EXTRACTED_APP" ]; then
    echo "ERROR: No .app found in zip" >&2
    exit 1
fi

# Replace
APP_PARENT=$(dirname "$APP_PATH")
rm -rf "$APP_PATH"
cp -R "$EXTRACTED_APP" "$APP_PARENT/"

# Clear macOS quarantine
xattr -cr "$APP_PATH" 2>/dev/null || true

# Relaunch
open "$APP_PATH"

# Cleanup
rm -rf "$EXTRACT_DIR" "$ZIP_PATH"
"""
                updater_path.write_text(updater_script)
                updater_path.chmod(0o755)

                Api._update_progress = {"state": "launching", "pct": 100, "error": None}

                # ── 5. Launch updater and quit ───────────────────────────
                import subprocess
                subprocess.Popen(
                    ["bash", str(updater_path)],
                    start_new_session=True,   # detach from current process group
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )

                Api._update_progress = {"state": "done", "pct": 100, "error": None}

                import time; time.sleep(0.5)
                # Quit the app
                webview.windows[0].destroy()

            except Exception as e:
                Api._update_progress = {"state": "error", "pct": 0, "error": str(e)}

        threading.Thread(target=_run, daemon=True).start()
        return {"ok": True}

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

    # ── Debug ────────────────────────────────────────────────────────────────

    def get_debug_words(self, book_name=None, limit=20):
        """Debug: return N random words ignoring FSRS scheduling."""
        try:
            return self.library.get_debug_words(book_name, limit)
        except Exception as e:
            return {"error": str(e)}

    def get_db_stats(self):
        """Debug: schema version, word counts, FSRS state distribution."""
        try:
            return self.library.get_db_stats()
        except Exception as e:
            return {"error": str(e)}

    # ── Settings ────────────────────────────────────────────────────────────

    def soft_reset(self):
        """Reset progress + remove user-imported books; keep preset books."""
        try:
            self.library.soft_reset_data()
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def reset_data(self):
        """Full factory reset — wipes everything and rebuilds from scratch."""
        try:
            self.library.reset_data()
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    # ── Games ────────────────────────────────────────────────────────────────

    def get_unity_games(self):
        """
        Scan gui/web/unity_games/ for WebGL builds.
        Each sub-folder containing index.html is a valid game.
        Returns [{name, url}] served via the existing HTTP server on port 18765.
        """
        import os
        web_dir   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
        unity_dir = os.path.join(web_dir, "unity_games")
        if not os.path.isdir(unity_dir):
            return []
        games = []
        for name in sorted(os.listdir(unity_dir)):
            if os.path.isfile(os.path.join(unity_dir, name, "index.html")):
                games.append({
                    "name": name,
                    "url":  f"http://127.0.0.1:18765/unity_games/{name}/index.html",
                })
        return games

    def get_game_list(self):
        """Return all registered game types."""
        try:
            if not self.game_service:
                return {"error": "Game service not available"}
            return self.game_service.get_game_list()
        except Exception as e:
            return {"error": str(e)}

    def start_game_session(self, game_id, book_name, config=None):
        """
        Create a game session and select words.
        Returns {ok, session_id, words, config, word_count} or {error}.
        """
        try:
            if not self.game_service:
                return {"error": "Game service not available"}
            return self.game_service.create_session(game_id, book_name, config or {})
        except Exception as e:
            return {"error": str(e)}

    def submit_game_results(self, session_id, results):
        """
        Submit per-word results, apply FSRS updates, mark session COMPLETE.
        results: [{word, correct, elapsed_s, skipped?}]
        Returns {ok, fsrs_updated, score, accuracy, session_id} or {error}.
        """
        try:
            if not self.game_service:
                return {"error": "Game service not available"}
            return self.game_service.submit_results(session_id, results)
        except Exception as e:
            return {"error": str(e)}

    def get_session_result(self, session_id):
        """Return stored result for a completed/abandoned session."""
        try:
            if not self.game_service:
                return {"error": "Game service not available"}
            return self.game_service.get_session_result(session_id)
        except Exception as e:
            return {"error": str(e)}

    def get_ws_server_info(self):
        """Return WebSocket server status {running, port, url, clients}."""
        try:
            if not self.ws_server:
                return {"running": False, "port": 18766, "url": "ws://127.0.0.1:18766", "clients": 0}
            return self.ws_server.get_status()
        except Exception as e:
            return {"error": str(e)}

    def launch_unity_game(self, game_id, unity_exe_path, config=None):
        """
        Spawn the Unity executable as a subprocess.
        config must contain session_id from start_game_session.
        Returns {ok, pid, session_id} or {error}.
        """
        try:
            if not self.game_service:
                return {"error": "Game service not available"}
            return self.game_service.launch_unity(game_id, unity_exe_path, config or {})
        except Exception as e:
            return {"error": str(e)}
