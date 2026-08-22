"""
Quizzes: fixed question sets you take on demand.

Nothing here touches FSRS, deck budgets, or the review log. Grading happens in
the browser (every question type carries its own answer key), and the server is
told the result of each question as it is graded.

That per-question write is what makes leaving a quiz free: the run is on disk,
not in the tab. Card reviews already worked this way — each rating is a write —
and a quiz that lost eleven answered questions to a stray Escape was the odd one
out rather than a decision anyone made.
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
            group["in_progress"] = group["progress_answered"] is not None
        return groups

    def start(self, group_id: int, question_ids=None, resume: bool = False) -> dict:
        """
        Begin a run, or pick up the saved one.

        `resume` asks for the stored run; anything else starts fresh and drops
        whatever was in flight, because that is what "start over" means.
        """
        group = self.quizzes.get_group(group_id)
        if not group:
            return {"error": "Quiz not found"}

        available = {q["question_id"]: q for q in self.quizzes.get_questions(group_id)}
        result = {
            "group_id": group["group_id"],
            "name": group["name"],
            "subject": group["subject"] or "",
        }

        if resume:
            saved = self._usable_progress(group_id, available)
            if saved:
                result["questions"] = [available[qid] for qid in saved["question_ids"]]
                result["resumed"] = {
                    "position": saved["position"],
                    "answers": saved["answers"],
                }
                return result

        self.quizzes.clear_progress(group_id)
        questions = list(available.values())
        if question_ids:
            wanted = {int(q) for q in question_ids}
            questions = [q for q in questions if q["question_id"] in wanted]
        result["questions"] = questions
        result["resumed"] = None
        return result

    def _usable_progress(self, group_id: int, available: dict):
        """
        Saved progress is only usable if every question it names still exists.

        Re-importing a quiz replaces its questions and mints new ids, so a run
        saved before that import refers to rows that are gone. Resuming into it
        would show the wrong questions against the right answers; discard it.
        """
        saved = self.quizzes.get_progress(group_id)
        if not saved:
            return None
        ids = saved["question_ids"]
        if not ids or any(qid not in available for qid in ids):
            self.quizzes.clear_progress(group_id)
            return None
        if len(saved["answers"]) != len(ids) or not 0 <= saved["position"] < len(ids):
            self.quizzes.clear_progress(group_id)
            return None
        return saved

    def save_progress(self, group_id: int, question_ids, answers, position) -> dict:
        """Called after every graded question, so a run survives leaving."""
        if not self.quizzes.get_group(group_id):
            return {"error": "Quiz not found"}
        answered = sum(1 for a in answers if isinstance(a, dict) and a.get("answered"))
        self.quizzes.save_progress(
            group_id, question_ids, answers, position, answered,
            datetime.now(timezone.utc).isoformat(),
        )
        return {"ok": True, "answered": answered}

    def discard_progress(self, group_id: int) -> dict:
        self.quizzes.clear_progress(group_id)
        return {"ok": True}

    def finish(self, group_id: int, correct: int, total: int, wrong_ids=None) -> dict:
        group = self.quizzes.get_group(group_id)
        if not group:
            return {"error": "Quiz not found"}
        attempt_id = self.quizzes.record_attempt(
            group_id, int(correct), int(total), wrong_ids or [],
            datetime.now(timezone.utc).isoformat(),
        )
        self.quizzes.clear_progress(group_id)  # the run is over; nothing to resume
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
