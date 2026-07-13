"""Service-layer tests for import + book operations (behavior preservation)."""


def test_create_book_and_duplicate(api):
    r1 = api.create_book("MyBook")
    assert r1["ok"] is True
    r2 = api.create_book("MyBook")
    assert r2["ok"] is False and "already exists" in r2["error"]


def test_import_clipboard_round_trip(api, context):
    text = "serene::adj.平静的\nlucid::adj.清晰的"
    msg = api.import_clipboard(text, "ClipBook", "::", "\n", True)
    assert "Successfully added 2" in msg
    # words now searchable
    res = api.lookup_words("serene")
    assert res[0]["found"] is True and res[0]["matched"] == "serene"
    # and listed in the new book
    listing = api.get_book_words("ClipBook", 0, 100, "", False)
    vocabs = {w["vocab"] for w in listing["words"]}
    assert {"serene", "lucid"} <= vocabs


def test_import_word_matches(api):
    matches = [
        {"found": True, "matched": "abate", "definition": "v.减轻", "example": "", "chinese": ""},
        {"found": False, "matched": None},
    ]
    msg = api.import_word_matches(matches, "TOEFL", False)
    assert "Successfully added 1" in msg


def test_update_word_override(api):
    # edit abate's definition via override, verify it reads back through the view
    api.apply_word_overrides({"abate": {"definition": "v.(overridden)", "example": "", "chinese": ""}})
    res = api.lookup_words("abate")
    assert res[0]["definition"] == "v.(overridden)"
