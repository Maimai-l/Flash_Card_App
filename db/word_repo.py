import logging
import sqlite3

logger = logging.getLogger(__name__)

# The canonical word-dict shape shared across the whole app (session words,
# learned words, game pool, etc.). SELECT columns and the row->dict mapper are
# defined once here so the study/game services never hand-roll them.
_WORD_COLS = ("vocab, definition_zh, example_en, example_zh, "
              "phone_us, phone_uk, stability, difficulty, due_date, fsrs_state")


def _row_to_word_dict(r) -> dict:
    return {
        "word": r[0], "definition": r[1] or "",
        "example": r[2] or "", "chinese": r[3] or "",
        "phone_us": r[4] or "", "phone_uk": r[5] or "",
        "stability": r[6] or 0, "difficulty": r[7] or 0,
        "due_date": r[8], "state": r[9] or 0,
    }


class WordRepository:
    def __init__(self, db_path: str):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    # ── Word-list queries (single source of the book-filter + row-mapping) ────

    @staticmethod
    def _is_book_scoped(book_name) -> bool:
        return bool(book_name) and book_name != "All"

    def _query_words(self, where: str, params=(), order: str = "", book_name=None) -> list:
        """
        Run a Words_Effective query returning the canonical word-dict list.

        *where* is the predicate on the word row (using column names without a
        table alias). When *book_name* is book-scoped, the query is rewritten to
        join through Word_Book_Words/Word_Book and the predicate is alias-qualified
        with ``w.``.
        """
        conn = self._connect()
        cur = conn.cursor()
        if self._is_book_scoped(book_name):
            cols = ", ".join(f"w.{c}" for c in _WORD_COLS.replace(" ", "").split(","))
            w_where = where.replace("__A__", "w.")
            sql = (f"SELECT {cols} FROM Words_Effective w "
                   "JOIN Word_Book_Words wbw ON w.word_id = wbw.word_id "
                   "JOIN Word_Book wb ON wbw.book_id = wb.book_id "
                   f"WHERE wb.book_name = ? AND {w_where}")
            if order:
                sql += " " + order.replace("__A__", "w.")
            cur.execute(sql, (book_name, *params))
        else:
            sql = f"SELECT {_WORD_COLS} FROM Words_Effective WHERE {where.replace('__A__', '')}"
            if order:
                sql += " " + order.replace("__A__", "")
            cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [_row_to_word_dict(r) for r in rows]

    def get_session_words(self, book_name, new_limit: int = 20) -> list:
        """Due reviews (oldest first) followed by up to new_limit unseen words."""
        review = self._query_words(
            "__A__fsrs_state > 0 AND date(__A__due_date) <= date('now')",
            order="ORDER BY __A__due_date ASC", book_name=book_name,
        )
        new = self._query_words(
            "__A__due_date IS NULL",
            params=(new_limit,), order="ORDER BY RANDOM() LIMIT ?", book_name=book_name,
        )
        return review + new

    def get_due_for_refresh(self, book_name, exclude_words=None) -> list:
        exclude = [w.lower() for w in (exclude_words or [])]
        where = "__A__fsrs_state > 0 AND date(__A__due_date) <= date('now')"
        params = []
        if exclude:
            ph = ",".join("?" * len(exclude))
            where += f" AND lower(__A__vocab) NOT IN ({ph})"
            params = exclude
        return self._query_words(where, params=tuple(params),
                                 order="ORDER BY __A__due_date ASC", book_name=book_name)

    def get_learned_words(self, book_name, limit: int = 20) -> list:
        """Random words reviewed at least once (fsrs_state > 0)."""
        return self._query_words("__A__fsrs_state > 0", params=(limit,),
                                 order="ORDER BY RANDOM() LIMIT ?", book_name=book_name)

    def get_random_words(self, book_name, limit: int = 20) -> list:
        """Random words ignoring FSRS state (debug / padding)."""
        return self._query_words("1=1", params=(limit,),
                                 order="ORDER BY RANDOM() LIMIT ?", book_name=book_name)

    # ── Counts / stats ────────────────────────────────────────────────────────

    def count_new_words(self, book_name) -> int:
        conn = self._connect()
        cur = conn.cursor()
        if self._is_book_scoped(book_name):
            cur.execute("""
                SELECT COUNT(*) FROM Words_Effective w
                JOIN Word_Book_Words wbw ON w.word_id = wbw.word_id
                JOIN Word_Book wb ON wbw.book_id = wb.book_id
                WHERE wb.book_name = ? AND w.due_date IS NULL
            """, (book_name,))
        else:
            cur.execute("SELECT COUNT(*) FROM Words WHERE due_date IS NULL")
        n = cur.fetchone()[0]
        conn.close()
        return n

    def count_due_reviews(self, book_name) -> int:
        conn = self._connect()
        cur = conn.cursor()
        if self._is_book_scoped(book_name):
            cur.execute("""
                SELECT COUNT(*) FROM Words_Effective w
                JOIN Word_Book_Words wbw ON w.word_id = wbw.word_id
                JOIN Word_Book wb ON wbw.book_id = wb.book_id
                WHERE wb.book_name = ? AND w.fsrs_state > 0
                  AND date(w.due_date) <= date('now')
            """, (book_name,))
        else:
            cur.execute("SELECT COUNT(*) FROM Words WHERE fsrs_state > 0 "
                        "AND date(due_date) <= date('now')")
        n = cur.fetchone()[0]
        conn.close()
        return n

    def get_overview_stats(self) -> dict:
        """Schema version, word counts, FSRS state distribution, per-book counts."""
        conn = self._connect()
        cur = conn.cursor()
        try:
            cur.execute("SELECT MAX(version) FROM schema_version")
            schema_ver = cur.fetchone()[0] or 0
        except Exception:
            schema_ver = 0
        cur.execute("SELECT COUNT(*) FROM Words")
        total_words = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM Words WHERE definition_zh IS NOT NULL AND definition_zh != ''")
        words_with_def = cur.fetchone()[0]
        cur.execute("SELECT fsrs_state, COUNT(*) FROM Words GROUP BY fsrs_state ORDER BY fsrs_state")
        labels = {0: "New", 1: "Learning", 2: "Review", 3: "Relearning"}
        state_dist = {labels.get(s, f"State{s}"): c for s, c in cur.fetchall()}
        cur.execute("SELECT COUNT(*) FROM Words WHERE fsrs_state > 0 AND date(due_date) <= date('now')")
        due_now = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM Words WHERE due_date IS NULL")
        never_seen = cur.fetchone()[0]
        cur.execute("""
            SELECT wb.book_name, COUNT(wbw.word_id)
            FROM Word_Book wb LEFT JOIN Word_Book_Words wbw ON wb.book_id = wbw.book_id
            GROUP BY wb.book_id ORDER BY wb.book_name
        """)
        books = [{"name": r[0], "count": r[1]} for r in cur.fetchall()]
        conn.close()
        return {
            "schema_version": schema_ver,
            "total_words": total_words,
            "words_with_definition": words_with_def,
            "due_now": due_now,
            "never_seen": never_seen,
            "fsrs_states": state_dist,
            "books": books,
        }

    # ── FSRS field access (used by the FSRS service) ──────────────────────────

    def get_fsrs_fields(self, vocab: str):
        """Return (stability, difficulty, due_date, last_review, fsrs_state, fsrs_step) or None."""
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            "SELECT stability, difficulty, due_date, last_review, fsrs_state, fsrs_step "
            "FROM Words WHERE vocab = ? COLLATE NOCASE LIMIT 1",
            (vocab,),
        )
        row = cur.fetchone()
        conn.close()
        return row

    def update_fsrs_fields(self, vocab, stability, difficulty, due_date,
                           last_review, fsrs_state, fsrs_step) -> None:
        conn = self._connect()
        conn.execute(
            "UPDATE Words SET stability=?, difficulty=?, due_date=?, last_review=?, "
            "fsrs_state=?, fsrs_step=?, updated_time=datetime('now') "
            "WHERE vocab = ? COLLATE NOCASE",
            (stability, difficulty, due_date, last_review, fsrs_state, fsrs_step, vocab),
        )
        conn.commit()
        conn.close()

    # ── Lookup / search ───────────────────────────────────────────────────────

    def find_exact(self, vocab: str):
        """Exact (case-insensitive) match → (vocab, def_zh, ex_en, ex_zh) or None."""
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            "SELECT vocab, definition_zh, example_en, example_zh "
            "FROM Words_Effective WHERE vocab = ? COLLATE NOCASE LIMIT 1",
            (vocab,),
        )
        row = cur.fetchone()
        conn.close()
        return row

    def find_like(self, vocab: str, limit: int = 20) -> list:
        """Prefix search, falling back to substring; rows are (vocab, def, ex, ex_zh)."""
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            "SELECT vocab, definition_zh, example_en, example_zh "
            "FROM Words_Effective WHERE vocab LIKE ? LIMIT ?",
            (f"{vocab}%", limit),
        )
        rows = cur.fetchall()
        if not rows:
            cur.execute(
                "SELECT vocab, definition_zh, example_en, example_zh "
                "FROM Words_Effective WHERE vocab LIKE ? LIMIT ?",
                (f"%{vocab}%", limit),
            )
            rows = cur.fetchall()
        conn.close()
        return rows

    def add_words_to_book(self, book_name: str, words_dict: dict, fetch_missing: bool = False) -> dict:
        """
        Add words to a specific word book.

        Args:
            book_name: Name of the word book
            words_dict: {word: {"Definition": ..., "ExampleSentence": ..., "Example_Chinese": ...}}
            fetch_missing: Deprecated — kept for call-site compatibility, has no effect

        Returns:
            Dictionary with operation results
        """
        try:
            conn = self._connect()
            cursor = conn.cursor()

            # Get or create book
            cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
            book_row = cursor.fetchone()
            if not book_row:
                cursor.execute("INSERT INTO Word_Book (book_name) VALUES (?)", (book_name,))
                book_id = cursor.lastrowid
                conn.commit()
            else:
                book_id = book_row[0]

            # Also get User_Import book id for dual-linking
            cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = 'User_Import'")
            user_import_row = cursor.fetchone()
            user_import_id = user_import_row[0] if user_import_row else None

            results = {
                "added": [], "updated": [], "skipped": [], "failed": [],
                "book_name": book_name, "book_id": book_id,
            }

            for vocab, word_data in words_dict.items():
                try:
                    vocab = vocab.strip().lower()
                    if not vocab:
                        continue

                    definition_zh = word_data.get("Definition", "").strip()
                    example_en = word_data.get("ExampleSentence", "").strip()
                    example_zh = word_data.get("Example_Chinese", "").strip()

                    phone_us = word_data.get("phone_us", "")
                    phone_uk = word_data.get("phone_uk", "")

                    # Check if word already exists
                    cursor.execute("SELECT word_id FROM Words WHERE vocab = ?", (vocab,))
                    existing = cursor.fetchone()

                    if existing:
                        word_id = existing[0]
                        # Check if already linked to this book
                        cursor.execute(
                            "SELECT 1 FROM Word_Book_Words WHERE book_id = ? AND word_id = ?",
                            (book_id, word_id),
                        )
                        if cursor.fetchone():
                            results["skipped"].append(vocab)
                        else:
                            # Link to this book
                            cursor.execute(
                                "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                                (book_id, word_id),
                            )
                            results["added"].append(vocab)
                    else:
                        # Insert new word
                        cursor.execute("""
                            INSERT INTO Words (vocab, definition_zh, example_en, example_zh, phone_us, phone_uk)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """, (vocab, definition_zh, example_en, example_zh, phone_us, phone_uk))
                        word_id = cursor.lastrowid

                        # Link to target book
                        cursor.execute(
                            "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                            (book_id, word_id),
                        )
                        # Also link to User_Import if it's a different book
                        if user_import_id and user_import_id != book_id:
                            cursor.execute(
                                "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                                (user_import_id, word_id),
                            )
                        results["added"].append(vocab)

                except Exception as e:
                    logger.exception("Error processing word '%s': %s", vocab, e)
                    results["failed"].append(vocab)

            conn.commit()
            conn.close()

            results["success"] = True
            results["summary"] = {
                "total_words_processed": len(words_dict),
                "added": len(results["added"]),
                "updated": len(results["updated"]),
                "skipped": len(results["skipped"]),
                "failed": len(results["failed"]),
            }
            return results

        except Exception as e:
            logger.exception("Error in add_words_to_book: %s", e)
            return {"error": str(e), "success": False}

    def get_book_words(self, book_name: str, offset: int = 0, limit: int = 100,
                       search: str = '', missing_example: bool = False) -> dict:
        """Return words in a book, paginated, optionally filtered by search string."""
        try:
            conn = self._connect()
            cursor = conn.cursor()
            filters = []
            params_base = [book_name]
            if search:
                filters.append("(w.vocab LIKE ? OR w.definition_zh LIKE ?)")
                like = f"%{search}%"
                params_base += [like, like]
            if missing_example:
                filters.append("(w.example_en IS NULL OR w.example_en = '')")
            where_extra = ("AND " + " AND ".join(filters)) if filters else ""
            cursor.execute(f"""
                SELECT COUNT(*) FROM Words_Effective w
                JOIN Word_Book_Words wbw ON w.word_id = wbw.word_id
                JOIN Word_Book wb ON wbw.book_id = wb.book_id
                WHERE wb.book_name = ? {where_extra}
            """, params_base)
            total = cursor.fetchone()[0]
            cursor.execute(f"""
                SELECT w.word_id, w.vocab, w.definition_zh, w.example_en, w.example_zh,
                       w.phone_us, w.fsrs_state, w.due_date
                FROM Words_Effective w
                JOIN Word_Book_Words wbw ON w.word_id = wbw.word_id
                JOIN Word_Book wb ON wbw.book_id = wb.book_id
                WHERE wb.book_name = ? {where_extra}
                ORDER BY w.vocab
                LIMIT ? OFFSET ?
            """, params_base + [limit, offset])
            words = [
                {"id": r[0], "vocab": r[1], "definition": r[2] or "", "example": r[3] or "",
                 "chinese": r[4] or "", "phone_us": r[5] or "",
                 "fsrs_state": r[6] or 0, "due_date": r[7]}
                for r in cursor.fetchall()
            ]
            conn.close()
            return {"words": words, "total": total, "offset": offset, "limit": limit}
        except Exception as e:
            return {"error": str(e)}

    def update_word(self, word_id: int, definition: str, example: str, chinese: str) -> dict:
        """
        Store user edits in Word_Overrides (non-destructive — system Words table is never modified).
        COALESCE in Words_Effective view ensures these overrides are returned in all read queries.
        Soft reset clears Word_Overrides to restore original system definitions.
        """
        try:
            conn = self._connect()
            conn.execute("""
                INSERT INTO Word_Overrides (word_id, definition_zh, example_en, example_zh, updated_time)
                VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(word_id) DO UPDATE SET
                    definition_zh = excluded.definition_zh,
                    example_en    = excluded.example_en,
                    example_zh    = excluded.example_zh,
                    updated_time  = excluded.updated_time
            """, (word_id, definition or None, example or None, chinese or None))
            conn.commit()
            conn.close()
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def apply_word_overrides(self, overrides: dict) -> dict:
        """
        Bulk-write overrides for multiple words by vocab.
        overrides: {vocab: {definition, example, chinese}}
        Only writes non-empty values; existing overrides for unchanged fields are kept.
        """
        try:
            conn = self._connect()
            cursor = conn.cursor()
            updated = 0
            for vocab, fields in overrides.items():
                cursor.execute("SELECT word_id FROM Words WHERE vocab = ? COLLATE NOCASE LIMIT 1", (vocab,))
                row = cursor.fetchone()
                if not row:
                    continue
                word_id = row[0]
                definition = fields.get("definition") or None
                example    = fields.get("example")    or None
                chinese    = fields.get("chinese")    or None
                # Only write if at least one field is non-empty
                if definition is None and example is None and chinese is None:
                    continue
                cursor.execute("""
                    INSERT INTO Word_Overrides (word_id, definition_zh, example_en, example_zh, updated_time)
                    VALUES (?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(word_id) DO UPDATE SET
                        definition_zh = COALESCE(excluded.definition_zh, definition_zh),
                        example_en    = COALESCE(excluded.example_en,    example_en),
                        example_zh    = COALESCE(excluded.example_zh,    example_zh),
                        updated_time  = excluded.updated_time
                """, (word_id, definition, example, chinese))
                updated += 1
            conn.commit()
            conn.close()
            return {"ok": True, "updated": updated}
        except Exception as e:
            return {"error": str(e)}

    def remove_word_from_book(self, word_id: int, book_name: str) -> dict:
        """Remove a word from a specific book (unlinks junction table entry)."""
        try:
            conn = self._connect()
            conn.execute("""
                DELETE FROM Word_Book_Words WHERE word_id=?
                AND book_id=(SELECT book_id FROM Word_Book WHERE book_name=?)
            """, (word_id, book_name))
            conn.commit()
            conn.close()
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def reset_progress_and_user_books(self, preset_books) -> None:
        """
        Soft reset: zero every word's FSRS state, clear user overrides, drop
        user-imported books (and words that only lived in them). Preset books
        and their words are kept. Raises on failure (transactional).
        """
        conn = self._connect()
        cur = conn.cursor()
        try:
            cur.execute("""
                UPDATE Words SET
                    stability = 0, difficulty = 0, due_date = NULL, last_review = NULL,
                    fsrs_state = 0, fsrs_step = 0, updated_time = datetime('now')
            """)
            cur.execute("DELETE FROM Word_Overrides")

            ph = ",".join("?" * len(preset_books))
            cur.execute(f"SELECT book_id FROM Word_Book WHERE book_name NOT IN ({ph})",
                        list(preset_books))
            user_book_ids = [r[0] for r in cur.fetchall()]
            if user_book_ids:
                id_ph = ",".join("?" * len(user_book_ids))
                cur.execute(f"DELETE FROM Word_Book_Words WHERE book_id IN ({id_ph})", user_book_ids)
                cur.execute(f"DELETE FROM Word_Book WHERE book_id IN ({id_ph})", user_book_ids)
                cur.execute("""
                    DELETE FROM Words WHERE word_id NOT IN (
                        SELECT DISTINCT word_id FROM Word_Book_Words
                    )
                """)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
