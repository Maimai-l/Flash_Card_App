"""
The AI report: the study state as one handover object.

It is data for a conversation, not interface: nothing here may leak back into
a screen, and everything a planner needs has to be present in one call.
"""

import json

import pytest

from app.context import AppContext


@pytest.fixture
def context(tmp_path):
    return AppContext(db_path=tmp_path / "t.db")


PAYLOAD = json.dumps({
    "deck": "Mathematics::Pure 1",
    "cards": [
        {"id": f"p1.{i}", "front": f"What is term {i}?", "back": f"Answer {i}."}
        for i in range(12)
    ],
    "quiz": {
        "id": "p1.q", "name": "Pure 1 basics", "subject": "Mathematics",
        "questions": [{"type": "short", "prompt": "x?", "answers": ["x"]}],
    },
})


def test_report_carries_the_whole_picture(context):
    context.imports.commit(PAYLOAD)
    report = context.stats.ai_report()

    assert report["kc_export"] == 1 and report["kind"] == "report"
    assert report["defaults"]["new_limit"] > 0

    subject = next(s for s in report["subjects"] if s["subject"] == "Mathematics")
    assert subject["total_cards"] == 12
    assert subject["states"]["new"] == 12
    assert subject["today"]["new_waiting"] > 0
    assert subject["due_next_7_days"] == 0          # nothing reviewed yet, so nothing scheduled
    assert subject["again_rate_30d"] is None        # no answers, no rate, not a fake zero

    quiz = report["quizzes"][0]
    assert quiz["name"] == "Pure 1 basics"
    assert quiz["attempts"] == 0 and quiz["last"] is None and quiz["in_progress"] is False


def test_report_counts_scheduled_work_and_recall(context):
    context.imports.commit(PAYLOAD)
    # Answer three cards; Good puts a new card into the learning steps, due soon.
    for _ in range(3):
        card = context.study.build_queue("Mathematics")["cards"][0]
        context.study.answer(card["card_id"], 3)

    report = context.stats.ai_report()
    subject = next(s for s in report["subjects"] if s["subject"] == "Mathematics")
    assert subject["today"]["new_done"] == 3
    assert subject["due_next_7_days"] >= 3
    assert subject["answers_30d"] == 3
    assert subject["again_rate_30d"] == 0.0

    # ids travel with the queue, so struggle exports can name cards stably
    assert context.study.build_queue("Mathematics")["cards"][0]["ext_id"].startswith("p1.")


def test_report_is_json_serialisable(context):
    context.imports.commit(PAYLOAD)
    json.dumps(context.stats.ai_report())
