"""Quizzes must stay completely disconnected from card scheduling."""

import json

QUIZ = json.dumps({"quiz": {
    "name": "Ch.3", "subject": "Mathematics",
    "questions": [
        {"type": "mcq", "prompt": "Which?", "options": ["a", "b"], "answer": 1,
         "explain": "because"},
        {"type": "short", "prompt": "Symbol?", "answers": ["lambda", "λ"]},
    ],
}})


def test_taking_a_quiz_leaves_cards_alone(context):
    deck_id = context.decks.ensure_path("Mathematics")
    context.cards.create(deck_id, "front", "back")
    context.imports.commit(QUIZ)
    before = context.study.overview("Mathematics")

    group_id = context.quizzes.list_groups()[0]["group_id"]
    started = context.quiz.start(group_id)
    context.quiz.finish(group_id, 1, len(started["questions"]), [])

    assert context.study.overview("Mathematics") == before
    assert context.cards.counts_done_today(None, "2099-01-01")["answers"] == 0


def test_attempts_are_recorded_and_surfaced(context):
    context.imports.commit(QUIZ)
    group_id = context.quizzes.list_groups()[0]["group_id"]

    context.quiz.finish(group_id, 1, 2, [7])
    context.quiz.finish(group_id, 2, 2, [])

    listed = context.quiz.list_groups()[0]
    assert listed["attempts"] == 2
    assert (listed["last_correct"], listed["last_total"]) == (2, 2)  # most recent, not the first


def test_start_can_be_narrowed_to_specific_questions(context):
    context.imports.commit(QUIZ)
    group_id = context.quizzes.list_groups()[0]["group_id"]
    everything = context.quiz.start(group_id)["questions"]

    only_one = context.quiz.start(group_id, [everything[1]["question_id"]])
    assert len(only_one["questions"]) == 1
    assert only_one["questions"][0]["type"] == "short"


def test_question_payloads_survive_the_round_trip(context):
    context.imports.commit(QUIZ)
    group_id = context.quizzes.list_groups()[0]["group_id"]
    mcq = context.quiz.start(group_id)["questions"][0]
    assert mcq["options"] == ["a", "b"]
    assert mcq["answer"] == 1
    assert mcq["explain"] == "because"


def test_deleting_a_quiz_takes_its_history(context):
    context.imports.commit(QUIZ)
    group_id = context.quizzes.list_groups()[0]["group_id"]
    context.quiz.finish(group_id, 1, 2, [])
    context.quiz.delete(group_id)

    assert context.quiz.list_groups() == []
    assert context.quizzes.list_attempts(group_id) == []


def test_deleting_every_card_leaves_quizzes_standing(context):
    deck_id = context.decks.ensure_path("Mathematics")
    context.cards.create(deck_id, "front", "back")
    context.imports.commit(QUIZ)

    context.decks.delete("Mathematics")
    assert context.cards.count_all(None) == 0
    assert len(context.quiz.list_groups()) == 1


def test_missing_quiz_reports_an_error(context):
    assert "error" in context.quiz.start(999)
    assert "error" in context.quiz.finish(999, 1, 1, [])
