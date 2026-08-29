"""
The review session: what is due, how much of it you get today, and what one
answer does to a card.

Daily limits are per *subject* (top-level deck). Selecting a chapter draws from
its subject's budget rather than getting a fresh one, and selecting "all decks"
walks each subject's budget separately instead of merging them into one pool —
so a heavy day of maths cannot silently eat the CS allowance.

Everything that says "today" means today on the user's clock, not UTC.
"""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone

from ..db.deck_repo import root_of, normalise_path

logger = logging.getLogger(__name__)

UNLIMITED = 1_000_000
# A card rescheduled within this many seconds comes back in the same sitting.
SAME_SESSION_SECONDS = 20 * 60


class DayWindow:
    """Boundaries of the current local day, expressed in the UTC the DB stores."""

    def __init__(self):
        local_now = datetime.now().astimezone()
        start_local = datetime.combine(local_now.date(), time.min, tzinfo=local_now.tzinfo)
        self.day = local_now.date().isoformat()
        self.now = datetime.now(timezone.utc)
        self.now_iso = self.now.isoformat()
        self.start_iso = start_local.astimezone(timezone.utc).isoformat()
        self.end_iso = (start_local + timedelta(days=1)).astimezone(timezone.utc).isoformat()


class StudyService:
    def __init__(self, decks, cards, settings, fsrs):
        self.decks = decks
        self.cards = cards
        self.settings = settings
        self.fsrs = fsrs

    # ── Budgets ───────────────────────────────────────────────────────────

    def _default_limits(self) -> tuple[int, int]:
        return (
            self.settings.get_int("default_new_limit", 10),
            self.settings.get_int("default_review_limit", 60),
        )

    def _limits_for_root(self, root_path: str) -> tuple[int, int]:
        default_new, default_review = self._default_limits()
        new_limit, review_limit = self.decks.limits_for(root_path)
        new_limit = default_new if new_limit is None else int(new_limit)
        review_limit = default_review if review_limit is None else int(review_limit)
        return (
            UNLIMITED if new_limit < 0 else new_limit,
            UNLIMITED if review_limit < 0 else review_limit,
        )

    def _scopes(self, deck_path: str) -> list[dict]:
        """
        Split a selection into one entry per subject.

        `select` is the set of decks cards are drawn from; `budget` is the
        subject subtree the day's limits are measured over.
        """
        deck_path = normalise_path(deck_path or "")
        if deck_path:
            root = root_of(deck_path)
            return [{
                "root": root,
                "select": self.decks.descendant_ids(deck_path),
                "budget": self.decks.descendant_ids(root),
            }]
        scopes = []
        for deck in self.decks.all_decks():
            if deck["parent_id"] is None:
                ids = self.decks.descendant_ids(deck["path"])
                scopes.append({"root": deck["path"], "select": ids, "budget": ids})
        return scopes

    def _remaining(self, scope: dict, window: DayWindow) -> dict:
        new_limit, review_limit = self._limits_for_root(scope["root"])
        done = self.cards.counts_done_today(scope["budget"], window.day)
        return {
            "new_limit": new_limit,
            "review_limit": review_limit,
            "new_done": done["new_done"],
            "review_done": done["review_done"],
            "new_left": max(0, new_limit - done["new_done"]),
            "review_left": max(0, review_limit - done["review_done"]),
        }

    # ── Overview ──────────────────────────────────────────────────────────

    def overview(self, deck_path: str = "") -> dict:
        window = DayWindow()
        scopes = self._scopes(deck_path)
        selected = self.decks.descendant_ids(deck_path) if normalise_path(deck_path) else None

        totals = {
            "new_available": 0, "review_available": 0,
            "new_total": 0, "due_total": 0,
            "new_limit": 0, "review_limit": 0, "new_done": 0, "review_done": 0,
        }
        for scope in scopes:
            budget = self._remaining(scope, window)
            new_here = self.cards.count_new(scope["select"])
            due_here = self.cards.count_due(scope["select"], window.now_iso, window.end_iso)
            totals["new_total"] += new_here
            totals["due_total"] += due_here
            totals["new_available"] += min(new_here, budget["new_left"])
            totals["review_available"] += min(due_here, budget["review_left"])
            totals["new_limit"] += min(budget["new_limit"], UNLIMITED)
            totals["review_limit"] += min(budget["review_limit"], UNLIMITED)
            totals["new_done"] += budget["new_done"]
            totals["review_done"] += budget["review_done"]

        totals["deck"] = normalise_path(deck_path)
        totals["subjects"] = len(scopes)
        totals["total_cards"] = self.cards.count_all(selected)
        totals["states"] = self.cards.count_by_state(selected)
        totals["unlimited_new"] = totals["new_limit"] >= UNLIMITED
        totals["unlimited_review"] = totals["review_limit"] >= UNLIMITED
        return totals

    def deck_tree(self) -> list[dict]:
        """Every deck with counts rolled up from its subtree, ordered for display."""
        window = DayWindow()
        decks = self.decks.all_decks()
        raw = {r["deck_id"]: r for r in self.cards.deck_counts(window.now_iso, window.end_iso)}

        by_path = {}
        for deck in decks:
            counts = raw.get(deck["deck_id"], {})
            by_path[deck["path"]] = {
                "path": deck["path"],
                "name": deck["name"],
                "deck_id": deck["deck_id"],
                "depth": deck["path"].count("::"),
                "new_limit": deck["new_limit"],
                "review_limit": deck["review_limit"],
                "total": 0, "new_count": 0, "due_count": 0,
                "_own": {
                    "total": counts.get("total") or 0,
                    "new_count": counts.get("new_count") or 0,
                    "due_count": counts.get("due_count") or 0,
                },
            }
        for path, node in by_path.items():
            prefix = path + "::"
            for other_path, other in by_path.items():
                if other_path == path or other_path.startswith(prefix):
                    for key in ("total", "new_count", "due_count"):
                        node[key] += other["_own"][key]
        for node in by_path.values():
            node.pop("_own")
        return sorted(by_path.values(), key=lambda d: d["path"])

    # ── Queue ─────────────────────────────────────────────────────────────

    def build_queue(self, deck_path: str = "", ignore_limits: bool = False) -> dict:
        """
        The cards for one sitting: everything owed today up to the review cap,
        then new cards up to the new cap.

        `ignore_limits` backs the "study more" button — an explicit, per-sitting
        opt-out. The caps themselves never move, so tomorrow starts unchanged.
        """
        window = DayWindow()
        due_cards, new_cards = [], []
        for scope in self._scopes(deck_path):
            budget = self._remaining(scope, window)
            review_left = UNLIMITED if ignore_limits else budget["review_left"]
            new_left = UNLIMITED if ignore_limits else budget["new_left"]
            due_cards += self.cards.due_cards(
                scope["select"], window.now_iso, window.end_iso, review_left)
            new_cards += self.cards.new_cards(scope["select"], new_left)

        due_cards.sort(key=lambda c: c["due_date"] or "")
        queue = [self._present(c) for c in due_cards + new_cards]
        return {
            "deck": normalise_path(deck_path),
            "cards": queue,
            "due_count": len(due_cards),
            "new_count": len(new_cards),
        }

    def browse(self, deck_path: str = "", limit: int = 200) -> dict:
        """Read-only pass over a deck. Touches nothing FSRS owns."""
        deck_ids = self.decks.descendant_ids(deck_path) if normalise_path(deck_path) else None
        rows = self.cards.list_cards(deck_ids, offset=0, limit=limit)
        return {"deck": normalise_path(deck_path),
                "cards": [self._present(c, intervals=False) for c in rows["cards"]],
                "total": rows["total"]}

    def _present(self, row: dict, intervals: bool = True) -> dict:
        card = {
            "card_id": row["card_id"],
            "ext_id": row["ext_id"],
            "front": row["front"],
            "back": row["back"],
            "hint": row["hint"],
            "tags": [t for t in (row["tags"] or "").split(",") if t],
            "deck_id": row["deck_id"],
            "is_new": row["last_review"] is None,
            "reps": row["reps"],
            "lapses": row["lapses"],
        }
        if intervals:
            card["intervals"] = self.fsrs.preview(row)
        return card

    # ── Answering ─────────────────────────────────────────────────────────

    def answer(self, card_id: int, rating: int) -> dict:
        rating = int(rating)
        if rating not in (1, 2, 3, 4):
            return {"error": f"Invalid rating {rating}; expected 1-4"}
        row = self.cards.by_id(card_id)
        if not row:
            return {"error": f"Card {card_id} not found"}

        window = DayWindow()
        scheduled = self.fsrs.schedule(row, rating, window.now)
        self.cards.apply_review(card_id, rating, scheduled, window.now_iso, window.day)

        requeue = (
            scheduled["state"] in (1, 3)
            and scheduled["interval_seconds"] <= SAME_SESSION_SECONDS
        )
        result = {
            "ok": True,
            "card_id": card_id,
            "requeue": requeue,
            "due_date": scheduled["due_date"],
            "state": scheduled["state"],
        }
        if requeue:
            result["card"] = self._present(self.cards.by_id(card_id))
        return result

    def undo(self) -> dict:
        card = self.cards.undo_last_review()
        if not card:
            return {"ok": False, "error": "Nothing to undo"}
        return {"ok": True, "card": self._present(card)}
