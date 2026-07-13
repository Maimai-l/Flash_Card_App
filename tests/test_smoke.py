"""Smoke tests: the fixture harness works and core read paths behave post-refactor."""


def test_library_boots_on_fixture(library):
    assert library.db_path.endswith("vocabulary.db")
    books = library.get_book_names()
    assert "TOEFL" in books


def test_learned_words_only_returns_reviewed(library):
    learned = library.get_learned_words("TOEFL", limit=50)
    words = {w["word"] for w in learned}
    # fsrs_state > 0 in the fixture: abate, candid, elated, frugal, gregarious
    assert "abate" in words
    assert "nascent" not in words  # never-seen (state 0) must be excluded
    for w in learned:
        assert w["state"] > 0


def test_session_words_shape(library):
    session = library.get_session_words("TOEFL", new_limit=5)
    assert isinstance(session, list) and session
    keys = {"word", "definition", "example", "chinese",
            "phone_us", "phone_uk", "stability", "difficulty", "due_date", "state"}
    assert keys <= set(session[0].keys())


def test_today_stats(library):
    stats = library.get_today_stats("TOEFL")
    assert stats["review_count"] >= 1   # learned+overdue words are due
    assert "total_due" in stats


def test_db_stats(library):
    stats = library.get_db_stats()
    assert stats["schema_version"] == 9
    assert stats["total_words"] == 10


def test_api_facade_smoke(api):
    assert isinstance(api.get_book_names(), list)
    stats = api.get_db_stats()
    assert stats["total_words"] == 10
    # lookup path (exercises the fuzzy matcher)
    res = api.lookup_words("abate\nzzznotaword")
    assert res[0]["found"] is True and res[0]["matched"] == "abate"
    assert res[1]["found"] is False


def test_record_answer_updates_fsrs(api):
    before = api.get_db_stats()
    r = api.record_answer("nascent", 3)   # Good on a new word
    assert r.get("ok") is True
    assert r["state"] > 0                  # now in learning/review
    after = api.get_db_stats()
    assert after["never_seen"] == before["never_seen"] - 1


def test_no_game_methods_remain(api):
    for gone in ("get_game_list", "start_game_session", "submit_game_results",
                 "launch_unity_game", "get_unity_games", "get_ws_server_info"):
        assert not hasattr(api, gone), f"{gone} should have been removed"
