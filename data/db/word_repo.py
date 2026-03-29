import logging
import sqlite3
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


class WordRepository:
    def __init__(self, db_path: str):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

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

    def import_fsrs_data(self, json_file_path: str) -> dict:
        import json

        try:
            with open(json_file_path, "r", encoding="utf-8") as f:
                fsrs_data = json.load(f)

            if not fsrs_data:
                return {"error": "Empty FSRS data file", "success": False}

            conn = self._connect()
            cursor = conn.cursor()

            results = {"updated": [], "skipped": [], "failed": [], "source_file": json_file_path}

            for vocab, fsrs_info in fsrs_data.items():
                try:
                    vocab = vocab.strip().lower()

                    stability = float(fsrs_info.get("Stability") or 0)
                    difficulty = float(fsrs_info.get("Difficulty") or 0)
                    due_date = fsrs_info.get("Due_Date")
                    last_review = fsrs_info.get("Last_Review")

                    # Normalize dates
                    due_date_sql = self._normalize_date(due_date)
                    last_review_sql = self._normalize_date(last_review)

                    cursor.execute("SELECT word_id FROM Words WHERE vocab = ?", (vocab,))
                    word_row = cursor.fetchone()

                    if word_row:
                        cursor.execute("""
                            UPDATE Words
                            SET stability = ?, difficulty = ?, due_date = ?, last_review = ?,
                                updated_time = datetime('now')
                            WHERE word_id = ?
                        """, (stability, difficulty, due_date_sql, last_review_sql, word_row[0]))
                        results["updated"].append(vocab)
                    else:
                        # Word not in DB — insert placeholder (no auto-fetch)
                        definition_zh = ""
                        example_en    = ""
                        example_zh    = ""

                        if not due_date_sql:
                            tomorrow = datetime.now() + timedelta(days=1)
                            due_date_sql = tomorrow.strftime("%Y-%m-%d %H:%M:%S")

                        cursor.execute("""
                            INSERT INTO Words (vocab, definition_zh, example_en, example_zh,
                                             stability, difficulty, due_date, last_review)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, (vocab, definition_zh, example_en, example_zh,
                              stability, difficulty, due_date_sql, last_review_sql))
                        word_id = cursor.lastrowid

                        cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = 'User_Import'")
                        book_row = cursor.fetchone()
                        if book_row:
                            cursor.execute(
                                "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                                (book_row[0], word_id),
                            )
                        results["updated"].append(vocab)

                except Exception as e:
                    logger.exception("Error processing FSRS for '%s': %s", vocab, e)
                    results["failed"].append(vocab)

            conn.commit()
            conn.close()

            results["success"] = True
            results["summary"] = {
                "total_words_processed": len(fsrs_data),
                "updated": len(results["updated"]),
                "skipped": len(results["skipped"]),
                "failed": len(results["failed"]),
            }
            return results

        except Exception as e:
            return {"error": str(e), "success": False}

    def import_from_vocab_list(self, json_file_path: str,
                               target_book_name: str = None,
                               update_existing: bool = True) -> dict:
        import json
        import re

        try:
            with open(json_file_path, "r", encoding="utf-8") as f:
                json_data = json.load(f)

            words_dict = {}
            for key, value in json_data.items():
                if key == "XXInfoXX":
                    continue
                if isinstance(value, dict):
                    words_dict[key] = {
                        "Definition": value.get("Definition", ""),
                        "ExampleSentence": value.get("ExampleSentence", ""),
                        "Example_Chinese": value.get("Example_Chinese", value.get("ExampleChinese", "")),
                    }
                else:
                    words_dict[key] = {"Definition": "", "ExampleSentence": "", "Example_Chinese": ""}

            if not words_dict:
                return {"error": "No valid word data found", "success": False}

            if target_book_name is None:
                import os
                filename = os.path.basename(json_file_path)
                book_name = os.path.splitext(filename)[0]
                book_name = re.sub(r"_?\d{8}_?\d{6}", "", book_name)
                book_name = re.sub(r"Generated_List_?", "", book_name)
                book_name = book_name.strip("_") or "Imported_List"
            else:
                book_name = target_book_name

            conn = self._connect()
            cursor = conn.cursor()

            # Ensure book exists
            cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
            book_row = cursor.fetchone()
            if not book_row:
                cursor.execute("INSERT INTO Word_Book (book_name) VALUES (?)", (book_name,))
                book_id = cursor.lastrowid
            else:
                book_id = book_row[0]
            conn.commit()

            results = {
                "added": [], "updated": [], "skipped": [], "failed": [],
                "book_name": book_name, "book_id": book_id,
                "source_file": json_file_path,
            }

            for vocab, word_data in words_dict.items():
                try:
                    vocab = vocab.strip().lower()
                    definition_zh = word_data.get("Definition", "").strip()
                    example_en = word_data.get("ExampleSentence", "").strip()
                    example_zh = word_data.get("Example_Chinese", "").strip()

                    cursor.execute("""
                        SELECT word_id, definition_zh, example_en, example_zh
                        FROM Words WHERE vocab = ?
                    """, (vocab,))
                    existing = cursor.fetchone()

                    if existing:
                        word_id = existing[0]
                        cursor.execute(
                            "SELECT 1 FROM Word_Book_Words WHERE book_id = ? AND word_id = ?",
                            (book_id, word_id),
                        )
                        if cursor.fetchone():
                            if update_existing:
                                new_def = definition_zh or existing[1]
                                new_ex  = example_en or existing[2]
                                new_ex_zh = example_zh or existing[3]
                                cursor.execute("""
                                    UPDATE Words SET definition_zh = ?, example_en = ?, example_zh = ?,
                                        updated_time = datetime('now')
                                    WHERE word_id = ?
                                """, (new_def, new_ex, new_ex_zh, word_id))
                                results["updated"].append(vocab)
                            else:
                                results["skipped"].append(vocab)
                        else:
                            cursor.execute(
                                "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                                (book_id, word_id),
                            )
                            results["added"].append(vocab)
                    else:
                        difficulty = min(len(vocab) / 10, 1.0)
                        cursor.execute("""
                            INSERT INTO Words (vocab, definition_zh, example_en, example_zh, difficulty)
                            VALUES (?, ?, ?, ?, ?)
                        """, (vocab, definition_zh, example_en, example_zh, difficulty))
                        word_id = cursor.lastrowid
                        cursor.execute(
                            "INSERT INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                            (book_id, word_id),
                        )
                        results["added"].append(vocab)

                except Exception as e:
                    logger.exception("Error importing word '%s': %s", vocab, e)
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
            if "XXInfoXX" in json_data:
                results["metadata"] = json_data["XXInfoXX"]
            return results

        except Exception as e:
            return {"error": str(e), "success": False}

    def get_database_stats(self) -> dict:
        try:
            conn = self._connect()
            cursor = conn.cursor()

            stats = {}
            cursor.execute("SELECT COUNT(*) FROM Words")
            stats["total_words"] = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(DISTINCT vocab) FROM Words")
            stats["distinct_words"] = cursor.fetchone()[0]

            cursor.execute("""
                SELECT wb.book_name, COUNT(wbw.word_id) as word_count, wb.created_time
                FROM Word_Book wb
                LEFT JOIN Word_Book_Words wbw ON wb.book_id = wbw.book_id
                GROUP BY wb.book_id
                ORDER BY wb.book_name
            """)
            stats["books"] = []
            for book_name, count, created_time in cursor.fetchall():
                stats["books"].append({
                    "book_name": book_name,
                    "length": count,
                    "created_time": created_time,
                })

            cursor.execute("""
                SELECT COUNT(*) FROM Words
                WHERE example_chinese IS NOT NULL AND example_chinese != '' AND example_chinese != '[1]'
            """)
            stats["words_with_chinese_examples"] = cursor.fetchone()[0]

            cursor.execute("SELECT AVG(difficulty) FROM Words WHERE difficulty > 0")
            avg = cursor.fetchone()[0]
            stats["average_difficulty"] = round(avg, 2) if avg else 0

            cursor.execute("""
                SELECT COUNT(*) FROM Words
                WHERE due_date IS NOT NULL AND datetime(due_date) <= datetime('now')
            """)
            stats["words_due_for_review"] = cursor.fetchone()[0]

            conn.close()
            return stats
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def _normalize_date(date_str: Optional[str]) -> Optional[str]:
        if not date_str:
            return None
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return date_str
