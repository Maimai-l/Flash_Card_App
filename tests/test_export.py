"""
Export must be the inverse of import.

The exported file is the user's backup and the thing they hand to a model for
rewriting, so a card whose back drifted, whose deck changed, or whose text got
mangled in transit is data loss with a delay. The tests here round-trip the
nastiest content the app supports and require byte-level agreement.
"""

import json

import pytest

from app.context import AppContext


@pytest.fixture
def context(tmp_path):
    return AppContext(db_path=tmp_path / "a.db")


@pytest.fixture
def second_context(tmp_path):
    return AppContext(db_path=tmp_path / "b.db")


NASTY = {
    "deck": "Mathematics::Pure 1",
    "cards": [
        {"id": "p1.tex", "front": "State the chain rule for $f(g(x))$",
         "back": "$\\frac{d}{dx}f(g(x)) = f'(g(x))\\,g'(x)$", "hint": "outer times inner",
         "tags": ["formula", "9709"]},
        {"id": "p1.cjk", "front": "什么是特征向量 (eigenvector)?",
         "back": "满足 $Av = \\lambda v$ 的非零向量 $v$。\n\n- 方向不变\n- 只被缩放"},
        {"id": "p1.quotes", "front": "Why is \"greedy\" in quotes here?",
         "back": "Because it's a *strategy*, with `code`, braces {{like this}} and a | pipe."},
        {"id": "net.arp", "deck": "Computer Science::Networks",
         "front": "What does ARP resolve?", "back": "IP to MAC on the local link."},
    ],
}

QUIZ = {
    "quiz": {
        "id": "p1.q1", "name": "Pure 1 checks", "subject": "Mathematics",
        "questions": [
            {"type": "mcq", "prompt": "Which is $\\int x\\,dx$?",
             "options": ["$x^2/2 + c$", "$x^2$", "两倍 $2x$"], "answer": 0,
             "explain": "Power rule, then add the constant."},
            {"type": "cloze", "text": "rank(A) + {{nullity(A)|null(A)}} = {{n}}", "match": "loose"},
            {"type": "ordering", "prompt": "Order the steps",
             "items": ["Forward elimination", "Back substitution", "Read off"]},
        ],
    }
}


def full_rows(ctx):
    """Every card as (deck, front, back, hint, tags, ext_id), deck-attributed."""
    out = []
    for deck in ctx.decks.all_decks():
        for c in ctx.cards.list_cards([deck["deck_id"]], limit=1000)["cards"]:
            out.append((deck["path"], c["front"], c["back"], c["hint"], c["tags"], c["ext_id"]))
    return sorted(out)


def test_cards_survive_a_full_round_trip(context, second_context):
    """TeX backslashes, CJK, quotes, cloze braces, newlines, a per-card deck
    override: import, export, import elsewhere, and nothing may differ."""
    assert not context.imports.commit(json.dumps(NASTY)).get("error")
    exported = context.imports.export_cards("")

    result = second_context.imports.commit(json.dumps(exported))
    assert result["cards"]["new"] == len(NASTY["cards"])
    assert full_rows(second_context) == full_rows(context)

    # and the second export is byte-identical to the first: a fixed point
    assert json.dumps(second_context.imports.export_cards(""), sort_keys=True) \
        == json.dumps(exported, sort_keys=True)


def test_every_exported_card_keeps_its_own_deck(context):
    """The one misattribution that would be silent: a card imported with a
    per-card deck override must export under that deck, not the batch's."""
    context.imports.commit(json.dumps(NASTY))
    by_id = {c["id"]: c for c in context.imports.export_cards("")["cards"]}
    assert by_id["net.arp"]["deck"] == "Computer Science::Networks"
    assert by_id["p1.tex"]["deck"] == "Mathematics::Pure 1"
    # and front/back stayed a pair
    assert by_id["net.arp"]["back"] == "IP to MAC on the local link."


def test_deck_scoped_export_takes_the_subtree_and_only_it(context):
    context.imports.commit(json.dumps(NASTY))
    maths = context.imports.export_cards("Mathematics")["cards"]
    assert {c["id"] for c in maths} == {"p1.tex", "p1.cjk", "p1.quotes"}
    assert all(c["deck"].startswith("Mathematics") for c in maths)


def test_exported_fields_match_what_the_importer_stored(context):
    context.imports.commit(json.dumps(NASTY))
    card = next(c for c in context.imports.export_cards("")["cards"] if c["id"] == "p1.tex")
    assert card["back"] == NASTY["cards"][0]["back"]          # backslashes intact
    assert card["hint"] == "outer times inner"
    assert sorted(card["tags"]) == ["9709", "formula"]        # import sorts; content equal
    cjk = next(c for c in context.imports.export_cards("")["cards"] if c["id"] == "p1.cjk")
    assert cjk["back"] == NASTY["cards"][1]["back"]           # CJK + newlines intact
    assert "hint" not in cjk and "tags" not in cjk            # empty fields stay absent


def test_a_quiz_round_trips_including_its_answer_keys(context, second_context):
    context.imports.commit(json.dumps(QUIZ))
    group_id = context.quizzes.list_groups()[0]["group_id"]
    exported = context.imports.export_quiz(group_id)

    assert not second_context.imports.commit(json.dumps(exported)).get("error")
    second_id = second_context.quizzes.list_groups()[0]["group_id"]

    def bare(ctx, gid):
        out = []
        for q in ctx.quizzes.get_questions(gid):
            q.pop("question_id", None)
            out.append(q)
        return out

    assert bare(second_context, second_id) == bare(context, group_id)
    # a second export equals the first: nothing decays with each generation
    assert json.dumps(second_context.imports.export_quiz(second_id), sort_keys=True) \
        == json.dumps(exported, sort_keys=True)


def test_reimporting_your_own_export_changes_nothing(context):
    """The backup restored over a live library must be a no-op: same ids, so
    every card updates in place and the quiz compares as unchanged."""
    context.imports.commit(json.dumps(NASTY))
    context.imports.commit(json.dumps(QUIZ))
    before = full_rows(context)

    exported = context.imports.export_cards("")
    result = context.imports.commit(json.dumps(exported))
    assert result["cards"]["new"] == 0
    assert result["cards"]["updated"] == len(NASTY["cards"])
    assert full_rows(context) == before

    group_id = context.quizzes.list_groups()[0]["group_id"]
    again = context.imports.commit(json.dumps(context.imports.export_quiz(group_id)))
    assert again["quizzes"][0]["action"] == "unchanged"
