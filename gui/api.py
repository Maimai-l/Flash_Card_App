"""
PyWebView API bridge — all methods callable from JS via window.pywebview.api
"""
import os
import shutil
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
                "FROM Words WHERE vocab = ? COLLATE NOCASE LIMIT 1",
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
                "FROM Words WHERE vocab LIKE ? LIMIT 20",
                (f"{word}%",)
            )
            rows = cursor.fetchall()
            if not rows:
                cursor.execute(
                    "SELECT vocab, definition_zh, example_en, example_zh "
                    "FROM Words WHERE vocab LIKE ? LIMIT 20",
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

    # ── Calendar ────────────────────────────────────────────────────────────

    def get_calendar_info(self):
        try:
            return self.library.get_calender_info()
        except Exception:
            return {}

    # ── Import ──────────────────────────────────────────────────────────────

    def import_clipboard(self, text, bookname, field_sep, entry_sep, new_book):
        try:
            return self.library.import_clipboard(
                text, field_sep, entry_sep, bookname, new_book=new_book
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

    def import_txt(self, path, bookname, field_sep, entry_sep, new_book):
        try:
            return self.library.import_txt(
                path, field_sep, entry_sep, bookname, new_book=new_book
            )
        except Exception as e:
            return str(e)

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
