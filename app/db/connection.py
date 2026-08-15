"""
SQLite connection + schema.

Two independent halves live in this database and never reference each other:

  Deck / Card / Review_Log   persistent flashcards, scheduled by FSRS
  Quiz_Group / Quiz_Question / Quiz_Attempt   one-off quizzes, never scheduled

Deck limits are only meaningful on top-level decks; sub-decks inherit from
their root. A NULL limit means "use the global default from Settings".
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS Deck (
    deck_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    path         TEXT NOT NULL UNIQUE,
    parent_id    INTEGER REFERENCES Deck(deck_id) ON DELETE CASCADE,
    new_limit    INTEGER,
    review_limit INTEGER,
    created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Card (
    card_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ext_id      TEXT UNIQUE,
    deck_id     INTEGER NOT NULL REFERENCES Deck(deck_id) ON DELETE CASCADE,
    front       TEXT NOT NULL,
    back        TEXT NOT NULL,
    hint        TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    stability   REAL,
    difficulty  REAL,
    due_date    TEXT,
    last_review TEXT,
    fsrs_state  INTEGER NOT NULL DEFAULT 0,
    fsrs_step   INTEGER,
    reps        INTEGER NOT NULL DEFAULT 0,
    lapses      INTEGER NOT NULL DEFAULT 0,
    suspended   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Review_Log (
    log_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id          INTEGER NOT NULL REFERENCES Card(card_id) ON DELETE CASCADE,
    rating           INTEGER NOT NULL,
    reviewed_at      TEXT NOT NULL,
    review_day       TEXT NOT NULL,
    was_new          INTEGER NOT NULL DEFAULT 0,
    first_of_day     INTEGER NOT NULL DEFAULT 0,
    prev_stability   REAL,
    prev_difficulty  REAL,
    prev_due_date    TEXT,
    prev_last_review TEXT,
    prev_state       INTEGER,
    prev_step        INTEGER,
    prev_reps        INTEGER,
    prev_lapses      INTEGER
);

CREATE TABLE IF NOT EXISTS Quiz_Group (
    group_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    ext_id     TEXT UNIQUE,
    name       TEXT NOT NULL,
    subject    TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Quiz_Question (
    question_id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES Quiz_Group(group_id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Quiz_Attempt (
    attempt_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES Quiz_Group(group_id) ON DELETE CASCADE,
    finished_at TEXT NOT NULL,
    correct     INTEGER NOT NULL,
    total       INTEGER NOT NULL,
    wrong_ids   TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS Settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_card_deck ON Card(deck_id);
CREATE INDEX IF NOT EXISTS idx_card_due  ON Card(due_date);
CREATE INDEX IF NOT EXISTS idx_deck_parent ON Deck(parent_id);
CREATE INDEX IF NOT EXISTS idx_log_card ON Review_Log(card_id);
CREATE INDEX IF NOT EXISTS idx_log_day  ON Review_Log(review_day);
CREATE INDEX IF NOT EXISTS idx_qq_group ON Quiz_Question(group_id);
CREATE INDEX IF NOT EXISTS idx_qa_group ON Quiz_Attempt(group_id);
"""

DEFAULT_SETTINGS = {
    "default_new_limit": "10",
    "default_review_limit": "60",
    "language": "en",
    "easy_threshold_seconds": "6",
}


class Database:
    """Owns the sqlite file: connections, schema creation, migrations."""

    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def initialize(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = self.connect()
        try:
            conn.executescript(SCHEMA_SQL)
            for key, value in DEFAULT_SETTINGS.items():
                conn.execute(
                    "INSERT OR IGNORE INTO Settings (key, value) VALUES (?, ?)", (key, value)
                )
            conn.execute(
                "INSERT OR IGNORE INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,)
            )
            conn.commit()
        finally:
            conn.close()
        logger.info("Database ready at %s (schema v%d)", self.db_path, SCHEMA_VERSION)


class Repository:
    """Base class giving repositories a connection and small query helpers."""

    def __init__(self, database: Database):
        self.db = database

    def _all(self, sql: str, params=()) -> list[dict]:
        conn = self.db.connect()
        try:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def _one(self, sql: str, params=()) -> dict | None:
        conn = self.db.connect()
        try:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _scalar(self, sql: str, params=(), default=0):
        conn = self.db.connect()
        try:
            row = conn.execute(sql, params).fetchone()
            return row[0] if row and row[0] is not None else default
        finally:
            conn.close()

    def _exec(self, sql: str, params=()) -> int:
        conn = self.db.connect()
        try:
            cur = conn.execute(sql, params)
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()
