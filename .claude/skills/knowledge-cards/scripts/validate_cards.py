#!/usr/bin/env python3
"""
Validate Knowledge Cards import JSON before it reaches the app.

    python validate_cards.py cards.json
    cat cards.json | python validate_cards.py -

Two levels of finding:

  ERROR    the app would refuse this entry, or it would silently do the wrong
           thing (a duplicate id overwrites an existing card). Exit code 1.
  WARNING  the app accepts it, but it breaks an authoring rule from SKILL.md.
           Exit code 0 unless --strict.

Standard library only, so it runs anywhere the skill is copied to.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter

QUESTION_TYPES = ("mcq", "cloze", "short", "ordering")
TAG_VOCABULARY = {
    "definition", "theorem", "proof", "formula",
    "procedure", "example", "pitfall", "exam",
}
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)+$")
CLOZE_PATTERN = re.compile(r"\{\{(.+?)\}\}", re.S)
# Fronts are questions or imperatives. This list is reproduced verbatim in
# SKILL.md — keep the two in step, or authors are guessing at what passes.
QUESTION_OPENERS = (
    # interrogatives
    "what", "which", "why", "when", "where", "who", "whose", "how",
    # asking-for-recall imperatives
    "define", "state", "name", "list", "give", "recall", "identify",
    # asking-for-explanation imperatives
    "explain", "describe", "outline", "justify", "compare", "contrast",
    "distinguish", "summarise", "summarize", "interpret",
    # asking-for-work imperatives
    "calculate", "compute", "evaluate", "solve", "find", "determine", "derive",
    "prove", "show", "verify", "simplify", "expand", "factorise", "factorize",
    "differentiate", "integrate", "convert", "express", "rewrite", "write",
    "build", "construct", "draw", "sketch", "label", "complete", "translate",
    "order", "arrange", "given", "suppose", "consider",
)
QUESTION_MARKS = ("?", "？")

MAX_FRONT_WORDS = 20
MAX_BACK_WORDS = 50
MAX_HINT_WORDS = 8
MAX_CARDS_PER_BATCH = 40
QUIZ_SIZE_RANGE = (8, 15)


class Report:
    def __init__(self):
        self.errors: list[tuple[str, str]] = []
        self.warnings: list[tuple[str, str]] = []

    def error(self, where: str, message: str):
        self.errors.append((where, message))

    def warn(self, where: str, message: str):
        self.warnings.append((where, message))

    @property
    def ok(self) -> bool:
        return not self.errors


# ── Text helpers ──────────────────────────────────────────────────────────

CJK_WEIGHT = 0.4  # a CJK character is worth ~0.4 of an English word


def words(text: str) -> int:
    """
    Length in English-word equivalents.

    Counting each Chinese character as one word squeezed CJK and bilingual
    cards to roughly a third of the length an English card was allowed, with
    nothing in the rules saying so. A character is weighted at CJK_WEIGHT, so
    the 50-word ceiling is about 125 Chinese characters.
    """
    latin = re.findall(r"[A-Za-z0-9'’\-]+", text)
    cjk = re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", text)
    return round(len(latin) + len(cjk) * CJK_WEIGHT)


def strip_math(text: str) -> str:
    return re.sub(r"\$\$?.*?\$\$?", " ", text, flags=re.S)


def check_delimiters(text: str, where: str, field: str, report: Report, cloze: bool = False):
    """An unclosed $ renders the formula as literal text instead of maths."""
    without_display = text.replace("$$", "")
    if without_display.count("$") % 2 == 1:
        report.warn(where, f"{field}: odd number of $ — a formula is left unclosed")
    # {{ }} only means anything in cloze text. Elsewhere a doubled brace is
    # ordinary nested TeX — \frac{x^{n+1}}{n+1} closes with }} and is fine.
    if cloze and text.count("{{") != len(CLOZE_PATTERN.findall(text)):
        report.warn(where, f"{field}: a {{{{ is never closed")
    for wrong, right in (("\\(", "$"), ("\\[", "$$")):
        if wrong in text:
            report.warn(where, f"{field}: uses {wrong} — this app expects {right} for maths")


# ── Cards ─────────────────────────────────────────────────────────────────

def validate_card(entry, index: int, default_deck: str, report: Report) -> dict | None:
    where = f"cards[{index}]"
    if not isinstance(entry, dict):
        report.error(where, "not an object")
        return None

    front = str(entry.get("front") or "").strip()
    back = str(entry.get("back") or "").strip()
    if not front:
        report.error(where, "missing 'front'")
    if not back:
        report.error(where, "missing 'back'")
    deck = str(entry.get("deck") or default_deck or "").strip()
    if not deck:
        report.error(where, "no deck: set one on the card or at the top level")
    if not front or not back or not deck:
        return None

    label = f"cards[{index}] {front[:40]!r}"
    validate_deck_path(deck, label, report)

    card_id = entry.get("id")
    if card_id is None:
        report.warn(label, "no 'id' — re-importing this card will duplicate it")
    elif not ID_PATTERN.match(str(card_id)):
        report.warn(label, f"id {card_id!r} is not lower-case dot-separated (e.g. la.eigenvector.def)")

    if words(front) > MAX_FRONT_WORDS:
        report.warn(label, f"front is {words(front)} words — over {MAX_FRONT_WORDS}, so it is doing too much")
    plain_front = strip_math(front).strip().lower()
    asks = any(mark in front for mark in QUESTION_MARKS)
    if plain_front and not asks and not plain_front.startswith(QUESTION_OPENERS):
        report.warn(label, "front is neither a question nor an imperative "
                           "(see the opener list in SKILL.md)")
    if re.match(r"^(list|name)\s+all\b", plain_front):
        report.warn(label, "'list all' cards cannot be graded honestly — split them")

    back_words = words(back)
    if back_words > MAX_BACK_WORDS:
        report.warn(label, f"back is {back_words} words — over {MAX_BACK_WORDS}, likely two cards in one")

    hint = str(entry.get("hint") or "").strip()
    if hint:
        if words(hint) > MAX_HINT_WORDS:
            report.warn(label, f"hint is {words(hint)} words — over {MAX_HINT_WORDS}")
        shared = shared_terms(hint, back)
        if shared:
            report.warn(label, f"hint gives the answer away (shares {', '.join(sorted(shared))})")

    tags = entry.get("tags")
    if tags is not None:
        if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
            report.error(label, "'tags' must be a list of strings")
        else:
            if len(tags) > 2:
                report.warn(label, f"{len(tags)} tags — two is the limit")
            for tag in tags:
                if tag.lower() not in TAG_VOCABULARY:
                    report.warn(label, f"tag {tag!r} is outside the vocabulary "
                                       f"({', '.join(sorted(TAG_VOCABULARY))})")

    for field, text in (("front", front), ("back", back), ("hint", hint)):
        if text:
            check_delimiters(text, label, field, report)

    return {"id": entry.get("id"), "deck": deck, "front": front}


LATIN_STOPWORDS = {"which", "there", "these", "those", "where", "about",
                   "every", "under", "their", "between", "because"}
CJK_STOPWORDS = {"因为", "所以", "可以", "就是", "这个", "那个", "一个", "什么",
                 "不是", "以及", "并且", "如果", "然后", "表示", "进行", "使用"}


def shared_terms(hint: str, back: str) -> set[str]:
    """Distinctive terms appearing in both — the usual way a hint leaks."""
    def latin(text):
        return {w.lower() for w in re.findall(r"[A-Za-z]{5,}", strip_math(text))}

    def cjk_bigrams(text):
        grams = set()
        for run in re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]{2,}", strip_math(text)):
            grams |= {run[i:i + 2] for i in range(len(run) - 1)}
        return grams

    return ((latin(hint) & latin(back)) - LATIN_STOPWORDS) | \
           ((cjk_bigrams(hint) & cjk_bigrams(back)) - CJK_STOPWORDS)


def validate_deck_path(deck: str, where: str, report: Report):
    if "/" in deck and "::" not in deck:
        report.warn(where, f"deck {deck!r} uses / — levels are separated by ::")
    parts = [p for p in deck.split("::")]
    if any(not p.strip() for p in parts):
        report.error(where, f"deck {deck!r} has an empty level")
    if len(parts) == 1:
        report.warn(where, f"deck {deck!r} is a single level — use Subject::Module")
    if len(parts) > 3:
        report.warn(where, f"deck {deck!r} is {len(parts)} levels deep — three is the limit")


# ── Questions ─────────────────────────────────────────────────────────────

def validate_question(entry, where: str, report: Report) -> str | None:
    if not isinstance(entry, dict):
        report.error(where, "not an object")
        return None

    qtype = str(entry.get("type") or "").strip().lower()
    if qtype not in QUESTION_TYPES:
        report.error(where, f"unknown type {qtype or '(missing)'!r} — the app drops it. "
                            f"Use one of: {', '.join(QUESTION_TYPES)}")
        return None

    prompt = str(entry.get("prompt") or "").strip()
    for field in ("prompt", "text", "explain"):
        value = entry.get(field)
        if isinstance(value, str) and value:
            check_delimiters(value, where, field, report, cloze=(qtype == "cloze" and field == "text"))

    if qtype == "mcq":
        options = entry.get("options")
        if not prompt:
            report.error(where, "mcq needs a 'prompt'")
        if not isinstance(options, list) or len(options) < 2:
            report.error(where, "mcq needs at least 2 'options'")
            return qtype
        answer = entry.get("answer")
        indices = answer if isinstance(answer, list) else [answer]
        if not indices or any(not isinstance(i, int) or isinstance(i, bool) for i in indices):
            report.error(where, "mcq 'answer' must be an option index, or a list of indices")
            return qtype
        if any(i < 0 or i >= len(options) for i in indices):
            report.error(where, f"mcq 'answer' out of range (valid: 0-{len(options) - 1})")
        if len(options) != 4:
            report.warn(where, f"mcq has {len(options)} options — four is the house style")
        if not str(entry.get("explain") or "").strip():
            report.warn(where, "mcq has no 'explain' — required by the skill")
        lengths = sorted(len(str(o)) for o in options)
        median = lengths[len(lengths) // 2] or 1
        if lengths[-1] > 2.5 * median:
            report.warn(where, "one option is far longer than the rest — length is a tell")
        if len(indices) > 1 and "select all" not in prompt.lower():
            report.warn(where, "multi-answer mcq should say 'Select all that apply'")

    elif qtype == "cloze":
        text = str(entry.get("text") or "").strip()
        if not text:
            report.error(where, "cloze needs 'text'")
            return qtype
        blanks = CLOZE_PATTERN.findall(text)
        if not blanks:
            report.error(where, "cloze 'text' has no {{blank}}")
        if len(blanks) > 2:
            report.warn(where, f"{len(blanks)} blanks — one or two keeps it a question")
        for blank in blanks:
            if not blank.strip():
                report.error(where, "cloze has an empty {{}}")
            elif len(blank.strip()) < 2 and blank.strip().isalpha():
                report.warn(where, f"blank {{{{{blank}}}}} hides a single letter")

    elif qtype == "short":
        if not prompt:
            report.error(where, "short needs a 'prompt'")
        answers = entry.get("answers")
        if not isinstance(answers, list) or not [a for a in answers if str(a).strip()]:
            report.error(where, "short needs a non-empty 'answers' list")
        elif len(answers) == 1:
            report.warn(where, "only one accepted answer — list synonyms, symbols and abbreviations")

    elif qtype == "ordering":
        items = entry.get("items")
        if not prompt:
            report.error(where, "ordering needs a 'prompt'")
        if not isinstance(items, list) or len(items) < 2:
            report.error(where, "ordering needs at least 2 'items'")
        elif len(items) > 6:
            report.warn(where, f"{len(items)} items — six is the limit")

    match = entry.get("match")
    if match is not None and match not in ("loose", "exact"):
        report.error(where, f"'match' must be 'loose' or 'exact', not {match!r}")

    return qtype


def validate_quiz(group, where: str, report: Report):
    if not isinstance(group, dict):
        report.error(where, "quiz must be an object")
        return

    name = str(group.get("name") or "").strip()
    if not name:
        report.error(where, "quiz needs a 'name'")
    label = f"{where} {name[:32]!r}" if name else where

    questions = group.get("questions")
    if not isinstance(questions, list) or not questions:
        report.error(label, "quiz needs a non-empty 'questions' list")
        return

    if not str(group.get("subject") or "").strip():
        report.warn(label, "no 'subject' — the quiz will not group with its cards")
    if not group.get("id"):
        report.warn(label, "no 'id' — re-importing will create a second copy")

    low, high = QUIZ_SIZE_RANGE
    if not low <= len(questions) <= high:
        report.warn(label, f"{len(questions)} questions — aim for {low}-{high}")

    kinds = []
    answer_indices = []
    for index, question in enumerate(questions):
        qtype = validate_question(question, f"{label}.questions[{index}]", report)
        if qtype:
            kinds.append(qtype)
        if isinstance(question, dict) and question.get("type") == "mcq":
            answer = question.get("answer")
            if isinstance(answer, int) and not isinstance(answer, bool):
                answer_indices.append(answer)

    if len(set(kinds)) == 1 and len(kinds) > 3:
        report.warn(label, f"every question is '{kinds[0]}' — mix the types")
    if len(answer_indices) >= 4 and len(set(answer_indices)) == 1:
        report.warn(label, f"every mcq answer is index {answer_indices[0]} — vary the position")


# ── Payload ───────────────────────────────────────────────────────────────

def validate_payload(payload, report: Report):
    if isinstance(payload, list):
        report.warn("json", "top level is a list — wrap it as {\"deck\": ..., \"cards\": [...]}")
        payload = {"cards": payload}
    if not isinstance(payload, dict):
        report.error("json", "top level must be an object with 'cards' and/or 'quiz'")
        return

    default_deck = str(payload.get("deck") or "").strip()
    entries = payload.get("cards")
    parsed = []
    if entries is not None:
        if not isinstance(entries, list):
            report.error("cards", "'cards' must be a list")
        else:
            for index, entry in enumerate(entries):
                card = validate_card(entry, index, default_deck, report)
                if card:
                    parsed.append(card)
            if len(entries) > MAX_CARDS_PER_BATCH:
                report.warn("cards", f"{len(entries)} cards in one paste — "
                                     f"split into batches of {MAX_CARDS_PER_BATCH}")

    seen_ids: dict[str, int] = {}
    seen_fronts: dict[tuple[str, str], int] = {}
    for index, card in enumerate(parsed):
        if card["id"]:
            key = str(card["id"])
            if key in seen_ids:
                report.error(f"cards[{index}]",
                             f"duplicate id {key!r} (also at cards[{seen_ids[key]}]) — "
                             "the second card would overwrite the first")
            else:
                seen_ids[key] = index
        front_key = (card["deck"], card["front"].lower())
        if front_key in seen_fronts:
            report.warn(f"cards[{index}]",
                        f"same front as cards[{seen_fronts[front_key]}] in the same deck")
        else:
            seen_fronts[front_key] = index

    quizzes = []
    if payload.get("quiz") is not None:
        quizzes.append(("quiz", payload["quiz"]))
    if payload.get("quizzes") is not None:
        if not isinstance(payload["quizzes"], list):
            report.error("quizzes", "'quizzes' must be a list")
        else:
            quizzes += [(f"quizzes[{i}]", g) for i, g in enumerate(payload["quizzes"])]
    for where, group in quizzes:
        validate_quiz(group, where, report)

    if entries is None and not quizzes:
        report.error("json", "nothing to import: no 'cards' and no 'quiz'")


# ── JSON parsing, with the failures this format actually produces ─────────

def parse_json(text: str, report: Report):
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        line = text.splitlines()[exc.lineno - 1] if 0 < exc.lineno <= len(text.splitlines()) else ""
        report.error(f"json:{exc.lineno}:{exc.colno}", exc.msg)
        if line.strip():
            report.error(f"json:{exc.lineno}", f"→ {line.strip()[:100]}")

        # Diagnose from the offending line first — a payload can contain more
        # than one of these, and the one the parser stopped on is the cause.
        commented = line.lstrip().startswith(("//", "/*"))
        if "Invalid \\escape" in exc.msg:
            report.error("json", "A single backslash. TeX in JSON needs it doubled: "
                                 r'"$Av = \\lambda v$", not "$Av = \lambda v$".')
        elif commented:
            report.error("json", "Comments are not valid JSON. The examples in SKILL.md "
                                 "annotate with // for readability; real output must not.")
        elif "Expecting property name" in exc.msg or "Expecting value" in exc.msg:
            if re.search(r",\s*[}\]]", text):
                report.error("json", "Trailing comma before } or ] — JSON does not allow one.")
            elif re.search(r"^\s*//|/\*", text, re.M):
                report.error("json", "Comments are not valid JSON; strip every // and /* */.")
        return None


def render(report: Report, source: str, quiet: bool) -> None:
    for where, message in report.errors:
        print(f"ERROR    {where}: {message}", file=sys.stderr)
    if not quiet:
        for where, message in report.warnings:
            print(f"warning  {where}: {message}", file=sys.stderr)

    errors, warnings = len(report.errors), len(report.warnings)
    if not errors and not warnings:
        print(f"OK  {source} passes every check", file=sys.stderr)
    else:
        print(f"\n{errors} error(s), {warnings} warning(s) in {source}", file=sys.stderr)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Validate Knowledge Cards import JSON")
    parser.add_argument("path", help="JSON file, or - to read stdin")
    parser.add_argument("--strict", action="store_true", help="fail on warnings too")
    parser.add_argument("--quiet", action="store_true", help="errors only")
    args = parser.parse_args(argv)

    if args.path == "-":
        text, source = sys.stdin.read(), "stdin"
    else:
        try:
            with open(args.path, encoding="utf-8") as handle:
                text = handle.read()
        except OSError as exc:
            print(f"ERROR    cannot read {args.path}: {exc}", file=sys.stderr)
            return 2
        source = args.path

    report = Report()
    payload = parse_json(text, report)
    if payload is not None:
        validate_payload(payload, report)

    render(report, source, args.quiet)
    if report.errors:
        return 1
    return 1 if (args.strict and report.warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
