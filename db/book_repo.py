import logging
import sqlite3
from typing import Optional

logger = logging.getLogger(__name__)


class BookRepository:
    def __init__(self, db_path: str):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def add_book(self, book_name: str) -> bool:
        try:
            conn = self._connect()
            cursor = conn.cursor()
            cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
            if cursor.fetchone():
                conn.close()
                return False
            cursor.execute("INSERT INTO Word_Book (book_name) VALUES (?)", (book_name,))
            conn.commit()
            conn.close()
            logger.info("Added new word book: %s", book_name)
            return True
        except Exception as e:
            logger.exception("Error adding word book: %s", e)
            return False

    def get_book_id(self, book_name: str) -> Optional[int]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
        row = cursor.fetchone()
        conn.close()
        return row[0] if row else None

    def get_or_create_book(self, book_name: str) -> int:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
        row = cursor.fetchone()
        if row:
            conn.close()
            return row[0]
        cursor.execute("INSERT INTO Word_Book (book_name) VALUES (?)", (book_name,))
        book_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return book_id

    def get_all_books(self, with_metadata: bool = False) -> list:
        try:
            conn = self._connect()
            cursor = conn.cursor()

            if with_metadata:
                cursor.execute("""
                    SELECT wb.book_id, wb.book_name, wb.created_time, wb.updated_time,
                           COUNT(wbw.word_id) as length
                    FROM Word_Book wb
                    LEFT JOIN Word_Book_Words wbw ON wb.book_id = wbw.book_id
                    GROUP BY wb.book_id
                    ORDER BY wb.book_name ASC
                """)
                books = []
                for book_id, book_name, created_time, updated_time, length in cursor.fetchall():
                    books.append({
                        "book_id": book_id,
                        "book_name": book_name,
                        "length": length,
                        "created_time": created_time,
                        "updated_time": updated_time,
                    })
                conn.close()
                return books
            else:
                cursor.execute("SELECT book_name FROM Word_Book ORDER BY book_name ASC")
                names = [row[0] for row in cursor.fetchall()]
                conn.close()
                return names

        except Exception as e:
            logger.exception("Error getting books: %s", e)
            return []

    def get_book_length(self, book_name: str) -> int:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return 0
        book_id = row[0]
        cursor.execute("SELECT COUNT(*) FROM Word_Book_Words WHERE book_id = ?", (book_id,))
        count = cursor.fetchone()[0]
        conn.close()
        return count

    def get_book_completion_stats(self, book_name: str = None) -> dict:
        try:
            conn = self._connect()
            cursor = conn.cursor()

            if book_name is None:
                # All words stats
                cursor.execute("SELECT COUNT(DISTINCT vocab) FROM Words")
                total = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(DISTINCT vocab) FROM Words WHERE due_date IS NOT NULL")
                completed = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(DISTINCT vocab) FROM Words WHERE due_date IS NULL")
                not_started = cursor.fetchone()[0]

                cursor.execute("""
                    SELECT COUNT(DISTINCT vocab) FROM Words
                    WHERE due_date IS NOT NULL AND datetime(due_date) <= datetime('now')
                """)
                overdue = cursor.fetchone()[0]
            else:
                cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
                book_row = cursor.fetchone()
                if not book_row:
                    conn.close()
                    return {"error": f"Book '{book_name}' not found"}
                book_id = book_row[0]

                cursor.execute("""
                    SELECT COUNT(*) FROM Word_Book_Words wbw
                    JOIN Words w ON w.word_id = wbw.word_id
                    WHERE wbw.book_id = ?
                """, (book_id,))
                total = cursor.fetchone()[0]

                cursor.execute("""
                    SELECT COUNT(*) FROM Word_Book_Words wbw
                    JOIN Words w ON w.word_id = wbw.word_id
                    WHERE wbw.book_id = ? AND w.due_date IS NOT NULL
                """, (book_id,))
                completed = cursor.fetchone()[0]

                cursor.execute("""
                    SELECT COUNT(*) FROM Word_Book_Words wbw
                    JOIN Words w ON w.word_id = wbw.word_id
                    WHERE wbw.book_id = ? AND w.due_date IS NULL
                """, (book_id,))
                not_started = cursor.fetchone()[0]

                cursor.execute("""
                    SELECT COUNT(*) FROM Word_Book_Words wbw
                    JOIN Words w ON w.word_id = wbw.word_id
                    WHERE wbw.book_id = ? AND w.due_date IS NOT NULL
                    AND datetime(w.due_date) <= datetime('now')
                """, (book_id,))
                overdue = cursor.fetchone()[0]

            conn.close()

            percentage = round(completed / total, 2) if total > 0 else 0

            result = {
                "Completed": completed,
                "Total": total,
                "Percentage": percentage,
                "Not_Started": not_started,
                "Overdue": overdue,
                "In_Progress": total - completed - not_started,
            }

            if book_name is not None:
                result["book_name"] = book_name
                result["book_id"] = book_id
            else:
                result["scope"] = "all_words"

            return result

        except Exception as e:
            logger.exception("Error getting book completion stats: %s", e)
            return {"error": str(e)}

    def link_word_to_book(self, book_id: int, word_id: int):
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
            (book_id, word_id),
        )
        conn.commit()
        conn.close()
