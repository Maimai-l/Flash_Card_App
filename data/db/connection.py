import logging
import os
import json
import sqlite3
from pathlib import Path

from paths import data_path, res_path, resource_path

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 9  # v9 = Word_Overrides table + Words_Effective view (non-destructive user edits)

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS Word_Book (
    book_id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_name TEXT UNIQUE NOT NULL,
    created_time TEXT DEFAULT (datetime('now')),
    updated_time TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Words (
    word_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    vocab        TEXT NOT NULL UNIQUE,
    definition_zh TEXT DEFAULT '',   -- Chinese definition/meaning  (e.g. "v.退位；放弃")
    example_en   TEXT DEFAULT '',    -- English example sentence
    example_zh   TEXT DEFAULT '',    -- Chinese translation of the example
    phone_us     TEXT DEFAULT '',    -- US IPA pronunciation
    phone_uk     TEXT DEFAULT '',    -- UK IPA pronunciation
    stability    REAL DEFAULT 0,
    difficulty   REAL DEFAULT 0,
    due_date     TEXT,
    last_review  TEXT,
    fsrs_state   INTEGER DEFAULT 0,
    fsrs_step    INTEGER DEFAULT 0,
    created_time TEXT DEFAULT (datetime('now')),
    updated_time TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Word_Book_Words (
    book_id INTEGER NOT NULL REFERENCES Word_Book(book_id) ON DELETE CASCADE,
    word_id INTEGER NOT NULL REFERENCES Words(word_id) ON DELETE CASCADE,
    added_time TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (book_id, word_id)
);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_words_vocab ON Words(vocab);
CREATE INDEX IF NOT EXISTS idx_words_due_date ON Words(due_date);
CREATE INDEX IF NOT EXISTS idx_wbw_book_id ON Word_Book_Words(book_id);
CREATE INDEX IF NOT EXISTS idx_wbw_word_id ON Word_Book_Words(word_id);

CREATE TABLE IF NOT EXISTS Word_Overrides (
    word_id       INTEGER PRIMARY KEY REFERENCES Words(word_id) ON DELETE CASCADE,
    definition_zh TEXT,
    example_en    TEXT,
    example_zh    TEXT,
    updated_time  TEXT DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS Words_Effective AS
SELECT
    w.word_id, w.vocab,
    COALESCE(o.definition_zh, w.definition_zh) AS definition_zh,
    COALESCE(o.example_en,    w.example_en)    AS example_en,
    COALESCE(o.example_zh,    w.example_zh)    AS example_zh,
    w.phone_us, w.phone_uk,
    w.stability, w.difficulty, w.due_date, w.last_review,
    w.fsrs_state, w.fsrs_step, w.created_time, w.updated_time
FROM Words w
LEFT JOIN Word_Overrides o ON w.word_id = o.word_id;
"""

DEFAULT_BOOKS = ["Pre_Generate", "User_Import"]


class DatabaseConnection:
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = str(data_path("database") / "vocabulary.db")
        self.db_path = db_path

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def get_schema_version(self) -> int:
        if not os.path.exists(self.db_path):
            return 0
        try:
            conn = self.connect()
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
            if not cursor.fetchone():
                # Check if old schema exists (has book_identities column)
                cursor.execute("PRAGMA table_info(Words)")
                columns = [col[1] for col in cursor.fetchall()]
                if "book_identities" in columns:
                    conn.close()
                    return 1  # old schema
                if "vocab" in columns:
                    # Has the new Words schema — but Word_Book_Words might be missing
                    # (e.g. a partially-initialised bundled DB).  Only trust SCHEMA_VERSION
                    # if the junction table actually exists.
                    cursor.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='Word_Book_Words'"
                    )
                    has_junction = cursor.fetchone() is not None
                    conn.close()
                    return SCHEMA_VERSION if has_junction else 0
                conn.close()
                return 0
            cursor.execute("SELECT MAX(version) FROM schema_version")
            row = cursor.fetchone()
            conn.close()
            return row[0] if row and row[0] else 0
        except Exception:
            return 0

    def _detect_actual_version(self) -> int:
        """Inspect table structure to determine the real schema version, ignoring schema_version rows."""
        try:
            conn = self.connect()
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(Words)")
            cols = {col[1] for col in cursor.fetchall()}
            # Check for junction table
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Word_Book_Words'")
            has_junction = cursor.fetchone() is not None
            # Check for Word_Overrides table (added in v9) — query before closing.
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Word_Overrides'")
            has_overrides = cursor.fetchone() is not None
            conn.close()
            if "book_identities" in cols or not has_junction:
                return 1 if "book_identities" in cols else 0
            if "fsrs_state" not in cols:
                return 2
            if "definition_zh" not in cols:
                return 3
            if "phone_us" not in cols:
                return 5  # v4→v5 adds phone columns
            if not has_overrides:
                return 8
            return SCHEMA_VERSION
        except Exception:
            return 0

    def initialize_database(self, pre_store_vocab_path: str = None) -> bool:
        try:
            db_dir = os.path.dirname(self.db_path)
            if db_dir:
                os.makedirs(db_dir, exist_ok=True)

            version = self.get_schema_version()

            # Sanity-check: schema_version row may be stale (e.g. DB was replaced/copied
            # without re-running migrations).  Re-detect the actual version from structure.
            if version >= SCHEMA_VERSION:
                actual = self._detect_actual_version()
                if actual >= SCHEMA_VERSION:
                    logger.info("Database already at schema version %d", version)
                    return True
                logger.warning(
                    "schema_version row says %d but structural check found v%d — re-running migrations from v%d",
                    version, actual, actual,
                )
                version = actual

            if version == 1:
                logger.info("Migrating database from v1 to v2...")
                self._migrate_v1_to_v2()
                self._import_bundled_word_lists()
                version = 2

            if version == 2:
                logger.info("Migrating database from v2 to v3...")
                self._migrate_v2_to_v3()
                version = 3

            if version == 3:
                logger.info("Migrating database from v3 to v4...")
                self._migrate_v3_to_v4()
                version = 4

            if version == 4:
                logger.info("Migrating database from v4 to v5...")
                self._migrate_v4_to_v5()
                version = 5

            if version == 5:
                logger.info("Migrating database from v5 to v6...")
                self._migrate_v5_to_v6()
                version = 6

            if version == 6:
                logger.info("Migrating database from v6 to v7...")
                conn2 = self.connect()
                cursor2 = conn2.cursor()
                cursor2.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (7,))
                conn2.commit()
                conn2.close()
                version = 7

            if version == 7:
                logger.info("Migrating database from v7 to v8: repairing missing book links...")
                self._migrate_v7_to_v8()
                version = 8

            if version == 8:
                logger.info("Migrating database from v8 to v9: adding Word_Overrides + Words_Effective view...")
                self._migrate_v8_to_v9()
                return True

            # Fresh install
            conn = self.connect()
            cursor = conn.cursor()
            cursor.executescript(CREATE_TABLES_SQL)

            for book_name in DEFAULT_BOOKS:
                cursor.execute(
                    "INSERT OR IGNORE INTO Word_Book (book_name) VALUES (?)",
                    (book_name,),
                )

            cursor.execute(
                "INSERT OR IGNORE INTO schema_version (version) VALUES (?)",
                (SCHEMA_VERSION,),
            )
            conn.commit()

            # Import pre-generated words
            if pre_store_vocab_path is None:
                pre_store_vocab_path = str(res_path("pre_store_vocab", "vocab_app.db"))

            if os.path.exists(pre_store_vocab_path):
                self._import_pre_generated_words(conn, pre_store_vocab_path)

            conn.commit()
            conn.close()

            # Import bundled word lists (links words to named books)
            self._import_bundled_word_lists()

            logger.info("Database initialized successfully at: %s", self.db_path)
            return True

        except Exception as e:
            logger.exception("Error initializing database: %s", e)
            return False

    def _import_pre_generated_words(self, conn: sqlite3.Connection, source_db_path: str) -> int:
        try:
            source_conn = sqlite3.connect(source_db_path)
            source_cursor = source_conn.cursor()

            source_cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='words'")
            if not source_cursor.fetchone():
                source_conn.close()
                return 0

            source_cursor.execute("PRAGMA table_info(words)")
            column_names = [col[1] for col in source_cursor.fetchall()]
            required = ["headword", "def_zh", "example_en", "example_zh"]
            if not all(c in column_names for c in required):
                source_conn.close()
                return 0

            source_cursor.execute("SELECT headword, def_zh, example_en, example_zh FROM words")
            words = source_cursor.fetchall()
            source_conn.close()

            cursor = conn.cursor()
            cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = 'Pre_Generate'")
            book_row = cursor.fetchone()
            if not book_row:
                return 0
            book_id = book_row[0]

            imported = 0
            for headword, def_zh, example_en, example_zh in words:
                vocab = (headword or "").strip()
                if not vocab:
                    continue
                definition = (def_zh or "").strip()
                example = (example_en or "").strip()
                example_chinese = (example_zh or "").strip()
                difficulty = min(len(vocab) / 10, 1.0) if definition else 0

                cursor.execute(
                    "INSERT OR IGNORE INTO Words (vocab, definition_zh, example_en, example_zh, difficulty) VALUES (?, ?, ?, ?, ?)",
                    (vocab, definition, example, example_chinese, difficulty),
                )
                if cursor.rowcount > 0:
                    word_id = cursor.lastrowid
                else:
                    cursor.execute("SELECT word_id FROM Words WHERE vocab = ?", (vocab,))
                    word_id = cursor.fetchone()[0]

                cursor.execute(
                    "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                    (book_id, word_id),
                )
                imported += 1

                if imported % 5000 == 0:
                    conn.commit()

            conn.commit()
            logger.info("Imported %d pre-generated words", imported)
            return imported

        except Exception as e:
            logger.exception("Error importing pre-generated words: %s", e)
            return 0

    def _import_bundled_word_lists(self):
        from data.db.book_repo import BookRepository
        from data.db.word_repo import WordRepository

        book_repo = BookRepository(self.db_path)
        word_repo = WordRepository(self.db_path)

        bundled = [
            ("CET_4+6_edited", "CET_4+6_edited.json"),
            ("TOEFL", "TOEFL.json"),
            ("GRE_8000_Words", "GRE_8000_Words.json"),
        ]

        for book_name, filename in bundled:
            json_path = res_path("words", filename)
            if not os.path.exists(str(json_path)):
                continue
            book_repo.add_book(book_name)
            with open(str(json_path), "r", encoding="UTF-8") as f:
                data = json.load(f)
            word_repo.add_words_to_book(book_name, data, fetch_missing=False)

    def _migrate_v1_to_v2(self):
        """Migrate from old schema (book_identities TEXT) to new (junction table)."""
        import shutil

        backup_path = self.db_path + ".backup_v1"
        shutil.copy2(self.db_path, backup_path)
        logger.info("Backed up database to %s", backup_path)

        conn = self.connect()
        cursor = conn.cursor()

        # 1. Create junction table and schema_version
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS Word_Book_Words (
                book_id INTEGER NOT NULL REFERENCES Word_Book(book_id) ON DELETE CASCADE,
                word_id INTEGER NOT NULL REFERENCES Words(word_id) ON DELETE CASCADE,
                added_time TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (book_id, word_id)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT (datetime('now'))
            )
        """)

        # 2. Populate junction table from book_identities
        cursor.execute("SELECT word_id, vocab, book_identities FROM Words WHERE book_identities IS NOT NULL")
        rows = cursor.fetchall()

        # Get all valid book IDs
        cursor.execute("SELECT book_id FROM Word_Book")
        valid_book_ids = {row[0] for row in cursor.fetchall()}

        for word_id, vocab, book_identities in rows:
            if not book_identities:
                continue
            for bid_str in book_identities.split(","):
                bid_str = bid_str.strip()
                if bid_str and bid_str.isdigit():
                    bid = int(bid_str)
                    if bid in valid_book_ids:
                        cursor.execute(
                            "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                            (bid, word_id),
                        )

        # 3. Deduplicate words (same vocab, different rows)
        cursor.execute("""
            SELECT vocab, COUNT(*) as cnt FROM Words
            GROUP BY vocab HAVING cnt > 1
        """)
        duplicates = cursor.fetchall()

        for vocab, _ in duplicates:
            cursor.execute("""
                SELECT word_id, definition, example, example_chinese,
                       stability, difficulty, due_date, last_review
                FROM Words WHERE vocab = ?
                ORDER BY
                    CASE WHEN due_date IS NOT NULL THEN 0 ELSE 1 END,
                    LENGTH(COALESCE(definition, '')) DESC
            """, (vocab,))
            dup_rows = cursor.fetchall()
            if len(dup_rows) <= 1:
                continue

            # Keep the best row (first after ordering)
            keep_id = dup_rows[0][0]

            # Move junction table references from duplicates to keeper
            for dup_row in dup_rows[1:]:
                old_id = dup_row[0]
                # Move book associations
                cursor.execute("""
                    INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id)
                    SELECT book_id, ? FROM Word_Book_Words WHERE word_id = ?
                """, (keep_id, old_id))
                # Delete old junction entries
                cursor.execute("DELETE FROM Word_Book_Words WHERE word_id = ?", (old_id,))
                # Delete duplicate word
                cursor.execute("DELETE FROM Words WHERE word_id = ?", (old_id,))

        # 4. Rebuild Words table without book_identities and with UNIQUE(vocab)
        cursor.execute("""
            CREATE TABLE Words_new (
                word_id INTEGER PRIMARY KEY AUTOINCREMENT,
                vocab TEXT NOT NULL UNIQUE,
                definition TEXT NOT NULL DEFAULT '',
                example TEXT DEFAULT '',
                example_chinese TEXT DEFAULT '',
                stability REAL DEFAULT 0,
                difficulty REAL DEFAULT 0,
                due_date TEXT,
                last_review TEXT,
                created_time TEXT DEFAULT (datetime('now')),
                updated_time TEXT DEFAULT (datetime('now'))
            )
        """)
        cursor.execute("""
            INSERT INTO Words_new (word_id, vocab, definition, example, example_chinese,
                                   stability, difficulty, due_date, last_review,
                                   created_time, updated_time)
            SELECT word_id, vocab, COALESCE(definition, ''), example, example_chinese,
                   COALESCE(stability, 0), COALESCE(difficulty, 0), due_date, last_review,
                   created_time, updated_time
            FROM Words
        """)
        cursor.execute("DROP TABLE Words")
        cursor.execute("ALTER TABLE Words_new RENAME TO Words")

        # 5. Rebuild Word_Book without length column
        cursor.execute("""
            CREATE TABLE Word_Book_new (
                book_id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_name TEXT UNIQUE NOT NULL,
                created_time TEXT DEFAULT (datetime('now')),
                updated_time TEXT DEFAULT (datetime('now'))
            )
        """)
        cursor.execute("""
            INSERT INTO Word_Book_new (book_id, book_name, created_time, updated_time)
            SELECT book_id, book_name, created_time, updated_time
            FROM Word_Book
        """)
        cursor.execute("DROP TABLE Word_Book")
        cursor.execute("ALTER TABLE Word_Book_new RENAME TO Word_Book")

        # 6. Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_words_vocab ON Words(vocab)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_words_due_date ON Words(due_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_wbw_book_id ON Word_Book_Words(book_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_wbw_word_id ON Word_Book_Words(word_id)")

        # 7. Record schema version
        cursor.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (2,))

        conn.commit()
        conn.close()
        logger.info("Migration v1→v2 completed successfully")

    def _migrate_v2_to_v3(self):
        """Add fsrs_state and fsrs_step columns to Words table."""
        conn = self.connect()
        cursor = conn.cursor()

        cursor.execute("PRAGMA table_info(Words)")
        existing_cols = {col[1] for col in cursor.fetchall()}

        if "fsrs_state" not in existing_cols:
            cursor.execute("ALTER TABLE Words ADD COLUMN fsrs_state INTEGER DEFAULT 0")
        if "fsrs_step" not in existing_cols:
            cursor.execute("ALTER TABLE Words ADD COLUMN fsrs_step INTEGER DEFAULT 0")

        # Mark words that have been reviewed as Review state (2)
        cursor.execute("""
            UPDATE Words SET fsrs_state = 2
            WHERE due_date IS NOT NULL AND stability > 0
        """)

        cursor.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (3,))
        conn.commit()
        conn.close()
        logger.info("Migration v2→v3 completed: added fsrs_state, fsrs_step")

    def _migrate_v4_to_v5(self):
        """
        Rename columns to semantically correct names and add pronunciation fields.
          definition       → definition_zh  (was always Chinese, now named correctly)
          example          → example_en
          example_chinese  → example_zh
          + phone_us, phone_uk  (new, populated from Youdao cache)
        """
        conn = self.connect()
        cursor = conn.cursor()

        # 1. Build new table with correct schema
        cursor.execute("""
            CREATE TABLE Words_v5 (
                word_id       INTEGER PRIMARY KEY AUTOINCREMENT,
                vocab         TEXT NOT NULL UNIQUE,
                definition_zh TEXT DEFAULT '',
                example_en    TEXT DEFAULT '',
                example_zh    TEXT DEFAULT '',
                phone_us      TEXT DEFAULT '',
                phone_uk      TEXT DEFAULT '',
                stability     REAL DEFAULT 0,
                difficulty    REAL DEFAULT 0,
                due_date      TEXT,
                last_review   TEXT,
                fsrs_state    INTEGER DEFAULT 0,
                fsrs_step     INTEGER DEFAULT 0,
                created_time  TEXT DEFAULT (datetime('now')),
                updated_time  TEXT DEFAULT (datetime('now'))
            )
        """)

        # 2. Copy all rows, mapping old names → new names
        cursor.execute("""
            INSERT INTO Words_v5
                (word_id, vocab, definition_zh, example_en, example_zh,
                 stability, difficulty, due_date, last_review,
                 fsrs_state, fsrs_step, created_time, updated_time)
            SELECT
                word_id, vocab, definition, example, example_chinese,
                stability, difficulty, due_date, last_review,
                fsrs_state, fsrs_step, created_time, updated_time
            FROM Words
        """)

        # 3. Swap tables — disable FK so DROP TABLE doesn't cascade-delete Word_Book_Words
        cursor.execute("PRAGMA foreign_keys = OFF")
        cursor.execute("DROP TABLE Words")
        cursor.execute("ALTER TABLE Words_v5 RENAME TO Words")
        cursor.execute("PRAGMA foreign_keys = ON")

        # 4. Recreate indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_words_vocab    ON Words(vocab)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_words_due_date ON Words(due_date)")
        conn.commit()

        cursor.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (5,))
        conn.commit()
        conn.close()
        logger.info("Migration v4→v5 completed: renamed columns, added pronunciation fields")

    def _migrate_v8_to_v9(self):
        """Add Word_Overrides table and Words_Effective view for non-destructive user edits."""
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS Word_Overrides (
                word_id       INTEGER PRIMARY KEY REFERENCES Words(word_id) ON DELETE CASCADE,
                definition_zh TEXT,
                example_en    TEXT,
                example_zh    TEXT,
                updated_time  TEXT DEFAULT (datetime('now'))
            )
        """)
        # Drop and recreate view in case it exists from a partial run
        cursor.execute("DROP VIEW IF EXISTS Words_Effective")
        cursor.execute("""
            CREATE VIEW Words_Effective AS
            SELECT
                w.word_id, w.vocab,
                COALESCE(o.definition_zh, w.definition_zh) AS definition_zh,
                COALESCE(o.example_en,    w.example_en)    AS example_en,
                COALESCE(o.example_zh,    w.example_zh)    AS example_zh,
                w.phone_us, w.phone_uk,
                w.stability, w.difficulty, w.due_date, w.last_review,
                w.fsrs_state, w.fsrs_step, w.created_time, w.updated_time
            FROM Words w
            LEFT JOIN Word_Overrides o ON w.word_id = o.word_id
        """)
        cursor.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (9,))
        conn.commit()
        conn.close()
        logger.info("Migration v8→v9 completed: Word_Overrides + Words_Effective")

    def _migrate_v7_to_v8(self):
        """
        Repair missing Word_Book_Words links for CET/TOEFL/GRE.
        The v4→v5 migration wiped these links via FK cascade and v5→v6 could
        not restore them if the txt files were absent.  Try using the backup.
        """
        bundled_books = ["CET_4+6_edited", "TOEFL", "GRE_8000_Words"]
        backup_path = self.db_path + ".backup_v1"
        conn = self.connect()
        cursor = conn.cursor()
        for book_name in bundled_books:
            cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
            row = cursor.fetchone()
            if not row:
                continue
            book_id = row[0]
            cursor.execute("SELECT COUNT(*) FROM Word_Book_Words WHERE book_id = ?", (book_id,))
            if cursor.fetchone()[0] > 0:
                logger.info("v7→v8: book '%s' already has links — skipping", book_name)
                continue
            restored = self._restore_book_links_from_backup(cursor, book_id, book_name, backup_path)
            if restored:
                logger.info("v7→v8: restored %d links for '%s'", restored, book_name)
            else:
                logger.warning("v7→v8: could not restore links for '%s' (backup missing or unusable)", book_name)
        cursor.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (8,))
        conn.commit()
        conn.close()

    def _restore_book_links_from_backup(self, cursor, book_id: int, book_name: str, backup_path: str) -> int:
        """
        Restore Word_Book_Words entries for book_id using the v1 backup DB.
        The backup has book_identities TEXT columns we can mine for the original membership.
        Returns the number of links inserted (0 if backup not usable).
        """
        if not os.path.exists(backup_path):
            return 0
        try:
            backup_conn = sqlite3.connect(backup_path)
            backup_cursor = backup_conn.cursor()
            # Verify backup has old schema
            backup_cursor.execute("PRAGMA table_info(Words)")
            backup_cols = {col[1] for col in backup_cursor.fetchall()}
            if "book_identities" not in backup_cols:
                backup_conn.close()
                return 0
            # Get book_id as it was in the backup DB
            backup_cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
            row = backup_cursor.fetchone()
            if not row:
                backup_conn.close()
                return 0
            old_book_id = row[0]
            # Fetch all vocabs belonging to this book in the backup
            backup_cursor.execute(
                "SELECT vocab FROM Words WHERE book_identities LIKE ? OR book_identities LIKE ? "
                "OR book_identities LIKE ? OR book_identities = ?",
                (f"{old_book_id},%", f"%,{old_book_id},%", f"%,{old_book_id}", str(old_book_id))
            )
            vocabs = [row[0] for row in backup_cursor.fetchall()]
            backup_conn.close()
            if not vocabs:
                return 0
            inserted = 0
            for vocab in vocabs:
                cursor.execute("SELECT word_id FROM Words WHERE vocab = ?", (vocab,))
                word_row = cursor.fetchone()
                if word_row:
                    cursor.execute(
                        "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                        (book_id, word_row[0])
                    )
                    inserted += cursor.rowcount
            return inserted
        except Exception as e:
            logger.warning("v5→v6: failed to restore from backup for '%s': %s", book_name, e)
            return 0

    def _migrate_v5_to_v6(self):
        """
        Re-populate Word_Book_Words from bundled word list txt files.
        The v4→v5 migration accidentally wiped Word_Book_Words via FK cascade
        when it dropped the Words table. Words with definitions are still in
        the DB — we just need to re-link them to their books.
        """
        conn = self.connect()
        cursor = conn.cursor()

        bundled_books = [
            ("CET_4+6_edited", "CET_4+6_edited.txt"),
            ("TOEFL",           "TOEFL.txt"),
            ("GRE_8000_Words",  "GRE_8000_Words.txt"),
        ]

        # Ensure default books exist
        for book_name in DEFAULT_BOOKS:
            cursor.execute("INSERT OR IGNORE INTO Word_Book (book_name) VALUES (?)", (book_name,))

        for book_name, txt_file in bundled_books:
            # Ensure book row exists
            cursor.execute("INSERT OR IGNORE INTO Word_Book (book_name) VALUES (?)", (book_name,))
            cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = ?", (book_name,))
            row = cursor.fetchone()
            if not row:
                continue
            book_id = row[0]

            # If this book already has links, skip re-population.
            cursor.execute("SELECT COUNT(*) FROM Word_Book_Words WHERE book_id = ?", (book_id,))
            if cursor.fetchone()[0] > 0:
                logger.info("v5→v6: book '%s' already has links — skipping", book_name)
                continue

            txt_path = res_path("words", txt_file)
            if not os.path.exists(str(txt_path)):
                # Try to restore from the v1 backup created during v1→v2 migration.
                # The backup preserves the original book_identities column.
                backup_path = self.db_path + ".backup_v1"
                restored = self._restore_book_links_from_backup(cursor, book_id, book_name, backup_path)
                if restored:
                    logger.info("v5→v6: book '%s' — restored %d links from backup", book_name, restored)
                    conn.commit()
                else:
                    logger.warning("v5→v6: word list not found and no backup for '%s': %s", book_name, txt_path)
                continue

            with open(str(txt_path), "r", encoding="utf-8") as f:
                words = [line.strip().lower() for line in f if line.strip()]

            linked = inserted = 0
            for vocab in words:
                if not vocab:
                    continue
                cursor.execute("SELECT word_id FROM Words WHERE vocab = ?", (vocab,))
                word_row = cursor.fetchone()
                if word_row:
                    word_id = word_row[0]
                else:
                    cursor.execute("INSERT OR IGNORE INTO Words (vocab) VALUES (?)", (vocab,))
                    word_id = cursor.lastrowid
                    inserted += 1

                cursor.execute(
                    "INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?, ?)",
                    (book_id, word_id),
                )
                linked += 1

            conn.commit()
            logger.info("v5→v6: book '%s' — linked %d words (%d newly inserted)", book_name, linked, inserted)

        # Re-link all Words to Pre_Generate book (was also wiped)
        cursor.execute("SELECT book_id FROM Word_Book WHERE book_name = 'Pre_Generate'")
        row = cursor.fetchone()
        if row:
            pre_id = row[0]
            cursor.execute("""
                INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id)
                SELECT ?, word_id FROM Words
            """, (pre_id,))
            logger.info("v5→v6: Pre_Generate linked %d words", cursor.rowcount)

        cursor.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (6,))
        conn.commit()
        conn.close()
        logger.info("Migration v5→v6 completed: Word_Book_Words repopulated")

    def _migrate_v3_to_v4(self):
        """
        Fix orphaned due_dates: words with due_date set but stability=0 were
        pre-scheduled by the old list generator without going through FSRS review.
        They are invisible to both the 'new' query (due_date IS NULL) and the
        'review' query (fsrs_state > 0). Reset them to NULL so FSRS treats them
        as new words.
        """
        conn = self.connect()
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE Words SET due_date = NULL
            WHERE (stability IS NULL OR stability = 0)
              AND (fsrs_state IS NULL OR fsrs_state = 0)
              AND due_date IS NOT NULL
        """)
        affected = cursor.rowcount
        cursor.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (4,))
        conn.commit()
        conn.close()
        logger.info("Migration v3→v4 completed: reset due_date for %d unreviewed words", affected)
