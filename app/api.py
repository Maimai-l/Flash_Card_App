"""
The API surface the browser talks to.

Every public method on Api is callable over POST /api. Each one is a thin
delegation to a service; the shared error boundary lives in @api_call, so a
failure comes back as {"error": "..."} instead of a dead request.
"""

from __future__ import annotations

import functools
import logging

from version import __version__

from .db.deck_repo import normalise_path

logger = logging.getLogger(__name__)


def api_call(fn):
    @functools.wraps(fn)
    def wrapper(self, *args, **kwargs):
        try:
            return fn(self, *args, **kwargs)
        except Exception as exc:
            logger.exception("API %s failed", fn.__name__)
            return {"error": str(exc)}
    return wrapper


def _ids(values) -> list[int]:
    if values is None:
        return []
    if isinstance(values, (int, str)):
        values = [values]
    return [int(v) for v in values]


class Api:
    def __init__(self, context):
        self.ctx = context

    # ── Bootstrap ─────────────────────────────────────────────────────────

    @api_call
    def get_bootstrap(self):
        """Everything the shell needs on first paint, in one round trip."""
        return {
            "version": __version__,
            "settings": self.ctx.settings.all(),
            "decks": self.ctx.study.deck_tree(),
        }

    # ── Decks ─────────────────────────────────────────────────────────────

    @api_call
    def get_decks(self):
        return self.ctx.study.deck_tree()

    @api_call
    def create_deck(self, path):
        if not normalise_path(path):
            return {"error": "Deck name cannot be empty"}
        self.ctx.decks.ensure_path(path)
        return {"ok": True, "decks": self.ctx.study.deck_tree()}

    @api_call
    def rename_deck(self, path, name):
        self.ctx.decks.rename(path, name)
        return {"ok": True, "decks": self.ctx.study.deck_tree()}

    @api_call
    def delete_deck(self, path):
        self.ctx.decks.delete(path)
        return {"ok": True, "decks": self.ctx.study.deck_tree()}

    @api_call
    def set_deck_limits(self, path, new_limit, review_limit):
        def clean(value):
            if value in (None, "", "null"):
                return None
            return max(-1, int(value))
        self.ctx.decks.set_limits(path, clean(new_limit), clean(review_limit))
        return {"ok": True, "decks": self.ctx.study.deck_tree()}

    # ── Study ─────────────────────────────────────────────────────────────

    @api_call
    def get_overview(self, deck=""):
        return self.ctx.study.overview(deck)

    @api_call
    def get_queue(self, deck="", ignore_limits=False):
        return self.ctx.study.build_queue(deck, bool(ignore_limits))

    @api_call
    def get_browse(self, deck="", limit=200):
        return self.ctx.study.browse(deck, int(limit))

    @api_call
    def answer_card(self, card_id, rating):
        return self.ctx.study.answer(int(card_id), int(rating))

    @api_call
    def undo_review(self):
        return self.ctx.study.undo()

    # ── Cards ─────────────────────────────────────────────────────────────

    @api_call
    def list_cards(self, deck="", search="", offset=0, limit=50):
        deck_ids = self.ctx.decks.descendant_ids(deck) if normalise_path(deck) else None
        result = self.ctx.cards.list_cards(deck_ids, search, int(offset), int(limit))
        paths = {d["deck_id"]: d["path"] for d in self.ctx.decks.all_decks()}
        for card in result["cards"]:
            card["deck"] = paths.get(card["deck_id"], "")
        return result

    @api_call
    def get_card(self, card_id):
        card = self.ctx.cards.by_id(int(card_id))
        if not card:
            return {"error": "Card not found"}
        deck = self.ctx.decks.by_id(card["deck_id"])
        card["deck"] = deck["path"] if deck else ""
        return card

    @api_call
    def create_card(self, card):
        deck = normalise_path(card.get("deck", ""))
        if not deck:
            return {"error": "A card needs a deck"}
        if not str(card.get("front", "")).strip() or not str(card.get("back", "")).strip():
            return {"error": "A card needs both a front and a back"}
        deck_id = self.ctx.decks.ensure_path(deck)
        card_id = self.ctx.cards.create(
            deck_id, card["front"].strip(), card["back"].strip(),
            hint=str(card.get("hint", "")).strip(),
            tags=",".join(card.get("tags", []) or []),
        )
        return {"ok": True, "card_id": card_id}

    @api_call
    def update_card(self, card_id, card):
        if not str(card.get("front", "")).strip() or not str(card.get("back", "")).strip():
            return {"error": "A card needs both a front and a back"}
        deck_id = None
        if normalise_path(card.get("deck", "")):
            deck_id = self.ctx.decks.ensure_path(card["deck"])
        updated = self.ctx.cards.update_content(
            int(card_id), card["front"].strip(), card["back"].strip(),
            hint=str(card.get("hint", "")).strip(),
            tags=",".join(card.get("tags", []) or []),
            deck_id=deck_id,
        )
        return {"ok": True, "card": updated}

    @api_call
    def delete_cards(self, card_ids):
        return {"ok": True, "deleted": self.ctx.cards.delete(_ids(card_ids))}

    @api_call
    def move_cards(self, card_ids, deck):
        if not normalise_path(deck):
            return {"error": "Pick a destination deck"}
        deck_id = self.ctx.decks.ensure_path(deck)
        return {"ok": True, "moved": self.ctx.cards.move_to_deck(_ids(card_ids), deck_id)}

    @api_call
    def suspend_cards(self, card_ids, suspended=True):
        return {"ok": True,
                "changed": self.ctx.cards.set_suspended(_ids(card_ids), bool(suspended))}

    # ── Quiz ──────────────────────────────────────────────────────────────

    @api_call
    def list_quizzes(self):
        return self.ctx.quiz.list_groups()

    @api_call
    def start_quiz(self, group_id, question_ids=None, resume=False):
        return self.ctx.quiz.start(int(group_id), question_ids, bool(resume))

    @api_call
    def save_quiz_progress(self, group_id, question_ids, answers, position):
        return self.ctx.quiz.save_progress(int(group_id), question_ids, answers, int(position))

    @api_call
    def discard_quiz_progress(self, group_id):
        return self.ctx.quiz.discard_progress(int(group_id))

    @api_call
    def finish_quiz(self, group_id, correct, total, wrong_ids=None):
        return self.ctx.quiz.finish(int(group_id), correct, total, wrong_ids)

    @api_call
    def quiz_attempts(self, group_id):
        return self.ctx.quiz.attempts(int(group_id))

    @api_call
    def rename_quiz(self, group_id, name, subject=""):
        return self.ctx.quiz.rename(int(group_id), name, subject)

    @api_call
    def delete_quiz(self, group_id):
        return self.ctx.quiz.delete(int(group_id))

    # ── Import / export ───────────────────────────────────────────────────

    @api_call
    def import_preview(self, text, deck=""):
        return self.ctx.imports.preview(text, deck)

    @api_call
    def import_commit(self, text, deck="", allow_duplicates=False):
        return self.ctx.imports.commit(text, deck, bool(allow_duplicates))

    @api_call
    def export_cards(self, deck=""):
        return self.ctx.imports.export_cards(deck)

    @api_call
    def export_quiz(self, group_id):
        return self.ctx.imports.export_quiz(int(group_id))

    # ── Stats ─────────────────────────────────────────────────────────────

    @api_call
    def get_ai_report(self):
        return self.ctx.stats.ai_report()

    @api_call
    def get_stats(self, deck=""):
        return self.ctx.stats.summary(deck)

    @api_call
    def get_heatmap(self, deck="", days=182):
        return self.ctx.stats.heatmap(deck, int(days))

    # ── Settings ──────────────────────────────────────────────────────────

    @api_call
    def get_settings(self):
        return self.ctx.settings.all()

    @api_call
    def update_settings(self, values):
        allowed = {"default_new_limit", "default_review_limit", "language",
                   "easy_threshold_seconds"}
        self.ctx.settings.set_many({k: v for k, v in (values or {}).items() if k in allowed})
        return {"ok": True, "settings": self.ctx.settings.all()}

    @api_call
    def reset_all(self):
        """Wipe every card, deck, quiz and review. Settings survive."""
        conn = self.ctx.database.connect()
        try:
            for table in ("Review_Log", "Card", "Deck",
                          "Quiz_Attempt", "Quiz_Question", "Quiz_Group"):
                conn.execute(f"DELETE FROM {table}")
            conn.commit()
        finally:
            conn.close()
        return {"ok": True}
