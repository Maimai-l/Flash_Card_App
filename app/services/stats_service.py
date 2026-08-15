"""
Review history, summarised.

Deliberately absent: streaks, targets, and anything that turns a quiet week
into a failure. What is here describes what happened, not what should have.
"""

from __future__ import annotations

from datetime import date, timedelta

from ..db.deck_repo import normalise_path


class StatsService:
    def __init__(self, decks, cards):
        self.decks = decks
        self.cards = cards

    def _deck_ids(self, deck_path: str):
        return self.decks.descendant_ids(deck_path) if normalise_path(deck_path) else None

    def heatmap(self, deck_path: str = "", days: int = 182) -> dict:
        """Daily review counts, zero-filled so the calendar has no gaps."""
        days = max(7, min(int(days), 730))
        today = date.today()
        since = today - timedelta(days=days - 1)
        counts = {r["day"]: r["n"] for r in
                  self.cards.reviews_by_day(self._deck_ids(deck_path), since.isoformat())}
        series = []
        for offset in range(days):
            day = (since + timedelta(days=offset)).isoformat()
            series.append({"day": day, "count": counts.get(day, 0)})
        return {"days": series, "total": sum(counts.values())}

    def summary(self, deck_path: str = "") -> dict:
        deck_ids = self._deck_ids(deck_path)
        today = date.today()
        month_ago = (today - timedelta(days=29)).isoformat()
        ratings = self.cards.rating_totals(deck_ids, month_ago)
        answers = sum(ratings.values())
        correct = sum(int(n) for r, n in ratings.items() if r != "1")
        return {
            "deck": normalise_path(deck_path),
            "total_cards": self.cards.count_all(deck_ids),
            "states": self.cards.count_by_state(deck_ids),
            "ratings_30d": {str(r): ratings.get(str(r), 0) for r in (1, 2, 3, 4)},
            "answers_30d": answers,
            "retention_30d": round(100 * correct / answers) if answers else None,
            "hardest": [
                {
                    "card_id": c["card_id"],
                    "front": c["front"],
                    "lapses": c["lapses"],
                    "reps": c["reps"],
                }
                for c in self.cards.hardest_cards(deck_ids, 15)
            ],
        }
