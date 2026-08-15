"""
JSON import and export.

One paste box handles both halves of the app; the top-level key decides which.
Import is a two-step affair — analyse, show what would happen, then commit —
and both steps run the same parser, so the preview cannot drift from the write.

Nothing here ever rejects a whole payload for one bad entry: unusable rows are
reported and skipped so a 200-card paste is not lost to a single typo.
"""

from __future__ import annotations

import json
import logging
import re

from ..db.deck_repo import normalise_path

logger = logging.getLogger(__name__)

KNOWN_QUESTION_TYPES = ("mcq", "cloze", "short", "ordering")
CLOZE_PATTERN = re.compile(r"\{\{(.+?)\}\}", re.S)


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "\n".join(str(v) for v in value)
    return str(value).strip()


def _tags(value) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        parts = value.split(",")
    else:
        parts = list(value)
    return ",".join(sorted({str(p).strip() for p in parts if str(p).strip()}))


class Issue(dict):
    def __init__(self, level: str, where: str, message: str):
        super().__init__(level=level, where=where, message=message)


class ImportService:
    def __init__(self, decks, cards, quizzes):
        self.decks = decks
        self.cards = cards
        self.quizzes = quizzes

    # ── Parsing ───────────────────────────────────────────────────────────

    def analyse(self, raw_text: str, default_deck: str = "") -> dict:
        """Turn pasted text into a plan plus the issues found reading it."""
        issues: list[Issue] = []
        try:
            payload = json.loads(raw_text or "")
        except ValueError as exc:
            return {"ok": False, "issues": [Issue("error", "json", f"Invalid JSON: {exc}")],
                    "cards": [], "quizzes": []}

        if not isinstance(payload, dict):
            if isinstance(payload, list):
                payload = {"cards": payload}
            else:
                return {"ok": False, "cards": [], "quizzes": [],
                        "issues": [Issue("error", "json",
                                         "Top level must be an object with 'cards' or 'quiz'")]}

        deck_default = normalise_path(default_deck or payload.get("deck") or "")
        cards = self._parse_cards(payload, deck_default, issues)
        quizzes = self._parse_quizzes(payload, issues)

        if not cards and not quizzes and not any(i["level"] == "error" for i in issues):
            issues.append(Issue("error", "json", "Nothing to import: no 'cards' and no 'quiz'"))

        return {
            "ok": bool(cards or quizzes),
            "cards": cards,
            "quizzes": quizzes,
            "issues": issues,
        }

    def _parse_cards(self, payload: dict, deck_default: str, issues: list) -> list[dict]:
        entries = payload.get("cards")
        if entries is None:
            return []
        if not isinstance(entries, list):
            issues.append(Issue("error", "cards", "'cards' must be a list"))
            return []

        parsed = []
        for index, entry in enumerate(entries):
            where = f"cards[{index}]"
            if not isinstance(entry, dict):
                issues.append(Issue("error", where, "Each card must be an object"))
                continue
            front, back = _text(entry.get("front")), _text(entry.get("back"))
            if not front:
                issues.append(Issue("error", where, "Missing 'front'"))
                continue
            if not back:
                issues.append(Issue("error", where, "Missing 'back'"))
                continue
            deck = normalise_path(entry.get("deck") or deck_default)
            if not deck:
                issues.append(Issue("error", where, "No deck given, and no top-level 'deck'"))
                continue
            parsed.append({
                "ext_id": _text(entry.get("id")) or None,
                "deck": deck,
                "front": front,
                "back": back,
                "hint": _text(entry.get("hint")),
                "tags": _tags(entry.get("tags")),
                "where": where,
            })
        return parsed

    def _parse_quizzes(self, payload: dict, issues: list) -> list[dict]:
        groups = []
        if isinstance(payload.get("quiz"), dict):
            groups.append(payload["quiz"])
        if isinstance(payload.get("quizzes"), list):
            groups += [g for g in payload["quizzes"] if isinstance(g, dict)]
        if payload.get("quiz") is not None and not isinstance(payload.get("quiz"), dict):
            issues.append(Issue("error", "quiz", "'quiz' must be an object"))

        parsed = []
        for index, group in enumerate(groups):
            where = f"quiz[{index}]"
            name = _text(group.get("name"))
            if not name:
                issues.append(Issue("error", where, "Missing quiz 'name'"))
                continue
            raw_questions = group.get("questions")
            if not isinstance(raw_questions, list) or not raw_questions:
                issues.append(Issue("error", where, f"Quiz '{name}' has no questions"))
                continue
            questions = self._parse_questions(raw_questions, f"{where}.questions", issues)
            if not questions:
                issues.append(Issue("error", where, f"Quiz '{name}' has no usable questions"))
                continue
            parsed.append({
                "ext_id": _text(group.get("id")) or None,
                "name": name,
                "subject": _text(group.get("subject") or group.get("deck")),
                "questions": questions,
            })
        return parsed

    def _parse_questions(self, entries: list, where_prefix: str, issues: list) -> list[dict]:
        questions = []
        for index, entry in enumerate(entries):
            where = f"{where_prefix}[{index}]"
            if not isinstance(entry, dict):
                issues.append(Issue("error", where, "Each question must be an object"))
                continue
            qtype = _text(entry.get("type")).lower()
            if qtype not in KNOWN_QUESTION_TYPES:
                issues.append(Issue(
                    "warning", where,
                    f"Unknown question type '{qtype or '(missing)'}' — skipped"))
                continue
            problem = self._validate_question(qtype, entry)
            if problem:
                issues.append(Issue("error", where, problem))
                continue
            entry = dict(entry)
            entry["type"] = qtype
            questions.append(entry)
        return questions

    @staticmethod
    def _validate_question(qtype: str, q: dict) -> str | None:
        if qtype == "mcq":
            options = q.get("options")
            if not isinstance(options, list) or len(options) < 2:
                return "mcq needs at least 2 'options'"
            if not _text(q.get("prompt")):
                return "mcq needs a 'prompt'"
            answer = q.get("answer")
            indices = answer if isinstance(answer, list) else [answer]
            if not indices or any(not isinstance(i, int) for i in indices):
                return "mcq 'answer' must be an option index, or a list of indices"
            if any(i < 0 or i >= len(options) for i in indices):
                return f"mcq 'answer' out of range (0-{len(options) - 1})"
        elif qtype == "cloze":
            text = _text(q.get("text"))
            if not text:
                return "cloze needs 'text'"
            if not CLOZE_PATTERN.search(text):
                return "cloze 'text' has no {{blank}}"
        elif qtype == "short":
            if not _text(q.get("prompt")):
                return "short needs a 'prompt'"
            answers = q.get("answers")
            if not isinstance(answers, list) or not [a for a in answers if _text(a)]:
                return "short needs a non-empty 'answers' list"
        elif qtype == "ordering":
            items = q.get("items")
            if not isinstance(items, list) or len(items) < 2:
                return "ordering needs at least 2 'items'"
            if not _text(q.get("prompt")):
                return "ordering needs a 'prompt'"
        return None

    # ── Preview ───────────────────────────────────────────────────────────

    def preview(self, raw_text: str, default_deck: str = "") -> dict:
        plan = self.analyse(raw_text, default_deck)
        new_cards, updated_cards, duplicates = 0, 0, 0
        decks = {}
        for card in plan["cards"]:
            decks[card["deck"]] = decks.get(card["deck"], 0) + 1
            if card["ext_id"] and self.cards.find_by_ext_id(card["ext_id"]):
                updated_cards += 1
            elif not card["ext_id"] and self._existing_duplicate(card):
                duplicates += 1
            else:
                new_cards += 1

        quizzes = []
        for group in plan["quizzes"]:
            existing = self._find_group(group)
            quizzes.append({
                "name": group["name"],
                "subject": group["subject"],
                "questions": len(group["questions"]),
                "action": "replace" if existing else "create",
            })

        return {
            "ok": plan["ok"],
            "issues": plan["issues"],
            "cards": {
                "new": new_cards,
                "updated": updated_cards,
                "duplicates": duplicates,
                "decks": [{"deck": d, "count": n} for d, n in sorted(decks.items())],
            },
            "quizzes": quizzes,
        }

    def _existing_duplicate(self, card: dict):
        deck = self.decks.by_path(card["deck"])
        if not deck:
            return None
        return self.cards.find_by_front(deck["deck_id"], card["front"])

    def _find_group(self, group: dict):
        if group["ext_id"]:
            return self.quizzes.find_group_by_ext_id(group["ext_id"])
        for existing in self.quizzes.list_groups():
            if existing["name"] == group["name"] and existing["subject"] == group["subject"]:
                return existing
        return None

    # ── Commit ────────────────────────────────────────────────────────────

    def commit(self, raw_text: str, default_deck: str = "", allow_duplicates: bool = False) -> dict:
        plan = self.analyse(raw_text, default_deck)
        if not plan["ok"]:
            return {"ok": False, "issues": plan["issues"],
                    "cards": {"new": 0, "updated": 0, "duplicates": 0}, "quizzes": []}

        deck_ids: dict[str, int] = {}
        created, updated, skipped = 0, 0, 0
        for card in plan["cards"]:
            if card["deck"] not in deck_ids:
                deck_ids[card["deck"]] = self.decks.ensure_path(card["deck"])
            deck_id = deck_ids[card["deck"]]

            existing = self.cards.find_by_ext_id(card["ext_id"]) if card["ext_id"] else None
            if existing:
                self.cards.update_content(
                    existing["card_id"], card["front"], card["back"],
                    hint=card["hint"], tags=card["tags"], deck_id=deck_id)
                updated += 1
                continue
            if not allow_duplicates and self.cards.find_by_front(deck_id, card["front"]):
                skipped += 1
                continue
            self.cards.create(deck_id, card["front"], card["back"],
                              hint=card["hint"], tags=card["tags"], ext_id=card["ext_id"])
            created += 1

        quiz_results = []
        for group in plan["quizzes"]:
            existing = self._find_group(group)
            if existing:
                group_id = existing["group_id"]
                self.quizzes.rename_group(group_id, group["name"], group["subject"])
                action = "replaced"
            else:
                group_id = self.quizzes.create_group(
                    group["name"], group["subject"], group["ext_id"])
                action = "created"
            self.quizzes.replace_questions(group_id, group["questions"])
            quiz_results.append({"name": group["name"], "questions": len(group["questions"]),
                                 "action": action, "group_id": group_id})

        return {
            "ok": True,
            "issues": plan["issues"],
            "cards": {"new": created, "updated": updated, "duplicates": skipped},
            "quizzes": quiz_results,
        }

    # ── Export ────────────────────────────────────────────────────────────

    def export_cards(self, deck_path: str = "") -> dict:
        deck_ids = self.decks.descendant_ids(deck_path) if normalise_path(deck_path) else None
        cards = []
        for row in self.cards.export_rows(deck_ids):
            card = {"deck": row["deck"], "front": row["front"], "back": row["back"]}
            if row["ext_id"]:
                card["id"] = row["ext_id"]
            if row["hint"]:
                card["hint"] = row["hint"]
            if row["tags"]:
                card["tags"] = row["tags"].split(",")
            cards.append(card)
        return {"cards": cards}

    def export_quiz(self, group_id: int) -> dict:
        group = self.quizzes.export_group(int(group_id))
        if not group:
            return {"error": "Quiz not found"}
        if not group.get("id"):
            group.pop("id", None)
        return {"quiz": group}
