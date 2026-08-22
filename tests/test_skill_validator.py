"""
The skill's validator and the app's importer must not drift apart.

The validator is a standalone copy of the rules, so that the skill works when
copied into another project. That duplication is only safe if it is checked:
the invariant here is that **anything the app rejects, the validator flags as an
error too**. The validator may be stricter (it also enforces authoring rules the
app has no opinion about); it may never be laxer.
"""

import importlib.util
import re
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


# ── The skill must be self-contained ──────────────────────────────────────
#
# SKILL.md tells the user to copy this folder into other projects. Every file it
# points at therefore has to live inside the folder, and every rule it states has
# to match what the validator does. These tests are the ones that would have
# caught a specification outsourced to a file that was not shipped with it.

SKILL_DIR = ROOT / ".claude/skills/knowledge-cards"
SKILL_MD = SKILL_DIR / "SKILL.md"
REFERENCE_EXAMPLES = sorted((SKILL_DIR / "reference").glob("*.json"))

# Every key the app or the validator understands must be named in SKILL.md,
# or an author has to guess which key a value goes in.
DOCUMENTED_KEYS = [
    "deck", "cards", "quiz", "quizzes",
    "front", "back", "id", "hint", "tags",
    "name", "subject", "questions",
    "type", "prompt", "options", "answer", "explain",
    "text", "answers", "match", "items",
]


def test_skill_references_no_file_it_does_not_ship():
    """Any path SKILL.md points at must exist inside the skill directory."""
    text = SKILL_MD.read_text(encoding="utf-8")
    referenced = set(re.findall(r"`([\w./-]+\.(?:md|json|py))`", text))
    referenced |= set(re.findall(r"^\s*([\w./-]+\.(?:md|json|py))\b", text, re.M))
    missing = sorted(
        name for name in referenced
        if not name.startswith(("/", "http"))
        and name not in {"SKILL.md", "cards.json", "validate_cards.py"}
        and not (SKILL_DIR / name).exists()
    )
    assert not missing, f"SKILL.md points at files the skill does not ship: {missing}"


@pytest.mark.parametrize("key", DOCUMENTED_KEYS)
def test_every_field_name_is_documented(key):
    text = SKILL_MD.read_text(encoding="utf-8")
    assert f"`{key}`" in text or f'"{key}"' in text, (
        f"key {key!r} is never named in SKILL.md — an author would have to guess it"
    )


@pytest.mark.parametrize("question_type", ["mcq", "cloze", "short", "ordering"])
def test_every_question_type_has_a_complete_example(question_type):
    """Prose descriptions are how cloze.text and short.answers got missed."""
    text = SKILL_MD.read_text(encoding="utf-8")
    blocks = re.findall(r"```jsonc\n(.*?)```", text, re.S)
    matching = [b for b in blocks if f'"type": "{question_type}"' in b]
    assert matching, f"{question_type} has no complete JSON object in SKILL.md"
    required = {
        "mcq": ["prompt", "options", "answer", "explain"],
        "cloze": ["text", "explain", "match"],
        "short": ["prompt", "answers", "match"],
        "ordering": ["prompt", "items", "explain"],
    }[question_type]
    # One block must carry every key. Scattering them across examples is how
    # an author ends up guessing which key a value belongs in.
    assert any(all(f'"{key}"' in block for key in required) for block in matching), (
        f"no single {question_type} example in SKILL.md shows all of {required}"
    )


def test_opener_list_in_the_doc_matches_the_validator(validator):
    """SKILL.md reproduces the list verbatim; drift means authors guess."""
    text = SKILL_MD.read_text(encoding="utf-8")
    block = re.search(r"```\n(what which why[^`]*?)\n```", text, re.S)
    assert block, "the front-opener list is not reproduced in SKILL.md"
    documented = set(block.group(1).split())
    assert documented == set(validator.QUESTION_OPENERS), {
        "only in SKILL.md": sorted(documented - set(validator.QUESTION_OPENERS)),
        "only in validator": sorted(set(validator.QUESTION_OPENERS) - documented),
    }


@pytest.mark.parametrize("path", REFERENCE_EXAMPLES, ids=lambda p: p.name)
def test_reference_examples_pass_strictly(validator, path):
    report = validator.Report()
    payload = validator.parse_json(path.read_text(encoding="utf-8"), report)
    assert payload is not None
    validator.validate_payload(payload, report)
    assert not report.errors, report.errors
    assert not report.warnings, report.warnings


@pytest.mark.parametrize("path", REFERENCE_EXAMPLES, ids=lambda p: p.name)
def test_reference_examples_import_cleanly(context, path):
    result = context.imports.commit(path.read_text(encoding="utf-8"))
    assert result["ok"] and result["issues"] == []


# ── Rules the validator got wrong before ──────────────────────────────────

@pytest.mark.parametrize("front", [
    "Build the truth table for XOR",
    "Draw the memory layout of a linked list",
    "Simplify $\\frac{x^2 - 1}{x - 1}$",
    "Convert 0b1011 to denary",
    "Write the recurrence for merge sort",
    "Sketch the graph of $y = e^{-x}$",
    "Evaluate $\\int_0^1 x^2 dx$",
    "为什么 TCP 握手是三次？",
])
def test_ordinary_exam_imperatives_are_accepted(validator, front):
    text = json.dumps({"deck": "M::N", "cards": [
        {"id": "m.a", "front": front, "back": "An answer."}]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert not any("neither a question nor an imperative" in m
                   for _, m in report.warnings), report.warnings


def test_a_bare_noun_phrase_front_is_still_flagged(validator):
    text = json.dumps({"deck": "M::N", "cards": [
        {"id": "m.a", "front": "Chain rule", "back": "An answer."}]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert any("neither a question nor an imperative" in m for _, m in report.warnings)


def test_list_all_is_still_banned_even_though_list_is_an_opener(validator):
    text = json.dumps({"deck": "M::N", "cards": [
        {"id": "m.a", "front": "List all TCP options", "back": "Many."}]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert any("list all" in m.lower() for _, m in report.warnings)


def test_chinese_back_is_not_squeezed_to_a_third(validator):
    """125 Chinese characters is the stated equivalent of the 50-word ceiling."""
    text = json.dumps({"deck": "M::N", "cards": [
        {"id": "m.a", "front": "What is it?", "back": "知" * 120}]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert not any("back is" in m for _, m in report.warnings), report.warnings

    too_long = json.dumps({"deck": "M::N", "cards": [
        {"id": "m.a", "front": "What is it?", "back": "知" * 200}]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(too_long, report), report)
    assert any("back is" in m for _, m in report.warnings)


def test_a_bilingual_card_is_not_penalised_for_carrying_both_terms(validator):
    text = json.dumps({"deck": "Computer Science::Caching", "cards": [{
        "id": "cs.cache.miss",
        "front": "What does a cache miss (缓存未命中) cost?",
        "back": "A fetch from the next level down (下一级存储), which is one to two "
                "orders of magnitude slower than the hit it replaces.",
    }]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert not report.warnings, report.warnings


def test_full_width_question_mark_counts_as_a_question(validator):
    text = json.dumps({"deck": "M::N", "cards": [
        {"id": "m.a", "front": "三次握手的第三步是什么？", "back": "ACK。"}]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert not any("neither a question" in m for _, m in report.warnings)


def test_a_chinese_hint_that_leaks_is_caught(validator):
    text = json.dumps({"deck": "M::N", "cards": [{
        "id": "m.a",
        "front": "三次握手为什么不是两次？",
        "back": "两次无法确认客户端的接收能力。",
        "hint": "接收能力",
    }]})
    report = validator.Report()
    validator.validate_payload(validator.parse_json(text, report), report)
    assert any("gives the answer away" in m for _, m in report.warnings), report.warnings
