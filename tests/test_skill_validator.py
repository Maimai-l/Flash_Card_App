"""
The skill's validator and the app's importer must not drift apart.

The validator is a standalone copy of the rules, so that the skill works when
copied into another project. That duplication is only safe if it is checked:
the invariant here is that **anything the app rejects, the validator flags as an
error too**. The validator may be stricter (it also enforces authoring rules the
app has no opinion about); it may never be laxer.
"""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / ".claude/skills/knowledge-cards/scripts/validate_cards.py"
SAMPLES = sorted((ROOT / "samples").glob("*.json"))


@pytest.fixture(scope="module")
def validator():
    spec = importlib.util.spec_from_file_location("validate_cards", VALIDATOR_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validator_errors(validator, text: str) -> list[str]:
    report = validator.Report()
    payload = validator.parse_json(text, report)
    if payload is not None:
        validator.validate_payload(payload, report)
    return [f"{where}: {message}" for where, message in report.errors]


def app_errors(context, text: str) -> list[str]:
    preview = context.imports.preview(text)
    return [f"{i['where']}: {i['message']}" for i in preview["issues"] if i["level"] == "error"]


# Payloads the app refuses, one per rule it enforces.
REJECTED = {
    "invalid json": '{"deck": "CS", "cards": [',
    "single backslash": r'{"deck":"M","cards":[{"front":"f","back":"$\lambda$"}]}',
    "top level not an object": '"just a string"',
    "no cards and no quiz": '{"deck": "CS"}',
    "cards not a list": '{"deck":"CS","cards":{"front":"f"}}',
    "card missing back": '{"deck":"CS","cards":[{"front":"f"}]}',
    "card missing front": '{"deck":"CS","cards":[{"back":"b"}]}',
    "card not an object": '{"deck":"CS","cards":["nope"]}',
    "no deck anywhere": '{"cards":[{"front":"f","back":"b"}]}',
    "quiz without a name": '{"quiz":{"questions":[{"type":"short","prompt":"p","answers":["a"]}]}}',
    "quiz without questions": '{"quiz":{"name":"Q","questions":[]}}',
    "mcq with one option": '{"quiz":{"name":"Q","questions":[{"type":"mcq","prompt":"p","options":["a"],"answer":0}]}}',
    "mcq answer out of range": '{"quiz":{"name":"Q","questions":[{"type":"mcq","prompt":"p","options":["a","b"],"answer":9}]}}',
    "mcq answer not an index": '{"quiz":{"name":"Q","questions":[{"type":"mcq","prompt":"p","options":["a","b"],"answer":"b"}]}}',
    "mcq without a prompt": '{"quiz":{"name":"Q","questions":[{"type":"mcq","options":["a","b"],"answer":0}]}}',
    "cloze without a blank": '{"quiz":{"name":"Q","questions":[{"type":"cloze","text":"no blanks"}]}}',
    "cloze without text": '{"quiz":{"name":"Q","questions":[{"type":"cloze"}]}}',
    "short without answers": '{"quiz":{"name":"Q","questions":[{"type":"short","prompt":"p","answers":[]}]}}',
    "short without a prompt": '{"quiz":{"name":"Q","questions":[{"type":"short","answers":["a"]}]}}',
    "ordering with one item": '{"quiz":{"name":"Q","questions":[{"type":"ordering","prompt":"p","items":["a"]}]}}',
    "ordering without a prompt": '{"quiz":{"name":"Q","questions":[{"type":"ordering","items":["a","b"]}]}}',
}


@pytest.mark.parametrize("label,text", sorted(REJECTED.items()))
def test_validator_catches_everything_the_app_rejects(validator, context, label, text):
    from_app = app_errors(context, text)
    from_validator = validator_errors(validator, text)
    assert from_app, f"fixture {label!r} was supposed to be rejected by the app, but was not"
    assert from_validator, (
        f"the app rejects {label!r} ({from_app[0]}) but the validator passed it — "
        "the skill would hand over broken JSON"
    )


def test_unknown_question_type_is_an_error_for_the_author(validator, context):
    """The app downgrades this to a warning and drops the question; the skill
    must not, or a quiz silently arrives shorter than it was written."""
    text = '{"quiz":{"name":"Q","questions":[{"type":"matching","prompt":"p"}]}}'
    assert validator_errors(validator, text)
    warnings = [i for i in context.imports.preview(text)["issues"] if i["level"] == "warning"]
    assert any("matching" in w["message"] for w in warnings)


def test_duplicate_ids_are_caught_before_they_overwrite(validator, context):
    text = json.dumps({"deck": "CS", "cards": [
        {"id": "a.b", "front": "one", "back": "x"},
        {"id": "a.b", "front": "two", "back": "y"},
    ]})
    assert any("duplicate id" in e for e in validator_errors(validator, text))
    # The app takes the second write silently — exactly what the check prevents.
    context.imports.commit(text)
    assert context.cards.count_all(None) == 1


@pytest.mark.parametrize("path", SAMPLES, ids=lambda p: p.name)
def test_samples_pass_the_validator_strictly(validator, path):
    report = validator.Report()
    payload = validator.parse_json(path.read_text(encoding="utf-8"), report)
    assert payload is not None
    validator.validate_payload(payload, report)
    assert not report.errors, report.errors
    assert not report.warnings, report.warnings


@pytest.mark.parametrize("path", SAMPLES, ids=lambda p: p.name)
def test_samples_import_without_complaint(context, path):
    result = context.imports.commit(path.read_text(encoding="utf-8"))
    assert result["ok"]
    assert result["issues"] == []
    assert result["cards"]["new"] > 0


def test_nested_tex_braces_are_not_mistaken_for_cloze(validator):
    """\\frac{x^{n+1}}{n+1} closes with }} and must not read as an unclosed blank."""
    text = json.dumps({"deck": "Mathematics::Calculus", "cards": [{
        "id": "calc.power.integral",
        "front": "What is $\\int x^n dx$?",
        "back": "$\\frac{x^{n+1}}{n+1} + C$ for $n \\neq -1$",
    }]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert not report.errors
    assert not report.warnings, report.warnings


def test_unclosed_cloze_blank_is_still_caught(validator):
    text = json.dumps({"quiz": {"name": "Q", "subject": "M", "id": "q.1", "questions": [
        {"type": "cloze", "text": "rank(A) + {{nullity(A)}} = {{n"}]}})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert any("never closed" in message for _, message in report.warnings)


def test_validator_accepts_a_minimal_valid_payload(validator):
    text = json.dumps({"deck": "Mathematics::Linear Algebra",
                       "cards": [{"id": "la.x", "front": "Define $A$", "back": "A matrix."}]})
    assert validator_errors(validator, text) == []


def test_cli_exit_codes(validator, tmp_path):
    good = tmp_path / "good.json"
    good.write_text(json.dumps({"deck": "M::N", "cards": [
        {"id": "m.a", "front": "What is $x$?", "back": "A variable."}]}))
    bad = tmp_path / "bad.json"
    bad.write_text('{"cards":[{"front":"f"}]}')
    warned = tmp_path / "warn.json"
    warned.write_text(json.dumps({"deck": "M::N", "cards": [
        {"front": "What is $x$?", "back": "A variable."}]}))  # no id → warning

    assert validator.main([str(good)]) == 0
    assert validator.main([str(bad)]) == 1
    assert validator.main([str(warned)]) == 0
    assert validator.main([str(warned), "--strict"]) == 1
    assert validator.main([str(tmp_path / "missing.json")]) == 2
