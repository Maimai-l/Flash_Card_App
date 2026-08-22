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


# ── In-flight progress ────────────────────────────────────────────────────
#
# Card reviews write on every rating, so abandoning a session costs nothing.
# Quizzes used to hold the whole run in the tab, and a stray Escape threw away
# every answered question. These pin the fix.

LONG_QUIZ = json.dumps({"quiz": {
    "id": "q.long", "name": "Ten questions", "subject": "CS",
    "questions": [
        {"type": "mcq", "prompt": f"Question {i}?", "options": ["a", "b", "c", "d"],
         "answer": i % 4, "explain": "Because."}
        for i in range(10)
    ],
}})


def answered(question_id, correct=True):
    return {"answered": True, "correct": correct, "response": [0]}


def blank():
    return {"answered": False, "correct": False, "response": []}


def start_and_answer(context, count, correct=True):
    """Take `count` questions of the ten-question quiz and walk away."""
    context.imports.commit(LONG_QUIZ)
    group_id = context.quizzes.list_groups()[0]["group_id"]
    run = context.quiz.start(group_id)
    ids = [q["question_id"] for q in run["questions"]]
    answers = [answered(i, correct) for i in ids[:count]] + [blank()] * (len(ids) - count)
    context.quiz.save_progress(group_id, ids, answers, count)
    return group_id, ids


def test_a_half_finished_quiz_survives_walking_away(context):
    group_id, ids = start_and_answer(context, 6)

    resumed = context.quiz.start(group_id, resume=True)
    assert resumed["resumed"] is not None
    assert resumed["resumed"]["position"] == 6
    assert [q["question_id"] for q in resumed["questions"]] == ids
    assert sum(1 for a in resumed["resumed"]["answers"] if a["answered"]) == 6


def test_the_list_shows_how_far_in_you_are(context):
    start_and_answer(context, 6)
    row = context.quiz.list_groups()[0]
    assert row["in_progress"] is True
    assert (row["progress_answered"], row["progress_total"]) == (6, 10)


def test_starting_over_discards_the_saved_run(context):
    group_id, _ = start_and_answer(context, 6)

    fresh = context.quiz.start(group_id)          # resume defaults to False
    assert fresh["resumed"] is None
    assert context.quizzes.get_progress(group_id) is None
    assert context.quiz.list_groups()[0]["in_progress"] is False


def test_finishing_clears_the_saved_run(context):
    group_id, _ = start_and_answer(context, 10)
    context.quiz.finish(group_id, 8, 10, [])

    assert context.quizzes.get_progress(group_id) is None
    assert context.quiz.list_groups()[0]["in_progress"] is False
    assert context.quiz.start(group_id, resume=True)["resumed"] is None


def test_reimporting_the_quiz_discards_a_run_that_points_at_old_questions(context):
    """Re-import replaces the questions and mints new ids. Resuming into that
    would show new questions against old answers."""
    group_id, old_ids = start_and_answer(context, 6)

    context.imports.commit(LONG_QUIZ)             # same quiz id → questions replaced
    new_ids = [q["question_id"] for q in context.quiz.start(group_id, resume=True)["questions"]]
    assert set(new_ids).isdisjoint(old_ids)
    assert context.quiz.start(group_id, resume=True)["resumed"] is None
    assert context.quizzes.get_progress(group_id) is None


def test_corrupt_progress_is_dropped_rather_than_resumed(context):
    context.imports.commit(LONG_QUIZ)
    group_id = context.quizzes.list_groups()[0]["group_id"]
    ids = [q["question_id"] for q in context.quiz.start(group_id)["questions"]]

    # answers shorter than the question list — a truncated or hand-edited row
    context.quiz.save_progress(group_id, ids, [answered(ids[0])], 4)
    assert context.quiz.start(group_id, resume=True)["resumed"] is None
    assert context.quizzes.get_progress(group_id) is None


def test_progress_on_a_missing_quiz_is_an_error(context):
    assert "error" in context.quiz.save_progress(999, [1], [blank()], 0)


def test_saved_progress_still_does_not_touch_cards(context):
    deck_id = context.decks.ensure_path("Computer Science")
    context.cards.create(deck_id, "front", "back")
    before = context.study.overview("Computer Science")

    start_and_answer(context, 6)
    assert context.study.overview("Computer Science") == before
    assert context.cards.counts_done_today(None, "2099-01-01")["answers"] == 0


def test_deleting_a_quiz_takes_its_progress(context):
    group_id, _ = start_and_answer(context, 6)
    context.quiz.delete(group_id)
    assert context.quizzes.get_progress(group_id) is None
