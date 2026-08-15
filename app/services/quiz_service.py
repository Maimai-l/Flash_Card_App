"""
Quizzes: fixed question sets you take on demand.

Nothing here touches FSRS, deck budgets, or the review log. Grading happens in
the browser (every question type carries its own answer key), and the server is
told only the summary — which is all an attempt record needs.
"""

from __future__ import annotations

from datetime import datetime, timezone


class QuizService:
    def __init__(self, quizzes):
        self.quizzes = quizzes

    def list_groups(self) -> list[dict]:
        groups = self.quizzes.list_groups()
        for group in groups:
            group["subject"] = group["subject"] or ""
        return groups

    def start(self, group_id: int, question_ids=None) -> dict:
        group = self.quizzes.get_group(group_id)
        if not group:
            return {"error": "Quiz not found"}
        questions = self.quizzes.get_questions(group_id)
        if question_ids:
            wanted = {int(q) for q in question_ids}
            questions = [q for q in questions if q.get("question_id") in wanted]
        return {
            "group_id": group["group_id"],
            "name": group["name"],
            "subject": group["subject"] or "",
            "questions": questions,
        }

    def finish(self, group_id: int, correct: int, total: int, wrong_ids=None) -> dict:
        group = self.quizzes.get_group(group_id)
        if not group:
            return {"error": "Quiz not found"}
        attempt_id = self.quizzes.record_attempt(
            group_id, int(correct), int(total), wrong_ids or [],
            datetime.now(timezone.utc).isoformat(),
        )
        return {"ok": True, "attempt_id": attempt_id}

    def attempts(self, group_id: int) -> list[dict]:
        return self.quizzes.list_attempts(group_id)

    def rename(self, group_id: int, name: str, subject: str = "") -> dict:
        name = (name or "").strip()
        if not name:
            return {"error": "Quiz name cannot be empty"}
        self.quizzes.rename_group(group_id, name, subject)
        return {"ok": True}

    def delete(self, group_id: int) -> dict:
        self.quizzes.delete_group(group_id)
        return {"ok": True}
