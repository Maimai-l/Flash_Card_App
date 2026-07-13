"""
FSRS integration — single-step per-answer scheduling.

FsrsService.record_answer(word, rating) is called immediately after each
answer. It reads the word's current Card state, runs Scheduler().review_card(),
and writes the new state back through the word repository.

rating: 1=Again, 2=Hard, 3=Good, 4=Easy
"""
import logging
from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler

logger = logging.getLogger(__name__)


def _parse_dt(s):
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
    """Restore a py-fsrs Card object from stored fields."""
    from fsrs import State

    if not fsrs_state:
        return Card()  # never reviewed — brand new card

    due = _parse_dt(due_date) or datetime.now(timezone.utc)
    last = _parse_dt(last_review)

    try:
        state = State(fsrs_state)
    except ValueError:
        state = State.Learning

    # step is only meaningful in Learning/Relearning; Review expects None
    step = None if state == State.Review else (int(fsrs_step) if fsrs_step is not None else 0)

    return Card(
        state=state, step=step,
        stability=float(stability or 0), difficulty=float(difficulty or 0),
        due=due, last_review=last,
    )


class FsrsService:
    def __init__(self, word_repo):
        self.word_repo = word_repo

    def record_answer(self, word: str, rating_int: int) -> dict:
        """
        Run one FSRS review cycle for *word* and persist the result.

        Returns {ok, due_date, stability, difficulty, state} or {error}.
        """
        try:
            rating = Rating(rating_int)
        except ValueError:
            return {"error": f"Invalid rating {rating_int}; must be 1-4"}

        try:
            row = self.word_repo.get_fsrs_fields(word)
            if not row:
                return {"error": f"Word '{word}' not found in database"}

            stability, difficulty, due_date, last_review, fsrs_state, fsrs_step = row
            card = _build_card(stability, difficulty, due_date, last_review,
                               fsrs_state or 0, fsrs_step or 0)

            card, _ = Scheduler().review_card(card, rating)

            new_state = card.state.value if hasattr(card.state, "value") else int(card.state)
            new_step = int(card.step) if (hasattr(card, "step") and card.step is not None) else 0
            new_due = card.due.isoformat() if card.due else None
            new_last = card.last_review.isoformat() if card.last_review else None

            self.word_repo.update_fsrs_fields(
                word, card.stability, card.difficulty, new_due, new_last, new_state, new_step,
            )

            return {
                "ok": True,
                "due_date": new_due,
                "stability": card.stability,
                "difficulty": card.difficulty,
                "state": new_state,
            }
        except Exception as e:
            logger.exception("record_answer failed for '%s': %s", word, e)
            return {"error": str(e)}
