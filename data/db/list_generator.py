import json
import logging
import os
import sqlite3
from datetime import datetime

logger = logging.getLogger(__name__)


class ListGenerator:
    def __init__(self, db_path: str):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def generate_vocab_list_with_fsrs(
        self,
        count: int,
        vocab_output_path: str,
        fsrs_output_path: str = None,
        due_only: bool = False,
        book_name: str = None,
        is_extra: bool = False,
    ) -> dict:
        try:

            conn = self._connect()
            cursor = conn.cursor()

            # Build query
            if book_name:
                cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
                book_row = cursor.fetchone()
                if not book_row:
                    conn.close()
                    return {"error": f"Book '{book_name}' not found", "success": False}
                book_id = book_row[0]

                base_query = """
                    SELECT w.vocab, w.definition, w.example, w.example_chinese
                    FROM Words w
                    JOIN Word_Book_Words wbw ON w.word_id = wbw.word_id
                    WHERE wbw.book_id = ?
                """
                params = [book_id]
            else:
                base_query = """
                    SELECT w.vocab, w.definition, w.example, w.example_chinese
                    FROM Words w
                    WHERE 1=1
                """
                params = []

            # Add due date filter
            if due_only:
                base_query += " AND datetime(w.due_date) <= datetime('now')"
            else:
                base_query += " AND w.due_date IS NULL"

            # Count available words
            count_query = base_query.replace(
                "SELECT w.vocab, w.definition, w.example, w.example_chinese",
                "SELECT COUNT(*)",
            )
            cursor.execute(count_query, params)
            total_words = cursor.fetchone()[0]

            if total_words == 0:
                conn.close()
                return {"error": "No words found matching criteria", "success": False}

            if count > total_words:
                count = total_words

            # Get random words
            vocab_query = base_query + " ORDER BY RANDOM() LIMIT ?"
            vocab_params = params + [count]
            cursor.execute(vocab_query, vocab_params)
            vocab_words = cursor.fetchall()

            vocab_list = [w[0] for w in vocab_words]

            # Get FSRS data for selected words
            placeholders = ",".join(["?" for _ in vocab_list])
            cursor.execute(
                f"SELECT vocab, stability, difficulty, due_date, last_review FROM Words WHERE vocab IN ({placeholders})",
                vocab_list,
            )
            fsrs_words = cursor.fetchall()

            fsrs_dict = {}
            for vocab, stability, difficulty, due_date, last_review in fsrs_words:
                due_str = self._normalize_iso(due_date)
                review_str = self._normalize_iso(last_review)
                fsrs_dict[vocab] = {
                    "Stability": float(stability) if stability else 0.0,
                    "Difficulty": float(difficulty) if difficulty else 0.0,
                    "Rating": [],
                    "Due_Date": due_str,
                    "Last_Review": review_str,
                }

            conn.close()

            # Build output data
            vocab_output_data = {}
            for vocab, definition, example, example_chinese in vocab_words:
                vocab_output_data[vocab] = {
                    "Definition": definition or "",
                    "ExampleSentence": example or "",
                    "Example_Chinese": example_chinese or "",
                }

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"Review_List_{timestamp}.json" if due_only else f"Generated_List_{timestamp}.json"

            # Resolve directory paths → full file paths
            if os.path.isdir(vocab_output_path):
                vocab_output_path = os.path.join(vocab_output_path, filename)
            fsrs_filename = os.path.splitext(os.path.basename(vocab_output_path))[0] + "_fsrs.json"
            if fsrs_output_path is None or os.path.isdir(str(fsrs_output_path)):
                fsrs_dir = str(fsrs_output_path) if (fsrs_output_path and os.path.isdir(str(fsrs_output_path))) else os.path.dirname(vocab_output_path)
                fsrs_output_path = os.path.join(fsrs_dir, fsrs_filename)

            vocab_output_data["XXInfoXX"] = {
                "Filename": filename,
                "From": book_name,
                "Count": len(vocab_words),
                "Learning": False,
                "Viewed": False,
                "Practiced": False,
                "Completed": False,
                "Status": 0,
                "Currently_on": 0,
                "FSRS_File": os.path.basename(fsrs_output_path) if fsrs_output_path else "",
                "Is_Extra": is_extra,
            }

            fsrs_output_data = {}
            for vocab in vocab_list:
                fsrs_output_data[vocab] = fsrs_dict.get(vocab, {
                    "Stability": 0.0,
                    "Difficulty": 0.0,
                    "Rating": [],
                    "Due_Date": None,
                    "Last_Review": None,
                })

            # Save files
            os.makedirs(os.path.dirname(vocab_output_path), exist_ok=True)
            os.makedirs(os.path.dirname(fsrs_output_path), exist_ok=True)

            with open(vocab_output_path, "w", encoding="utf-8") as f:
                json.dump(vocab_output_data, f, ensure_ascii=False, indent=2)

            with open(fsrs_output_path, "w", encoding="utf-8") as f:
                json.dump(fsrs_output_data, f, ensure_ascii=False, indent=2)

            return {
                "success": True,
                "vocabulary_file": {
                    "path": vocab_output_path,
                    "word_count": len(vocab_words),
                    "filename": os.path.basename(vocab_output_path),
                },
                "fsrs_file": {
                    "path": fsrs_output_path,
                    "word_count": len(fsrs_output_data),
                },
                "filters": {
                    "due_only": due_only,
                    "book_filter": book_name,
                    "total_available": total_words,
                },
                "common_words": list(vocab_list),
            }

        except Exception as e:
            logger.exception("Error generating vocabulary list with FSRS: %s", e)
            return {"error": str(e), "success": False}

    @staticmethod
    def _normalize_iso(date_str) -> str | None:
        if not date_str or not isinstance(date_str, str):
            return None
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            return dt.isoformat()
        except Exception:
            return date_str
