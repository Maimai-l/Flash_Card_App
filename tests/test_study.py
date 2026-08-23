"""The rules that make the app non-coercive: caps hold, backlog is bounded,
and every answer is reversible."""

from datetime import datetime, timedelta, timezone



def seed(context, deck: str, count: int, prefix: str = "card"):
    deck_id = context.decks.ensure_path(deck)
    for index in range(count):
        context.cards.create(deck_id, f"{prefix} {index}", f"back {index}")
    return deck_id


def test_new_cards_are_capped_per_day(context):
    seed(context, "Mathematics", 40)
    context.settings.set("default_new_limit", 10)

    queue = context.study.build_queue("Mathematics")
    assert len(queue["cards"]) == 10
    assert context.study.overview("Mathematics")["new_available"] == 10


def test_cap_shrinks_as_the_day_is_spent(context):
    seed(context, "Mathematics", 40)
    context.settings.set("default_new_limit", 10)

    for card in context.study.build_queue("Mathematics")["cards"][:4]:
        context.study.answer(card["card_id"], 3)

    overview = context.study.overview("Mathematics")
    assert overview["new_done"] == 4
    assert overview["new_available"] == 6
    assert len(context.study.build_queue("Mathematics")["cards"]) == 6


def test_each_subject_keeps_its_own_budget(context):
    seed(context, "Mathematics", 30, "m")
    seed(context, "Computer Science", 30, "c")
    context.settings.set("default_new_limit", 5)

    queue = context.study.build_queue("")
    assert len(queue["cards"]) == 10  # 5 from each subject, not 5 overall

    overview = context.study.overview("")
    assert overview["subjects"] == 2
    assert overview["new_available"] == 10


def test_a_chapter_draws_from_its_subject_budget(context):
    seed(context, "Mathematics::Linear Algebra", 20, "la")
    seed(context, "Mathematics::Calculus", 20, "calc")
    context.settings.set("default_new_limit", 10)

    for card in context.study.build_queue("Mathematics::Linear Algebra")["cards"][:10]:
        context.study.answer(card["card_id"], 3)

    # The subject's allowance is spent, so a sibling chapter offers nothing more.
    assert context.study.build_queue("Mathematics::Calculus")["cards"] == []


def test_deck_limit_overrides_the_default(context):
    seed(context, "Mathematics", 40)
    context.settings.set("default_new_limit", 10)
    context.decks.set_limits("Mathematics", 3, 5)
    assert len(context.study.build_queue("Mathematics")["cards"]) == 3


def test_negative_limit_means_unlimited(context):
    seed(context, "Mathematics", 25)
    context.decks.set_limits("Mathematics", -1, -1)
    assert len(context.study.build_queue("Mathematics")["cards"]) == 25
    assert context.study.overview("Mathematics")["unlimited_new"] is True


def test_study_more_bypasses_the_cap_without_changing_it(context):
    seed(context, "Mathematics", 40)
    context.settings.set("default_new_limit", 5)

    assert len(context.study.build_queue("Mathematics")["cards"]) == 5
    assert len(context.study.build_queue("Mathematics", ignore_limits=True)["cards"]) == 40
    # The stored limit is untouched, so tomorrow is unchanged.
    assert context.study.overview("Mathematics")["new_limit"] == 5


def test_intraday_repeats_do_not_eat_the_budget_twice(context):
    seed(context, "Mathematics", 20)
    context.settings.set("default_new_limit", 5)
    card = context.study.build_queue("Mathematics")["cards"][0]

    context.study.answer(card["card_id"], 1)  # Again
    context.study.answer(card["card_id"], 1)  # and again, same sitting
    context.study.answer(card["card_id"], 3)

    assert context.study.overview("Mathematics")["new_done"] == 1


def test_again_asks_to_be_requeued(context):
    seed(context, "Mathematics", 3)
    card = context.study.build_queue("Mathematics")["cards"][0]
    result = context.study.answer(card["card_id"], 1)
    assert result["requeue"] is True
    assert result["card"]["card_id"] == card["card_id"]


def test_easy_schedules_beyond_this_sitting(context):
    seed(context, "Mathematics", 3)
    card = context.study.build_queue("Mathematics")["cards"][0]
    assert context.study.answer(card["card_id"], 4)["requeue"] is False


def test_rating_must_be_valid(context):
    seed(context, "Mathematics", 1)
    card = context.study.build_queue("Mathematics")["cards"][0]
    assert "error" in context.study.answer(card["card_id"], 9)
    assert "error" in context.study.answer(99999, 3)


def test_undo_restores_the_card_and_the_budget(context):
    seed(context, "Mathematics", 5)
    card = context.study.build_queue("Mathematics")["cards"][0]
    context.study.answer(card["card_id"], 4)
    assert context.study.overview("Mathematics")["new_done"] == 1

    result = context.study.undo()
    assert result["ok"] is True
    assert result["card"]["is_new"] is True

    restored = context.cards.by_id(card["card_id"])
    assert restored["last_review"] is None
    assert restored["reps"] == 0
    assert context.study.overview("Mathematics")["new_done"] == 0


def test_undo_with_no_history_is_harmless(context):
    assert context.study.undo()["ok"] is False


def test_a_backlog_never_arrives_as_a_wall(context):
    """Forty days of neglect still hands you one day's worth, not the pile."""
    deck_id = seed(context, "Mathematics", 30)
    long_ago = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
    for card in context.cards.list_cards([deck_id], limit=100)["cards"]:
        context.cards.apply_review(
            card["card_id"], 3,
            {"stability": 5.0, "difficulty": 5.0, "due_date": long_ago,
             "last_review": long_ago, "state": 2, "step": None},
            long_ago, "2000-01-01",
        )
    context.settings.set("default_review_limit", 10)

    assert context.study.overview("Mathematics")["review_available"] == 10
    assert len(context.study.build_queue("Mathematics")["cards"]) == 10


def test_browse_changes_nothing(context):
    seed(context, "Mathematics", 5)
    before = context.study.overview("Mathematics")
    result = context.study.browse("Mathematics")
    assert len(result["cards"]) == 5
    assert context.study.overview("Mathematics") == before


def test_suspended_cards_stay_out_of_the_queue(context):
    deck_id = seed(context, "Mathematics", 5)
    ids = [c["card_id"] for c in context.cards.list_cards([deck_id], limit=5)["cards"]][:2]
    context.cards.set_suspended(ids, True)
    assert len(context.study.build_queue("Mathematics")["cards"]) == 3


def test_queue_carries_interval_previews(context):
    seed(context, "Mathematics", 1)
    card = context.study.build_queue("Mathematics")["cards"][0]
    assert sorted(card["intervals"]) == ["1", "2", "3", "4"]
    assert all(card["intervals"][key] for key in card["intervals"])
