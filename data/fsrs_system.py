"""
FSRS integration — single-step per-answer updates.

record_answer(db_path, word, rating_int)
    Called immediately after each question answer.
    rating_int: 1=Again, 2=Hard, 3=Good, 4=Easy
    Reads current Card state from DB, runs scheduler.review_card(), writes back.
"""

import logging
import sqlite3
from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler

logger = logging.getLogger(__name__)


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _build_card(stability, difficulty, due_date, last_review, fsrs_state, fsrs_step) -> Card:
    """Restore a py-fsrs Card object from DB fields."""
    from fsrs import State

    if not fsrs_state:
        # Never reviewed — brand new card
        return Card()

    due  = _parse_dt(due_date) or datetime.now(timezone.utc)
    last = _parse_dt(last_review)

    try:
        state = State(fsrs_state)
    except ValueError:
        state = State.Learning

    # step is only meaningful in Learning (1) and Relearning (3) states
    # For Review state (2) py-fsrs expects None
    if state == State.Review:
        step = None
    else:
        step = int(fsrs_step) if fsrs_step is not None else 0

    return Card(
        state=state,
        step=step,
        stability=float(stability or 0),
        difficulty=float(difficulty or 0),
        due=due,
        last_review=last,
    )


def record_answer(db_path: str, word: str, rating_int: int) -> dict:
    """
    Perform one FSRS review cycle for *word* and persist the result.

    Parameters
    ----------
    db_path    : path to vocabulary.db
    word       : vocab string (case-insensitive match)
    rating_int : 1=Again, 2=Hard, 3=Good, 4=Easy
    """
    try:
        rating = Rating(rating_int)
    except ValueError:
        return {"error": f"Invalid rating {rating_int}; must be 1-4"}

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT stability, difficulty, due_date, last_review, fsrs_state, fsrs_step "
            "FROM Words WHERE vocab = ? COLLATE NOCASE LIMIT 1",
            (word,),
        )
        row = cursor.fetchone()
        if not row:
            conn.close()
            return {"error": f"Word '{word}' not found in database"}

        stability, difficulty, due_date, last_review, fsrs_state, fsrs_step = row
        card = _build_card(stability, difficulty, due_date, last_review,
                           fsrs_state or 0, fsrs_step or 0)

        scheduler = Scheduler()
        card, _ = scheduler.review_card(card, rating)

        new_state = card.state.value if hasattr(card.state, "value") else int(card.state)
        new_step  = int(card.step) if (hasattr(card, "step") and card.step is not None) else 0
        new_due   = card.due.isoformat() if card.due else None
        new_last  = card.last_review.isoformat() if card.last_review else None

        cursor.execute(
            """
            UPDATE Words SET
                stability    = ?,
                difficulty   = ?,
                due_date     = ?,
                last_review  = ?,
                fsrs_state   = ?,
                fsrs_step    = ?,
                updated_time = datetime('now')
            WHERE vocab = ? COLLATE NOCASE
            """,
            (card.stability, card.difficulty, new_due, new_last,
             new_state, new_step, word),
        )
        conn.commit()
        conn.close()

        return {
            "ok":         True,
            "due_date":   new_due,
            "stability":  card.stability,
            "difficulty": card.difficulty,
            "state":      new_state,
        }

    except Exception as e:
        logger.exception("record_answer failed for '%s': %s", word, e)
        return {"error": str(e)}
