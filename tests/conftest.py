"""
Pytest fixtures for FlashCard App.

Central idea: point the app at a throwaway user-data directory (via the
FLASHCARD_USER_DATA env var) that already contains a *small* v9 vocabulary.db,
so tests never trigger the slow v1->v9 migration of the 34 MB bundled seed
(which takes minutes). A handful of fixture words with known FSRS state is
enough to exercise every read/write path.
"""
import os
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


# ── Fixture data ────────────────────────────────────────────────────────────
# (vocab, definition_zh, example_en, example_zh, fsrs_state, stability)
# fsrs_state 0 = new/never-seen, 2 = Review (learned). due_date set for learned.
FIXTURE_WORDS = [
    ("abate",     "v.减轻；减少",       "The storm gradually abated.", "暴风雨逐渐减弱。", 2, 15.0),
    ("candid",    "adj.坦率的；直白的", "a candid opinion",            "坦率的意见",       2, 40.0),
    ("elated",    "adj.兴高采烈的",     "She felt elated.",            "她感到兴高采烈。", 2,  3.0),
    ("frugal",    "adj.节俭的",         "a frugal lifestyle",          "节俭的生活方式",   2, 60.0),
    ("gregarious","adj.爱交际的",       "a gregarious person",         "爱交际的人",       1,  1.5),
    ("nascent",   "n.新生的；初期的",   "a nascent industry",          "新兴产业",         0,  0.0),
    ("opaque",    "adj.不透明的",       "opaque glass",                "不透明玻璃",       0,  0.0),
    ("pragmatic", "adj.务实的",         "a pragmatic approach",        "务实的方法",       0,  0.0),
    ("quell",     "v.平息；镇压",       "quell the unrest",            "平息骚乱",         0,  0.0),
    ("zealous",   "adj.热心的",         "a zealous supporter",         "热心的支持者",     0,  0.0),
]


def build_fixture_db(db_path: Path):
    """Create a small, ready-to-use v9 schema DB with known words + books."""
    from data.db.connection import CREATE_TABLES_SQL, SCHEMA_VERSION

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()
    cur.executescript(CREATE_TABLES_SQL)
    cur.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,))

    for book in ("Pre_Generate", "User_Import", "TOEFL"):
        cur.execute("INSERT OR IGNORE INTO Word_Book (book_name) VALUES (?)", (book,))
    cur.execute("SELECT book_id FROM Word_Book WHERE book_name='TOEFL'")
    toefl_id = cur.fetchone()[0]
    cur.execute("SELECT book_id FROM Word_Book WHERE book_name='Pre_Generate'")
    pre_id = cur.fetchone()[0]

    for vocab, dzh, exen, exzh, state, stab in FIXTURE_WORDS:
        due = "2020-01-01 00:00:00" if state > 0 else None  # learned words are overdue
        last = "2020-01-01 00:00:00" if state > 0 else None
        cur.execute(
            "INSERT INTO Words (vocab, definition_zh, example_en, example_zh, "
            "stability, difficulty, due_date, last_review, fsrs_state) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (vocab, dzh, exen, exzh, stab, 5.0 if state else 0, due, last, state),
        )
        wid = cur.lastrowid
        cur.execute("INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?,?)", (toefl_id, wid))
        cur.execute("INSERT OR IGNORE INTO Word_Book_Words (book_id, word_id) VALUES (?,?)", (pre_id, wid))

    conn.commit()
    conn.close()


@pytest.fixture
def user_data_dir(tmp_path, monkeypatch):
    """A throwaway user-data dir seeded with the small fixture DB (no migration)."""
    ud = tmp_path / "userdata"
    (ud / "data" / "database").mkdir(parents=True)
    build_fixture_db(ud / "data" / "database" / "vocabulary.db")
    (ud / "seed_version").write_text("1")  # matches BUNDLE_SEED_VERSION -> no reseed
    monkeypatch.setenv("FLASHCARD_USER_DATA", str(ud))
    # paths.py caches USER_DATA_ROOT at import time; reimport so the env var applies.
    _reload_paths()
    return ud


def _reload_paths():
    import importlib
    import paths
    importlib.reload(paths)


@pytest.fixture
def library(user_data_dir):
    """A LibraryService bound to the fixture DB."""
    # Ensure modules that captured data_path at import get the reloaded paths.
    import importlib
    import gui.library as lib_mod
    importlib.reload(lib_mod)
    return lib_mod.LibraryService()


@pytest.fixture
def api(library):
    """An Api facade bound to the fixture library."""
    import importlib
    import gui.api as api_mod
    importlib.reload(api_mod)
    return api_mod.Api(library)
