"""
Quiz storage.

Quizzes are deliberately unrelated to cards: no foreign key, no shared
scheduling, no shared counters. A group is a fixed list of questions you can
sit down and take; an attempt is what happened the last time you did.

Question bodies are stored as raw JSON so an unknown question type survives a
round trip through the database untouched.
"""

from __future__ import annotations

import json

from .connection import Repository


class QuizRepository(Repository):

    # ── Groups ────────────────────────────────────────────────────────────

    def list_groups(self) -> list[dict]:
        rows = self._all(
            "SELECT g.group_id, g.ext_id, g.name, g.subject, g.created_at, "
            "  (SELECT COUNT(*) FROM Quiz_Question q WHERE q.group_id = g.group_id) AS question_count, "
            "  (SELECT a.correct FROM Quiz_Attempt a WHERE a.group_id = g.group_id "
            "     ORDER BY a.attempt_id DESC LIMIT 1) AS last_correct, "
            "  (SELECT a.total FROM Quiz_Attempt a WHERE a.group_id = g.group_id "
            "     ORDER BY a.attempt_id DESC LIMIT 1) AS last_total, "
            "  (SELECT a.finished_at FROM Quiz_Attempt a WHERE a.group_id = g.group_id "
            "     ORDER BY a.attempt_id DESC LIMIT 1) AS last_taken, "
            "  (SELECT COUNT(*) FROM Quiz_Attempt a WHERE a.group_id = g.group_id) AS attempts, "
            "  (SELECT p.answered FROM Quiz_Progress p WHERE p.group_id = g.group_id) AS progress_answered, "
            "  (SELECT p.total FROM Quiz_Progress p WHERE p.group_id = g.group_id) AS progress_total "
            "FROM Quiz_Group g ORDER BY g.subject, g.name"
        )
        return rows

    def get_group(self, group_id: int) -> dict | None:
        return self._one("SELECT * FROM Quiz_Group WHERE group_id = ?", (int(group_id),))

    def find_group_by_ext_id(self, ext_id: str) -> dict | None:
        return self._one("SELECT * FROM Quiz_Group WHERE ext_id = ?", (ext_id,))

    def create_group(self, name: str, subject: str = "", ext_id=None) -> int:
        return self._exec(
            "INSERT INTO Quiz_Group (ext_id, name, subject) VALUES (?, ?, ?)",
            (ext_id or None, name, subject or ""),
        )

    def rename_group(self, group_id: int, name: str, subject: str) -> None:
        self._exec(
            "UPDATE Quiz_Group SET name = ?, subject = ? WHERE group_id = ?",
            (name, subject or "", int(group_id)),
        )

    def delete_group(self, group_id: int) -> None:
        self._exec("DELETE FROM Quiz_Group WHERE group_id = ?", (int(group_id),))

    # ── Questions ─────────────────────────────────────────────────────────

    @staticmethod
    def _encode(questions: list[dict]) -> list[tuple[str, str]]:
        """The (type, payload) pairs a question list is stored as."""
        return [(str(q.get("type", "")), json.dumps(q, ensure_ascii=False)) for q in questions]

    def questions_differ(self, group_id: int, questions: list[dict]) -> bool:
        """
        Would writing this list actually change anything?

        Compared as stored, in order, so the answer is the same one
        `replace_questions` will act on and the preview cannot promise something
        the commit does not do.
        """
        current = self._all(
            "SELECT type, payload FROM Quiz_Question WHERE group_id = ? ORDER BY position",
            (int(group_id),),
        )
        return [(r["type"], r["payload"]) for r in current] != self._encode(questions)

    def replace_questions(self, group_id: int, questions: list[dict]) -> bool:
        """
        Swap a group's question list, and say whether that was necessary.

        An identical re-import is a no-op. That matters beyond saving two
        statements: DELETE and INSERT mint new question_ids, an in-flight run
        stores the old ones, and the run is discarded when they no longer
        resolve. Re-importing an unchanged file used to throw away a quiz you
        were halfway through.

        When the questions really do change, that run cannot survive, so it goes
        in the same transaction rather than being left for the next `start` to
        notice. Otherwise the list keeps offering *Resume* on a run that no
        longer exists.
        """
        if not self.questions_differ(group_id, questions):
            return False
        conn = self.db.connect()
        try:
            conn.execute("DELETE FROM Quiz_Question WHERE group_id = ?", (int(group_id),))
            conn.executemany(
                "INSERT INTO Quiz_Question (group_id, position, type, payload) VALUES (?, ?, ?, ?)",
                [(int(group_id), i, t, payload)
                 for i, (t, payload) in enumerate(self._encode(questions))],
            )
            conn.execute("DELETE FROM Quiz_Progress WHERE group_id = ?", (int(group_id),))
            conn.commit()
        finally:
            conn.close()
        return True

    def get_questions(self, group_id: int) -> list[dict]:
        rows = self._all(
            "SELECT question_id, position, type, payload FROM Quiz_Question "
            "WHERE group_id = ? ORDER BY position",
            (int(group_id),),
        )
        out = []
        for r in rows:
            try:
                body = json.loads(r["payload"])
            except (ValueError, TypeError):
                body = {"type": "unknown"}
            body["question_id"] = r["question_id"]
            body["type"] = r["type"]
            out.append(body)
        return out

    # ── In-flight progress ────────────────────────────────────────────────

    def save_progress(self, group_id: int, question_ids: list[int], answers: list,
                      position: int, answered: int, updated_at: str) -> None:
        """Overwrite the single in-flight run for this quiz."""
        self._exec(
            "INSERT INTO Quiz_Progress "
            "(group_id, question_ids, answers, position, answered, total, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(group_id) DO UPDATE SET "
            "  question_ids = excluded.question_ids, answers = excluded.answers, "
            "  position = excluded.position, answered = excluded.answered, "
            "  total = excluded.total, updated_at = excluded.updated_at",
            (int(group_id), json.dumps([int(q) for q in question_ids]),
             json.dumps(answers, ensure_ascii=False), int(position), int(answered),
             len(question_ids), updated_at),
        )

    def get_progress(self, group_id: int) -> dict | None:
        row = self._one("SELECT * FROM Quiz_Progress WHERE group_id = ?", (int(group_id),))
        if not row:
            return None
        try:
            row["question_ids"] = json.loads(row["question_ids"])
            row["answers"] = json.loads(row["answers"])
        except (ValueError, TypeError):
            return None
        return row

    def clear_progress(self, group_id: int) -> None:
        self._exec("DELETE FROM Quiz_Progress WHERE group_id = ?", (int(group_id),))

    # ── Attempts ──────────────────────────────────────────────────────────

    def record_attempt(self, group_id: int, correct: int, total: int,
                       wrong_ids: list[int], finished_at: str) -> int:
        return self._exec(
            "INSERT INTO Quiz_Attempt (group_id, finished_at, correct, total, wrong_ids) "
            "VALUES (?, ?, ?, ?, ?)",
            (int(group_id), finished_at, int(correct), int(total),
             json.dumps([int(i) for i in wrong_ids])),
        )

    def list_attempts(self, group_id: int, limit: int = 20) -> list[dict]:
        return self._all(
            "SELECT attempt_id, finished_at, correct, total FROM Quiz_Attempt "
            "WHERE group_id = ? ORDER BY attempt_id DESC LIMIT ?",
            (int(group_id), int(limit)),
        )

    def export_group(self, group_id: int) -> dict | None:
        group = self.get_group(group_id)
        if not group:
            return None
        questions = []
        for q in self.get_questions(group_id):
            q.pop("question_id", None)
            questions.append(q)
        return {
            "name": group["name"],
            "subject": group["subject"],
            "id": group["ext_id"],
            "questions": questions,
        }
