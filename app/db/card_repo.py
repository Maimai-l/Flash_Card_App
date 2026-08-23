"""
Card storage: CRUD, the scheduling queue, the review log and undo.

Two notions of "due" are kept apart, the way every spaced-repetition system
does it:

  * learning / relearning cards are due to the minute (an "Again" comes back
    in one minute and should come back in this same sitting)
  * review cards are due to the day (a card scheduled for 14:00 today is due
    all day, not just after 14:00)

Callers pass `now` and `review_cutoff` (end of the *local* day expressed in
UTC) so the day boundary follows the user's clock rather than UTC's.
"""

from __future__ import annotations

from .connection import Repository

CARD_COLUMNS = (
    "card_id, ext_id, deck_id, front, back, hint, tags, stability, difficulty, "
    "due_date, last_review, fsrs_state, fsrs_step, reps, lapses, suspended, "
    "created_at, updated_at"
)

DUE_CLAUSE = (
    "(suspended = 0 AND last_review IS NOT NULL AND ("
    "  (fsrs_state = 2 AND due_date <= ?) OR (fsrs_state IN (1, 3) AND due_date <= ?)"
    "))"
)


def _deck_filter(deck_ids: list[int] | None) -> tuple[str, tuple]:
    """Build a `deck_id IN (...)` fragment; an unset filter matches every deck."""
    if deck_ids is None:
        return "1=1", ()
    if not deck_ids:
        return "1=0", ()
    return f"deck_id IN ({','.join('?' * len(deck_ids))})", tuple(deck_ids)


class CardRepository(Repository):

    # ── Reads ─────────────────────────────────────────────────────────────

    def by_id(self, card_id: int) -> dict | None:
        return self._one(f"SELECT {CARD_COLUMNS} FROM Card WHERE card_id = ?", (int(card_id),))

    def list_cards(self, deck_ids=None, search="", offset=0, limit=100) -> dict:
        where, params = _deck_filter(deck_ids)
        if search:
            where += " AND (front LIKE ? OR back LIKE ? OR tags LIKE ?)"
            like = f"%{search}%"
            params = params + (like, like, like)
        total = self._scalar(f"SELECT COUNT(*) FROM Card WHERE {where}", params)
        rows = self._all(
            f"SELECT {CARD_COLUMNS} FROM Card WHERE {where} "
            "ORDER BY updated_at DESC, card_id DESC LIMIT ? OFFSET ?",
            params + (int(limit), int(offset)),
        )
        return {"total": total, "cards": rows}

    def new_cards(self, deck_ids, limit: int) -> list[dict]:
        where, params = _deck_filter(deck_ids)
        if limit <= 0:
            return []
        return self._all(
            f"SELECT {CARD_COLUMNS} FROM Card "
            f"WHERE {where} AND suspended = 0 AND last_review IS NULL "
            "ORDER BY card_id LIMIT ?",
            params + (int(limit),),
        )

    def due_cards(self, deck_ids, now: str, review_cutoff: str, limit: int) -> list[dict]:
        where, params = _deck_filter(deck_ids)
        if limit <= 0:
            return []
        return self._all(
            f"SELECT {CARD_COLUMNS} FROM Card WHERE {where} AND {DUE_CLAUSE} "
            "ORDER BY due_date LIMIT ?",
            params + (review_cutoff, now, int(limit)),
        )

    def count_new(self, deck_ids) -> int:
        where, params = _deck_filter(deck_ids)
        return self._scalar(
            f"SELECT COUNT(*) FROM Card WHERE {where} AND suspended = 0 AND last_review IS NULL",
            params,
        )

    def count_due(self, deck_ids, now: str, review_cutoff: str) -> int:
        where, params = _deck_filter(deck_ids)
        return self._scalar(
            f"SELECT COUNT(*) FROM Card WHERE {where} AND {DUE_CLAUSE}",
            params + (review_cutoff, now),
        )

    def count_all(self, deck_ids) -> int:
        where, params = _deck_filter(deck_ids)
        return self._scalar(f"SELECT COUNT(*) FROM Card WHERE {where}", params)

    def count_by_state(self, deck_ids) -> dict:
        where, params = _deck_filter(deck_ids)
        rows = self._all(
            f"SELECT CASE WHEN last_review IS NULL THEN 'new' "
            f"            WHEN fsrs_state = 2 THEN 'review' ELSE 'learning' END AS bucket, "
            f"COUNT(*) AS n FROM Card WHERE {where} GROUP BY bucket",
            params,
        )
        out = {"new": 0, "learning": 0, "review": 0}
        for r in rows:
            out[r["bucket"]] = r["n"]
        return out

    def deck_counts(self, now: str, review_cutoff: str) -> list[dict]:
        """Per-deck totals, counted on the deck itself (not its subtree)."""
        return self._all(
            f"SELECT deck_id, COUNT(*) AS total, "
            f"SUM(CASE WHEN suspended = 0 AND last_review IS NULL THEN 1 ELSE 0 END) AS new_count, "
            f"SUM(CASE WHEN {DUE_CLAUSE} THEN 1 ELSE 0 END) AS due_count "
            "FROM Card GROUP BY deck_id",
            (review_cutoff, now),
        )

    # ── Writes ────────────────────────────────────────────────────────────

    def create(self, deck_id: int, front: str, back: str, hint="", tags="", ext_id=None) -> int:
        return self._exec(
            "INSERT INTO Card (ext_id, deck_id, front, back, hint, tags) VALUES (?, ?, ?, ?, ?, ?)",
            (ext_id or None, int(deck_id), front, back, hint, tags),
        )

    def update_content(self, card_id: int, front, back, hint=None, tags=None, deck_id=None) -> dict:
        sets, params = ["front = ?", "back = ?"], [front, back]
        if hint is not None:
            sets.append("hint = ?")
            params.append(hint)
        if tags is not None:
            sets.append("tags = ?")
            params.append(tags)
        if deck_id is not None:
            sets.append("deck_id = ?")
            params.append(int(deck_id))
        sets.append("updated_at = datetime('now')")
        params.append(int(card_id))
        self._exec(f"UPDATE Card SET {', '.join(sets)} WHERE card_id = ?", tuple(params))
        return self.by_id(card_id)

    def move_to_deck(self, card_ids: list[int], deck_id: int) -> int:
        if not card_ids:
            return 0
        placeholders = ",".join("?" * len(card_ids))
        self._exec(
            f"UPDATE Card SET deck_id = ?, updated_at = datetime('now')"
            f" WHERE card_id IN ({placeholders})",
            (int(deck_id), *[int(c) for c in card_ids]),
        )
        return len(card_ids)

    def delete(self, card_ids: list[int]) -> int:
        if not card_ids:
            return 0
        placeholders = ",".join("?" * len(card_ids))
        self._exec(f"DELETE FROM Card WHERE card_id IN ({placeholders})",
                   tuple(int(c) for c in card_ids))
        return len(card_ids)

    def set_suspended(self, card_ids: list[int], suspended: bool) -> int:
        if not card_ids:
            return 0
        placeholders = ",".join("?" * len(card_ids))
        self._exec(
            f"UPDATE Card SET suspended = ?, updated_at = datetime('now')"
            f" WHERE card_id IN ({placeholders})",
            (1 if suspended else 0, *[int(c) for c in card_ids]),
        )
        return len(card_ids)

    def find_by_ext_id(self, ext_id: str) -> dict | None:
        return self._one(f"SELECT {CARD_COLUMNS} FROM Card WHERE ext_id = ?", (ext_id,))

    def find_by_front(self, deck_id: int, front: str) -> dict | None:
        """Used to spot a re-paste of the same card rather than duplicating it."""
        return self._one(
            f"SELECT {CARD_COLUMNS} FROM Card WHERE deck_id = ? AND front = ?",
            (int(deck_id), front),
        )

    # ── Review + log ──────────────────────────────────────────────────────

    def apply_review(self, card_id: int, rating: int, scheduled: dict,
                     reviewed_at: str, review_day: str) -> int:
        """
        Write a card's new FSRS state and append the log row that makes the
        review undoable and countable against the day's limits.
        """
        conn = self.db.connect()
        try:
            prev = conn.execute(
                "SELECT stability, difficulty, due_date, last_review, fsrs_state, fsrs_step, "
                "reps, lapses FROM Card WHERE card_id = ?", (int(card_id),)
            ).fetchone()
            if prev is None:
                raise ValueError(f"Card {card_id} not found")

            was_new = prev["last_review"] is None
            already_today = conn.execute(
                "SELECT 1 FROM Review_Log WHERE card_id = ? AND review_day = ? LIMIT 1",
                (int(card_id), review_day),
            ).fetchone()
            lapsed = 1 if (rating == 1 and prev["fsrs_state"] == 2) else 0

            conn.execute(
                "INSERT INTO Review_Log (card_id, rating, reviewed_at, review_day, was_new, "
                "first_of_day, prev_stability, prev_difficulty, prev_due_date, prev_last_review, "
                "prev_state, prev_step, prev_reps, prev_lapses) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (int(card_id), int(rating), reviewed_at, review_day,
                 1 if was_new else 0, 0 if already_today else 1,
                 prev["stability"], prev["difficulty"], prev["due_date"], prev["last_review"],
                 prev["fsrs_state"], prev["fsrs_step"], prev["reps"], prev["lapses"]),
            )
            conn.execute(
                "UPDATE Card SET stability = ?, difficulty = ?, due_date = ?, last_review = ?, "
                "fsrs_state = ?, fsrs_step = ?, reps = reps + 1, lapses = lapses + ?, "
                "updated_at = datetime('now') WHERE card_id = ?",
                (scheduled["stability"], scheduled["difficulty"], scheduled["due_date"],
                 scheduled["last_review"], scheduled["state"], scheduled["step"],
                 lapsed, int(card_id)),
            )
            conn.commit()
        finally:
            conn.close()
        return int(card_id)

    def undo_last_review(self) -> dict | None:
        """Roll the most recent review back and return the restored card."""
        conn = self.db.connect()
        try:
            log = conn.execute(
                "SELECT * FROM Review_Log ORDER BY log_id DESC LIMIT 1"
            ).fetchone()
            if log is None:
                return None
            conn.execute(
                "UPDATE Card SET stability = ?, difficulty = ?, due_date = ?, last_review = ?, "
                "fsrs_state = ?, fsrs_step = ?, reps = ?, lapses = ?, "
                "updated_at = datetime('now') WHERE card_id = ?",
                (log["prev_stability"], log["prev_difficulty"], log["prev_due_date"],
                 log["prev_last_review"], log["prev_state"], log["prev_step"],
                 log["prev_reps"], log["prev_lapses"], log["card_id"]),
            )
            conn.execute("DELETE FROM Review_Log WHERE log_id = ?", (log["log_id"],))
            conn.commit()
            row = conn.execute(
                f"SELECT {CARD_COLUMNS} FROM Card WHERE card_id = ?", (log["card_id"],)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def counts_done_today(self, deck_ids, review_day: str) -> dict:
        """
        How much of today's budget is already spent.

        Only a card's *first* review of the day counts, so an "Again" that
        brings a card back ten minutes later does not eat the budget twice.
        """
        where, params = _deck_filter(deck_ids)
        row = self._one(
            "SELECT "
            "  SUM(CASE WHEN l.was_new = 1 THEN 1 ELSE 0 END) AS new_done, "
            "  SUM(CASE WHEN l.was_new = 0 AND l.first_of_day = 1 THEN 1 ELSE 0 END) AS review_done, "
            "  COUNT(*) AS answers "
            "FROM Review_Log l JOIN Card c ON c.card_id = l.card_id "
            f"WHERE l.review_day = ? AND {where.replace('deck_id', 'c.deck_id')}",
            (review_day, *params),
        ) or {}
        return {
            "new_done": row.get("new_done") or 0,
            "review_done": row.get("review_done") or 0,
            "answers": row.get("answers") or 0,
        }

    def reviews_by_day(self, deck_ids, since: str) -> list[dict]:
        where, params = _deck_filter(deck_ids)
        return self._all(
            "SELECT l.review_day AS day, COUNT(*) AS n "
            "FROM Review_Log l JOIN Card c ON c.card_id = l.card_id "
            f"WHERE l.review_day >= ? AND {where.replace('deck_id', 'c.deck_id')} "
            "GROUP BY l.review_day ORDER BY l.review_day",
            (since, *params),
        )

    def rating_totals(self, deck_ids, since: str) -> dict:
        where, params = _deck_filter(deck_ids)
        rows = self._all(
            "SELECT l.rating AS rating, COUNT(*) AS n "
            "FROM Review_Log l JOIN Card c ON c.card_id = l.card_id "
            f"WHERE l.review_day >= ? AND {where.replace('deck_id', 'c.deck_id')} "
            "GROUP BY l.rating",
            (since, *params),
        )
        return {str(r["rating"]): r["n"] for r in rows}

    def hardest_cards(self, deck_ids, limit: int = 20) -> list[dict]:
        where, params = _deck_filter(deck_ids)
        return self._all(
            f"SELECT {CARD_COLUMNS} FROM Card WHERE {where} AND lapses > 0 "
            "ORDER BY lapses DESC, difficulty DESC LIMIT ?",
            params + (int(limit),),
        )

    def export_rows(self, deck_ids) -> list[dict]:
        where, params = _deck_filter(deck_ids)
        return self._all(
            "SELECT c.ext_id, d.path AS deck, c.front, c.back, c.hint, c.tags "
            f"FROM Card c JOIN Deck d ON d.deck_id = c.deck_id WHERE {where.replace('deck_id', 'c.deck_id')} "
            "ORDER BY d.path, c.card_id",
            params,
        )
