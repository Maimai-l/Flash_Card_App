"""
Review history, summarised.

Deliberately absent: streaks, targets, and anything that turns a quiet week
into a failure. What is here describes what happened, not what should have.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from ..db.deck_repo import normalise_path


class StatsService:
    def __init__(self, decks, cards, quizzes=None, settings=None, study=None):
        self.decks = decks
        self.cards = cards
        self.quizzes = quizzes
        self.settings = settings
        self.study = study

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

    # ── Export for an AI ──────────────────────────────────────────────────

    def ai_report(self) -> dict:
        """
        The study state as one object, written to be handed to a model.

        This is data, not interface: the due_next_7_days figure exists so a
        planner can weigh the week, and it never appears on a screen. The app
        does not explain, coach or plan; it hands over what happened and lets
        the conversation do the rest.
        """
        local_now = datetime.now().astimezone()
        horizon = datetime.combine(
            local_now.date() + timedelta(days=8), time.min, tzinfo=local_now.tzinfo,
        ).astimezone(timezone.utc).isoformat()
        month_ago = (date.today() - timedelta(days=29)).isoformat()

        subjects = []
        for deck in self.decks.all_decks():
            if "::" in deck["path"]:
                continue
            overview = self.study.overview(deck["path"])
            deck_ids = self.decks.descendant_ids(deck["path"])
            ratings = self.cards.rating_totals(deck_ids, month_ago)
            answers = sum(ratings.values())
            subjects.append({
                "subject": deck["path"],
                "total_cards": overview["total_cards"],
                "states": overview["states"],
                "limits": {
                    "new": None if overview["unlimited_new"] else overview["new_limit"],
                    "review": None if overview["unlimited_review"] else overview["review_limit"],
                },
                "today": {
                    "new_done": overview["new_done"],
                    "review_done": overview["review_done"],
                    "new_waiting": overview["new_available"],
                    "review_waiting": overview["review_available"],
                },
                # Both cursors at the horizon: this is workload ahead, so a
                # learning step due tonight belongs in it as much as a review
                # due on Thursday.
                "due_next_7_days": self.cards.count_due(deck_ids, horizon, horizon),
                "answers_30d": answers,
                "again_rate_30d": round(ratings.get("1", 0) / answers, 3) if answers else None,
                "hardest": [
                    {"id": c.get("ext_id"), "front": c["front"], "lapses": c["lapses"]}
                    for c in self.cards.hardest_cards(deck_ids, 5)
                ],
            })

        quizzes = [
            {
                "name": g["name"],
                "subject": g["subject"] or "",
                "questions": g["question_count"],
                "attempts": g["attempts"],
                "last": ({"correct": g["last_correct"], "total": g["last_total"],
                          "taken": g["last_taken"]} if g["attempts"] else None),
                "in_progress": bool(g["progress_total"]),
            }
            for g in self.quizzes.list_groups()
        ]

        return {
            "kc_export": 1,
            "kind": "report",
            "generated": local_now.isoformat(timespec="seconds"),
            "defaults": {
                "new_limit": int(self.settings.get("default_new_limit", "10")),
                "review_limit": int(self.settings.get("default_review_limit", "60")),
            },
            "subjects": subjects,
            "quizzes": quizzes,
        }
