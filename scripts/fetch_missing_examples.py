"""
fetch_missing_examples.py
─────────────────────────
用有道词典 API 为词库补充高质量中英文例句和释义，写入 Word_Overrides（非破坏性）。

模式：
  默认            仅处理 FIG 挖空失败的词，补例句 + 释义
  --defs-all      处理库里所有词，只更新释义（大量走缓存，无缓存才请求）

Usage:
    python scripts/fetch_missing_examples.py              # dry-run
    python scripts/fetch_missing_examples.py --commit     # 写入数据库
    python scripts/fetch_missing_examples.py --limit 50   # 只处理前 50 个（测试）
    python scripts/fetch_missing_examples.py --sleep 0.8  # 请求间隔(秒)
    python scripts/fetch_missing_examples.py --defs-all --commit   # 全库更新释义
"""

import argparse
import re
import shutil
import sqlite3
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from youdao_dict import lookup, YoudaoConfig


DB_PATH = Path(os.path.expanduser(
    "~/Library/Application Support/FlashCardApp/data/database/vocabulary.db"
))
CACHE_DIR = Path(__file__).parent.parent / "youdao_cache"


def clean_vocab(v: str) -> str:
    return re.sub(r'\[.*\]$', '', v).strip()

def base_match(word: str, sentence: str) -> bool:
    return bool(re.search(r'\b' + re.escape(word) + r'\b', sentence, re.IGNORECASE))

def prefix_match(word: str, sentence: str) -> bool:
    return bool(re.search(r'\b' + re.escape(word) + r'\w*\b', sentence, re.IGNORECASE))

def best_sentence(word: str, sentences: list):
    """Return (en, zh) of first sentence containing exact base form, or None."""
    for s in sentences:
        en = s.get("sentence", "").strip()
        zh = s.get("translation", "").strip()
        if en and base_match(word, en):
            return en, zh
    return None

def format_definition(translations: list) -> str:
    """Join Youdao translations list into a single definition string."""
    return "；".join(t.strip() for t in translations if t.strip())


def upsert_override(cur, word_id: int, example_en=None, example_zh=None, definition_zh=None):
    """Insert or update Word_Overrides, only setting non-None fields."""
    # Build SET clause dynamically for non-None fields
    fields = {}
    if example_en   is not None: fields["example_en"]   = example_en
    if example_zh   is not None: fields["example_zh"]   = example_zh
    if definition_zh is not None: fields["definition_zh"] = definition_zh
    if not fields:
        return

    set_clause = ", ".join(f"{k} = excluded.{k}" for k in fields)
    placeholders = ", ".join("?" for _ in range(len(fields) + 1))  # +1 for word_id
    col_names = ", ".join(["word_id"] + list(fields.keys()))

    cur.execute(f"""
        INSERT INTO Word_Overrides ({col_names}, updated_time)
        VALUES ({placeholders}, datetime('now'))
        ON CONFLICT(word_id) DO UPDATE SET
            {set_clause},
            updated_time = datetime('now')
    """, [word_id] + list(fields.values()))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit",   action="store_true", help="Write to DB (default: dry-run)")
    parser.add_argument("--defs-all", action="store_true", help="Update definitions for ALL words in DB")
    parser.add_argument("--limit",    type=int, default=0,   help="Max words to process (0=all)")
    parser.add_argument("--sleep",    type=float, default=0.8, help="Seconds between non-cached requests")
    parser.add_argument("--db",       default=None)
    args = parser.parse_args()

    db_path = Path(args.db) if args.db else DB_PATH
    if not db_path.exists():
        print(f"ERROR: DB not found at {db_path}"); return

    if args.commit:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = db_path.with_name(f"vocabulary.db.fetchex_{stamp}.bak")
        shutil.copy2(db_path, bak)
        print(f"[backup] {bak}")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    if args.defs_all:
        # ── Mode: update definitions for all words ────────────────────────
        cur.execute("""
            SELECT w.word_id, w.vocab
            FROM Words w
            WHERE LENGTH(w.vocab) >= 3
            ORDER BY w.vocab
        """)
        rows = [(wid, clean_vocab(v)) for wid, v in cur.fetchall() if clean_vocab(v)]
        mode_label = "DEFS-ALL"
    else:
        # ── Mode: fix FIG-failing examples (+ update their definitions) ──
        cur.execute("""
            SELECT w.word_id, w.vocab, w.example_en
            FROM Words w
            LEFT JOIN Word_Overrides o ON w.word_id = o.word_id
            WHERE LENGTH(w.vocab) >= 3
              AND w.example_en IS NOT NULL AND TRIM(w.example_en) != ''
              AND (o.example_en IS NULL OR TRIM(o.example_en) = '')
        """)
        raw = cur.fetchall()
        rows = [
            (wid, clean_vocab(v), ex)
            for wid, v, ex in raw
            if clean_vocab(v) and not prefix_match(clean_vocab(v), ex)
        ]
        mode_label = "FIG-FIX"

    if args.limit:
        rows = rows[:args.limit]

    print(f"Words to process : {len(rows)}")
    print(f"Mode             : {mode_label} | {'COMMIT' if args.commit else 'DRY-RUN'}")
    print(f"Request sleep    : {args.sleep}s (cache hits are instant)")
    print()

    cfg = YoudaoConfig(cache_dir=str(CACHE_DIR), sleep_seconds=args.sleep, retries=2)

    n_ex_fixed   = 0
    n_def_fixed  = 0
    n_fetch_fail = 0
    n_no_sent    = 0

    import requests
    with requests.Session() as sess:
        for i, row in enumerate(rows):
            if args.defs_all:
                wid, word = row
                old_ex = None
            else:
                wid, word, old_ex = row

            result = lookup(word, cfg, session=sess)

            if not result:
                n_fetch_fail += 1
                print(f"  [{i+1}/{len(rows)}] {word:<28} FETCH FAILED")
                continue

            new_ex_en = new_ex_zh = new_def = None

            # Definition
            trs = result.get("translations", [])
            if trs:
                new_def = format_definition(trs)

            # Example (only in FIG-fix mode)
            if not args.defs_all:
                pick = best_sentence(word, result.get("sentences", []))
                if pick:
                    new_ex_en, new_ex_zh = pick
                    n_ex_fixed += 1
                else:
                    n_no_sent += 1

            if new_def:
                n_def_fixed += 1

            tag = "✓" if (new_ex_en or args.defs_all) else "~"
            detail = (new_ex_en or new_def or "")[:60]
            print(f"  [{i+1}/{len(rows)}] {word:<28} {tag}  {detail}")

            if args.commit:
                upsert_override(cur, wid,
                    example_en=new_ex_en,
                    example_zh=new_ex_zh or None,
                    definition_zh=new_def)
                if (i + 1) % 200 == 0:
                    conn.commit()  # periodic commit to avoid huge transactions

    if args.commit:
        conn.commit()

    print()
    if not args.defs_all:
        print(f"Examples fixed : {n_ex_fixed}")
        print(f"No sent match  : {n_no_sent}")
    print(f"Defs updated   : {n_def_fixed}")
    print(f"Fetch failures : {n_fetch_fail}")
    if not args.commit:
        print(f"\n[dry-run] Re-run with --commit to apply.")
    else:
        print(f"\n[commit] Done.")

    conn.close()


if __name__ == "__main__":
    main()
