"""Smoke tests: the layered backend behaves correctly post-refactor."""


def test_context_boots_on_fixture(context):
    assert context.db_path.endswith("vocabulary.db")
    assert "TOEFL" in context.study.get_book_names()


def test_learned_words_only_returns_reviewed(context):
    learned = context.study.get_learned_words("TOEFL", limit=50)
    words = {w["word"] for w in learned}
    assert "abate" in words
    assert "nascent" not in words  # never-seen (state 0) must be excluded
    for w in learned:
        assert w["state"] > 0


def test_session_words_shape(context):
    session = context.study.get_session_words("TOEFL", new_limit=5)
    assert isinstance(session, list) and session
    keys = {"word", "definition", "example", "chinese",
            "phone_us", "phone_uk", "stability", "difficulty", "due_date", "state"}
    assert keys <= set(session[0].keys())


def test_session_words_review_before_new(context):
    session = context.study.get_session_words("TOEFL", new_limit=5)
    states = [w["state"] for w in session]
    # all learned (state>0) come first, then new (state 0)
    first_new = next((i for i, s in enumerate(states) if s == 0), len(states))
    assert all(s > 0 for s in states[:first_new])
    assert all(s == 0 for s in states[first_new:])


def test_today_stats(context):
    stats = context.study.get_today_stats("TOEFL")
    assert stats["review_count"] >= 1
    assert stats["total_due"] == stats["new_count"] + stats["review_count"]


def test_db_stats(context):
    stats = context.study.get_db_stats()
    assert stats["schema_version"] == 9
    assert stats["total_words"] == 10


def test_api_facade_smoke(api):
    assert isinstance(api.get_book_names(), list)
    assert api.get_db_stats()["total_words"] == 10
    res = api.lookup_words("abate\nzzznotaword")
    assert res[0]["found"] is True and res[0]["matched"] == "abate"
    assert res[1]["found"] is False


def test_record_answer_updates_fsrs(api):
    before = api.get_db_stats()
    r = api.record_answer("nascent", 3)   # Good on a new word
    assert r.get("ok") is True
    assert r["state"] > 0
    after = api.get_db_stats()
    assert after["never_seen"] == before["never_seen"] - 1


def test_complete_session_writes_calendar_dot(api):
    """Regression: the old calendar init wrote the string "{}" and crashed here."""
    r = api.complete_session()
    assert r.get("ok") is True
    cal = api.get_calendar_info()
    assert isinstance(cal, dict) and len(cal) == 1  # exactly today's dot


def test_soft_reset_clears_progress(api, context):
    api.record_answer("nascent", 3)
    assert api.soft_reset().get("ok") is True
    stats = api.get_db_stats()
    # everything back to new
    assert stats["fsrs_states"].get("Review", 0) == 0
    assert stats["never_seen"] == stats["total_words"]


def test_no_game_methods_remain(api):
    for gone in ("get_game_list", "start_game_session", "submit_game_results",
                 "launch_unity_game", "get_unity_games", "get_ws_server_info"):
        assert not hasattr(api, gone), f"{gone} should have been removed"


def test_api_error_shapes(api):
    # get_book_names falls back to [] on internal error shape; here it's a list
    assert isinstance(api.get_book_names(), list)
    # get_book_complete_percentage returns a dict with Percentage
    pct = api.get_book_complete_percentage("TOEFL")
    assert "Percentage" in pct
