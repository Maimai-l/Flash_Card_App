"""
FSRS scheduling for a single card.

Two things are needed by the UI: what a rating *would* do (so the four buttons
can show their intervals before you commit) and what it actually did. Both run
through the same reconstruction of a py-fsrs Card from the stored columns.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler, State

logger = logging.getLogger(__name__)

RATINGS = (1, 2, 3, 4)


def _parse_dt(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _build_card(row: dict) -> Card:
    """Restore a py-fsrs Card from a Card table row; never-reviewed rows start fresh."""
    if not row.get("last_review"):
        return Card()
    try:
        state = State(int(row.get("fsrs_state") or 1))
    except ValueError:
        state = State.Learning
    step = None if state == State.Review else int(row.get("fsrs_step") or 0)
    return Card(
        state=state,
        step=step,
        stability=row.get("stability"),
        difficulty=row.get("difficulty"),
        due=_parse_dt(row.get("due_date")) or datetime.now(timezone.utc),
        last_review=_parse_dt(row.get("last_review")),
    )


def format_interval(seconds: float) -> str:
    """Render a scheduling delay the way review buttons do: 10m, 2h, 3d, 5mo."""
    seconds = max(0.0, float(seconds))
    minutes = seconds / 60
    if minutes < 1:
        return "<1m"
    if minutes < 60:
        return f"{round(minutes)}m"
    hours = minutes / 60
    if hours < 24:
        return f"{round(hours)}h"
    days = hours / 24
    if days < 30:
        return f"{round(days)}d"
    months = days / 30.44
    if months < 12:
        return f"{months:.1f}mo".replace(".0", "")
    return f"{days / 365.25:.1f}y".replace(".0", "")


class FsrsService:
    def __init__(self):
        self.scheduler = Scheduler()

    def schedule(self, row: dict, rating: int, now: datetime | None = None) -> dict:
        """Run one review and return the card's new persisted fields."""
        now = now or datetime.now(timezone.utc)
        card, _ = self.scheduler.review_card(_build_card(row), Rating(int(rating)), now)
        state = card.state.value if hasattr(card.state, "value") else int(card.state)
        return {
            "stability": card.stability,
            "difficulty": card.difficulty,
            "due_date": card.due.isoformat() if card.due else None,
            "last_review": card.last_review.isoformat() if card.last_review else None,
            "state": state,
            "step": int(card.step) if card.step is not None else None,
            "interval_seconds": (card.due - now).total_seconds() if card.due else 0,
        }

    def preview(self, row: dict, now: datetime | None = None) -> dict:
        """Interval label for each of the four ratings, without persisting anything."""
        now = now or datetime.now(timezone.utc)
        out = {}
        for rating in RATINGS:
            try:
                result = self.schedule(row, rating, now)
                out[str(rating)] = format_interval(result["interval_seconds"])
            except Exception:
                logger.exception("interval preview failed for rating %s", rating)
                out[str(rating)] = ""
        return out
