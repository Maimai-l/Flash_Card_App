import json


def payload(**extra):
    body = {"deck": "Mathematics::Linear Algebra", "cards": [
        {"front": "Define an eigenvector", "back": "Av = lambda v"},
        {"front": "Rank-nullity", "back": "rank + nullity = n", "tags": ["theorem"]},
    ]}
    body.update(extra)
    return json.dumps(body)


def test_import_creates_decks_and_cards(context):
    result = context.imports.commit(payload())
    assert result["cards"] == {"new": 2, "updated": 0, "duplicates": 0}
    assert [d["path"] for d in context.decks.all_decks()] == [
        "Mathematics", "Mathematics::Linear Algebra"]


def test_reimport_without_ids_is_reported_as_duplicate(context):
    context.imports.commit(payload())
    again = context.imports.commit(payload())
    assert again["cards"] == {"new": 0, "updated": 0, "duplicates": 2}
    assert context.cards.count_all(None) == 2


def test_allow_duplicates_creates_second_copies(context):
    context.imports.commit(payload())
    context.imports.commit(payload(), allow_duplicates=True)
    assert context.cards.count_all(None) == 4


def test_stable_id_updates_in_place(context):
    first = json.dumps({"deck": "CS", "cards": [
        {"id": "tcp.handshake", "front": "TCP handshake", "back": "SYN, SYN-ACK, ACK"}]})
    context.imports.commit(first)
    revised = json.dumps({"deck": "CS", "cards": [
        {"id": "tcp.handshake", "front": "TCP handshake", "back": "Three steps, both directions"}]})
    result = context.imports.commit(revised)

    assert result["cards"]["updated"] == 1
    assert context.cards.count_all(None) == 1
    assert context.cards.find_by_ext_id("tcp.handshake")["back"] == "Three steps, both directions"


def test_bad_entries_are_skipped_not_fatal(context):
    text = json.dumps({"deck": "CS", "cards": [
        {"front": "kept", "back": "yes"},
        {"front": "no back"},
        {"back": "no front"},
        "not an object",
    ]})
    result = context.imports.commit(text)
    assert result["cards"]["new"] == 1
    assert len([i for i in result["issues"] if i["level"] == "error"]) == 3


def test_missing_deck_is_an_error(context):
    result = context.imports.preview(json.dumps({"cards": [{"front": "a", "back": "b"}]}))
    assert not result["ok"]
    assert any("deck" in issue["message"] for issue in result["issues"])


def test_invalid_json_reports_cleanly(context):
    result = context.imports.preview("{not json")
    assert not result["ok"]
    assert result["issues"][0]["where"] == "json"


def test_preview_matches_commit(context):
    text = payload()
    preview = context.imports.preview(text)
    commit = context.imports.commit(text)
    assert preview["cards"]["new"] == commit["cards"]["new"]


# ── Quizzes ───────────────────────────────────────────────────────────────

QUIZ = {
    "quiz": {
        "name": "LA basics", "subject": "Mathematics",
        "questions": [
            {"type": "mcq", "prompt": "Which?", "options": ["a", "b"], "answer": 1},
            {"type": "cloze", "text": "rank + {{nullity}} = n"},
            {"type": "short", "prompt": "Symbol?", "answers": ["lambda"]},
            {"type": "ordering", "prompt": "Order", "items": ["one", "two"]},
        ],
    }
}


def test_quiz_import_and_replace(context):
    result = context.imports.commit(json.dumps(QUIZ))
    assert result["quizzes"][0]["action"] == "created"
    assert result["quizzes"][0]["questions"] == 4

    edited = json.loads(json.dumps(QUIZ))
    edited["quiz"]["questions"][0]["prompt"] = "Which one, really?"
    again = context.imports.commit(json.dumps(edited))
    assert again["quizzes"][0]["action"] == "replaced"
    assert len(context.quizzes.list_groups()) == 1
    assert context.quizzes.list_groups()[0]["question_count"] == 4


def test_reimporting_an_unedited_quiz_changes_nothing(context):
    """Identical in, nothing out. DELETE and INSERT would mint new question ids
    and take a half-finished run down with them."""
    context.imports.commit(json.dumps(QUIZ))
    group_id = context.quizzes.list_groups()[0]["group_id"]
    before = [q["question_id"] for q in context.quizzes.get_questions(group_id)]

    assert context.imports.preview(json.dumps(QUIZ))["quizzes"][0]["action"] == "unchanged"
    again = context.imports.commit(json.dumps(QUIZ))
    assert again["quizzes"][0]["action"] == "unchanged"
    assert [q["question_id"] for q in context.quizzes.get_questions(group_id)] == before


def test_renaming_a_quiz_counts_as_a_change(context):
    context.imports.commit(json.dumps(QUIZ))
    renamed = json.loads(json.dumps(QUIZ))
    renamed["quiz"]["name"] = "LA basics, revised"
    # matched on name+subject when there is no id, so give it one to keep it the
    # same group rather than a second one
    body = json.loads(json.dumps(QUIZ))
    body["quiz"]["id"] = "la.basics"
    context.imports.commit(json.dumps(body))
    body["quiz"]["name"] = "LA basics, revised"
    assert context.imports.preview(json.dumps(body))["quizzes"][0]["action"] == "replace"
    assert context.imports.commit(json.dumps(body))["quizzes"][0]["action"] == "replaced"
    assert any(g["name"] == "LA basics, revised" for g in context.quizzes.list_groups())


def test_the_preview_promises_what_the_commit_does(context):
    """Three states, and the preview has to name the same one every time."""
    for payload, predicted, done in [
        (QUIZ, "create", "created"),
        (QUIZ, "unchanged", "unchanged"),
    ]:
        text = json.dumps(payload)
        assert context.imports.preview(text)["quizzes"][0]["action"] == predicted
        assert context.imports.commit(text)["quizzes"][0]["action"] == done

    edited = json.loads(json.dumps(QUIZ))
    edited["quiz"]["questions"].append(
        {"type": "short", "prompt": "And this?", "answers": ["yes"]})
    text = json.dumps(edited)
    assert context.imports.preview(text)["quizzes"][0]["action"] == "replace"
    assert context.imports.commit(text)["quizzes"][0]["action"] == "replaced"


def test_unknown_question_type_warns_and_is_dropped(context):
    body = json.loads(json.dumps(QUIZ))
    body["quiz"]["questions"].append({"type": "matching", "prompt": "?"})
    result = context.imports.commit(json.dumps(body))
    assert result["quizzes"][0]["questions"] == 4
    assert any(i["level"] == "warning" and "matching" in i["message"] for i in result["issues"])


def test_malformed_questions_are_rejected(context):
    bad = {"quiz": {"name": "broken", "questions": [
        {"type": "mcq", "prompt": "?", "options": ["only one"], "answer": 0},
        {"type": "mcq", "prompt": "?", "options": ["a", "b"], "answer": 7},
        {"type": "cloze", "text": "no blanks here"},
        {"type": "short", "prompt": "?", "answers": []},
        {"type": "ordering", "prompt": "?", "items": ["one"]},
    ]}}
    result = context.imports.preview(json.dumps(bad))
    assert len([i for i in result["issues"] if i["level"] == "error"]) >= 5
    assert not result["quizzes"]


def test_cards_and_quiz_import_together(context):
    body = json.loads(payload())
    body.update(QUIZ)
    result = context.imports.commit(json.dumps(body))
    assert result["cards"]["new"] == 2
    assert len(result["quizzes"]) == 1


def test_export_round_trips(context):
    context.imports.commit(payload())
    exported = context.imports.export_cards("Mathematics")
    assert len(exported["cards"]) == 2

    context.api_reset = None
    fresh_deck = json.dumps(exported)
    context.decks.delete("Mathematics")
    result = context.imports.commit(fresh_deck)
    assert result["cards"]["new"] == 2
