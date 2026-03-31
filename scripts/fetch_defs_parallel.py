"""
fetch_defs_parallel.py
──────────────────────
多线程并行为全库词条从有道获取释义，写入 Word_Overrides。
- 缓存命中直接返回，无需等待
- 仅未缓存词发网络请求，每个 worker 有独立 sleep
- 已有 definition_zh override 的词默认跳过（--force 强制重写）

Usage:
    python scripts/fetch_defs_parallel.py                 # dry-run
    python scripts/fetch_defs_parallel.py --commit        # 写入
    python scripts/fetch_defs_parallel.py --commit --workers 4 --sleep 0.5
    python scripts/fetch_defs_parallel.py --commit --force  # 覆盖已有 override
"""

import argparse
import re
import shutil
import sqlite3
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from youdao_dict import lookup, YoudaoConfig


DB_PATH = Path(os.path.expanduser(
    "~/Library/Application Support/FlashCardApp/data/database/vocabulary.db"
))
CACHE_DIR = Path(__file__).parent.parent / "youdao_cache"

_db_lock  = threading.Lock()
_print_lock = threading.Lock()
_counter  = {"done": 0, "written": 0, "failed": 0, "skipped": 0}


def clean_vocab(v: str) -> str:
    return re.sub(r'\[.*\]$', '', v).strip()

def format_definition(translations: list) -> str:
    return "；".join(t.strip() for t in translations if t.strip())

def safe_print(*args):
    with _print_lock:
        print(*args, flush=True)


def process_word(args_tuple):
    wid, word, cfg, sess, commit, conn = args_tuple

    result = lookup(word, cfg, session=sess)
    with _print_lock:
        _counter["done"] += 1

    if not result:
        _counter["failed"] += 1
        if _counter["done"] % 100 == 0:
            safe_print(f"  [{_counter['done']}] {word:<28} FETCH FAILED")
        return

    trs = result.get("translations", [])
    if not trs:
        return

    definition_zh = format_definition(trs)

    # Also grab example if sentences available
    sents = result.get("sentences", [])
    example_en = example_zh = None
    for s in sents:
        en = s.get("sentence", "").strip()
        zh = s.get("translation", "").strip()
        if en and re.search(r'\b' + re.escape(word) + r'\b', en, re.IGNORECASE):
            example_en, example_zh = en, zh
            break

    done = _counter["done"]
    total = _counter.get("total", "?")
    if done % 500 == 0 or done <= 10:
        safe_print(f"  [{done}/{total}] {word:<28} {definition_zh[:50]}")

    if commit:
        with _db_lock:
            try:
                conn.execute("""
                    INSERT INTO Word_Overrides
                        (word_id, definition_zh, example_en, example_zh, updated_time)
                    VALUES (?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(word_id) DO UPDATE SET
                        definition_zh = excluded.definition_zh,
                        example_en    = CASE WHEN excluded.example_en IS NOT NULL
                                             THEN excluded.example_en
                                             ELSE Word_Overrides.example_en END,
                        example_zh    = CASE WHEN excluded.example_zh IS NOT NULL
                                             THEN excluded.example_zh
                                             ELSE Word_Overrides.example_zh END,
                        updated_time  = excluded.updated_time
                """, (wid, definition_zh, example_en, example_zh))
                _counter["written"] += 1
                if _counter["written"] % 500 == 0:
                    conn.commit()
            except Exception as e:
                safe_print(f"  DB error [{word}]: {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit",  action="store_true")
    parser.add_argument("--force",   action="store_true", help="Overwrite existing definition overrides")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--sleep",   type=float, default=0.5, help="Sleep per worker between non-cached requests")
    parser.add_argument("--limit",   type=int, default=0)
    parser.add_argument("--db",      default=None)
    args = parser.parse_args()

    db_path = Path(args.db) if args.db else DB_PATH
    if not db_path.exists():
        print(f"ERROR: DB not found at {db_path}"); return

    if args.commit:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = db_path.with_name(f"vocabulary.db.defs_{stamp}.bak")
        shutil.copy2(db_path, bak)
        print(f"[backup] {bak}")

    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")  # allows concurrent reads during writes

    if args.force:
        conn.execute("SELECT w.word_id, w.vocab FROM Words w WHERE LENGTH(w.vocab) >= 3")
        rows = [(r[0], clean_vocab(r[1])) for r in conn.execute(
            "SELECT word_id, vocab FROM Words WHERE LENGTH(vocab) >= 3"
        ) if clean_vocab(r[1])]
    else:
        # Skip words already having a definition_zh override
        rows = [(r[0], clean_vocab(r[1])) for r in conn.execute("""
            SELECT w.word_id, w.vocab
            FROM Words w
            LEFT JOIN Word_Overrides o ON w.word_id = o.word_id
            WHERE LENGTH(w.vocab) >= 3
              AND (o.definition_zh IS NULL OR TRIM(o.definition_zh) = '')
            ORDER BY w.vocab
        """) if clean_vocab(r[1])]

    if args.limit:
        rows = rows[:args.limit]

    _counter["total"] = len(rows)

    print(f"Words to process : {len(rows)}")
    print(f"Workers          : {args.workers}")
    print(f"Sleep/worker     : {args.sleep}s  (cached words are instant)")
    print(f"Mode             : {'COMMIT' if args.commit else 'DRY-RUN'}")
    est_uncached = max(0, len(rows) - 30000)
    est_hours = est_uncached / args.workers / (1 / args.sleep) / 3600
    print(f"Est. time        : ~{est_hours:.1f}h (assuming ~{30000} already cached)")
    print()

    cfg = YoudaoConfig(cache_dir=str(CACHE_DIR), sleep_seconds=args.sleep, retries=2)

    start = time.time()

    # Each worker gets its own Session
    sessions = [requests.Session() for _ in range(args.workers)]

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(process_word, (wid, word, cfg, sessions[i % args.workers], args.commit, conn))
            for i, (wid, word) in enumerate(rows)
        ]
        try:
            for f in as_completed(futures):
                f.result()  # re-raise any exception
        except KeyboardInterrupt:
            print("\nInterrupted — committing progress so far...")

    if args.commit:
        conn.commit()

    elapsed = time.time() - start
    print(f"\nDone in {elapsed/60:.1f} min")
    print(f"Written  : {_counter['written']}")
    print(f"Failed   : {_counter['failed']}")
    if not args.commit:
        print("[dry-run] Re-run with --commit to apply.")

    for s in sessions:
        s.close()
    conn.close()


if __name__ == "__main__":
    main()
