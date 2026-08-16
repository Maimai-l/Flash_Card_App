---
name: knowledge-cards
description: Author import JSON for the Knowledge Cards app — flashcards and quizzes for maths, computer science, and exam syllabi. Use whenever the user asks for cards, a deck, a quiz, or revision material for that app, or pastes its schema; also when they say "make cards for X", "出卡", "做一份测验", or hand over lecture notes / a syllabus / a chapter to turn into cards. Do NOT use for general explanation, tutoring, or study planning.
---

# Authoring cards for Knowledge Cards

You are writing data, not prose. The output is a single JSON object the user
pastes into the app's Import page. Everything below is a rule, not a suggestion —
the app schedules this material for months, so a sloppy card is a sloppy month.

Read `docs/SCHEMA.md` in the repository for the format's mechanics. This skill
covers what goes *in* the fields.

**Nothing leaves this skill unvalidated.** `scripts/validate_cards.py` enforces
every rule below that a machine can check. Write your JSON to a file, run it,
fix what it reports, and repeat until it is clean — see *Validate* at the end.

## Before writing anything

Settle three things. Ask only if you cannot infer them:

1. **Deck path** — which subject and module (see *Deck naming*).
2. **Cards, quiz, or both** — cards are for durable recall, a quiz is for
   checking a chapter you have just finished. If the user says "make cards",
   make cards; do not volunteer a quiz.
3. **Scope and size** — one chapter, one lecture, one syllabus section. If the
   source is bigger than that, split it and say which part you are doing.

Then write the JSON **to a file**, validate it, and only paste the validated
content into your reply — one fenced ```json block, nothing wrapped around it, no
commentary between objects. A sentence before the block naming the deck and the
count is fine; an essay is not.

Writing straight into the reply is how invalid JSON reaches the user. Write the
file first.

---

## Deck naming

```
Subject::Module
Subject::Module::Topic        (only when a module genuinely needs splitting)
```

**The subject level is load-bearing.** Daily limits attach to it, so subjects
must be few and stable. Use the name of the course or exam, never a chapter:

| Good | Bad |
|---|---|
| `Mathematics::Linear Algebra` | `Linear Algebra` (chapter promoted to subject) |
| `Computer Science::Networks` | `CS::Networks::TCP::Handshake` (four levels) |
| `TMUA::Paper 1 Reasoning` | `TMUA 2026 Paper 1 Reasoning Practice` (dated, verbose) |

Rules:

- Two levels by default, three only when a module exceeds ~60 cards.
- Title Case. No dates, no years, no "revision"/"notes"/"practice" suffixes.
- Reuse an existing subject exactly as spelled — a typo creates a second subject
  with its own daily budget.
- Set `deck` once at the top level; use the per-card `deck` override only when a
  batch genuinely spans modules.

---

## Cards

### The atomicity rule

**One card, one retrievable fact.** This is the rule that matters most.

If the answer contains two things that could be forgotten independently, it is
two cards. If the back runs past ~50 words, it is either two cards or a badly
written one.

```jsonc
// Wrong — three facts, one card. You will never grade this honestly.
{ "front": "Describe TCP",
  "back": "TCP is connection-oriented, provides ordered reliable delivery via
           sequence numbers and acknowledgements, and does congestion control
           with slow start and AIMD." }

// Right
{ "front": "What does TCP guarantee that UDP does not?",
  "back": "Ordered, reliable delivery — lost segments are retransmitted." }
{ "front": "How does TCP detect that a segment was lost?",
  "back": "The acknowledgement for it never arrives before the timer expires, or
           three duplicate ACKs arrive for the segment before it." }
{ "front": "Which two algorithms make up TCP congestion control?",
  "back": "Slow start, then AIMD — additive increase, multiplicative decrease." }
```

### `front`

- A question, or an imperative: *Define…*, *State…*, *Why…*, *When…*, *Given…*.
- Under ~20 words. If it needs a paragraph of setup, the card is too big.
- Must be answerable without seeing other cards. `"And the second case?"` is
  meaningless in a shuffled deck.
- Never *"List all…"* unless the list is closed and has at most five members.
- Include the qualifier that makes the answer unique. *"What is the complexity?"*
  is unanswerable; *"What is the average-case complexity of quicksort?"* is not.

### `back`

- **First sentence is the answer.** No restating the question, no "Well, …".
- Under ~50 words. Supporting detail goes in up to four `-` bullets beneath.
- No hedging ("usually", "some people say") unless the hedge is the fact.
- Bold at most one phrase per card, and only for the word that carries the
  distinction: `A **nonzero** vector $v$ with $Av = \\lambda v$.`
- Do not end with an unasked-for aside. If it is worth knowing, it is its own card.

### `hint`

Optional and rare. Use it only when `front` is genuinely ambiguous without a
nudge — not to make a hard card easier. Under 8 words, and it must not contain
the answer.

```jsonc
"front": "When is $A$ diagonalisable?", "hint": "count eigenvectors"     // good
"front": "When is $A$ diagonalisable?", "hint": "n independent ones"     // gives it away
```

### `tags`

Lower case, singular, from this controlled list. Two at most:

`definition` · `theorem` · `proof` · `formula` · `procedure` · `example` ·
`pitfall` · `exam`

Use `pitfall` for cards that exist because the fact is commonly confused, and
`exam` for material a syllabus explicitly names. Do not invent tags per chapter —
the deck path already says which chapter it is.

### `id`

Include one on every card. It makes an import repeatable: re-importing an
edited card updates it instead of creating a duplicate.

```
<subject-abbr>.<topic>.<slug>

la.eigenvector.def
net.tcp.handshake-why-three
calc.chain-rule.statement
```

Lower case, dot-separated, hyphens inside a segment, ASCII only, stable forever.
When you revise a card's wording, keep its `id` — that is the whole point.

### Comparison cards

Allowed, and useful, but the back must be structured and the axis of comparison
must be named in the front:

```jsonc
{ "id": "os.process-vs-thread.memory",
  "front": "Process vs thread: what do they share in memory?",
  "back": "Threads in one process share the heap and globals; processes share nothing by default.\n\n- Each thread still has its own stack and registers\n- Sharing is why threads need locks and processes do not" }
```

Do not write `"front": "Process vs thread"` — that asks for an essay and cannot
be graded.

---

## Maths and formatting

- Inline `$...$`, display `$$...$$`, TeX syntax, rendered by KaTeX.
- **JSON needs backslashes doubled**: `"$Av = \\lambda v$"`. Getting this wrong
  is the single most common failure — check every backslash before you finish.
- Variables and function names in maths mode: `$n$`, `$\\operatorname{rank}(A)$`.
  Never `rank(A)` in plain text next to `$n$` in maths.
- Display mode for anything with a fraction, sum, integral, or matrix.
- Markdown available in card text: `**bold**`, `*italic*`, `` `code` ``, `- `
  bullets, `1. ` numbers, blank line between paragraphs.
- Prose is prose — do not wrap ordinary words in `$…$` to make them look formal.

---

## Quizzes

A quiz is a fixed set for one sitting. It is not scheduled and does not touch any
card's schedule, so it is for *checking* a chapter, not for memorising it.

- 8–15 questions. Fewer is not worth the ceremony; more is a slog.
- `name`: the chapter or topic, matching how the user refers to it.
- `subject`: the deck's **subject** level, so quizzes group alongside cards.
- `id`: `<subject-abbr>.<topic>` — re-importing replaces the questions and keeps
  the score history.
- Mix types. An all-MCQ quiz tests recognition only.

### `mcq`

- Exactly four options unless the question is genuinely binary.
- **Distractors must be wrong for a nameable reason** — a real misconception, an
  off-by-one, a swapped direction, the right answer to a neighbouring question.
  Never filler, never obviously absurd.
- All options the same grammatical shape and roughly the same length. A longer,
  more qualified option is a tell.
- Vary the answer index across the quiz. Do not leave every answer at 1.
- `explain` is **required**: say why the right answer is right *and* what the
  attractive wrong one gets wrong.
- Use `"answer": [0, 2]` for multi-answer, and say "Select all that apply" in the
  prompt.

```jsonc
{ "type": "mcq",
  "prompt": "Which is **not** guaranteed by TCP?",
  "options": ["Ordered delivery", "Retransmission of lost segments",
              "Bounded latency", "Flow control"],
  "answer": 2,
  "explain": "TCP promises delivery, not timeliness — nothing in it bounds latency. Flow control is guaranteed: the receive window exists precisely to stop a fast sender overrunning a slow receiver." }
```

### `cloze`

- One or two blanks per question. Three is a sentence with holes, not a question.
- Blank the **load-bearing term**, never an article or a connective.
- Give alternatives with `|` whenever a correct answer has more than one accepted
  spelling: `{{SYN-ACK|SYN ACK}}`, `{{n|dim V}}`.
- The surrounding text must make the expected form obvious. If a blank could
  reasonably take a word or a symbol, list both.

### `short`

- Answers where the expected response is one word, one symbol, or one number.
- **List every reasonable form**: `["transport", "layer 4", "4"]`,
  `["lambda", "λ"]`. Default matching already ignores case, spacing, and
  punctuation — you are covering genuine synonyms, not typography.
- If you cannot enumerate the acceptable answers, it is not a short-answer
  question. Make it a card instead.
- `"match": "exact"` only when the precise string is the point.

### `ordering`

- 3–6 items, written in the correct order — the app shuffles them.
- Use for genuine sequences: protocol exchanges, algorithm phases, proof steps,
  layer stacks. Not for ranking by size or preference, where "correct" is arguable.
- Each item under ~8 words.

---

## Batch size and pacing

- **At most 40 cards per JSON object.** Beyond that, mistakes hide and the user
  cannot review the paste.
- A chapter usually yields 15–30 cards. If you are producing 80 from one lecture,
  you are transcribing rather than selecting.
- Order cards the way the material is taught — definitions before theorems,
  theorems before applications. New cards enter the queue in insertion order.
- Never pad to hit a number the user named. Say you found fewer than asked and
  why.

---

## Validate — not optional

```bash
python3 scripts/validate_cards.py cards.json --strict
```

Paths are relative to this skill's directory. Exit code 0 means clean; 1 means
something to fix. Read stdin with `-` if you prefer not to keep a file around.

It reports two levels:

- **ERROR** — the app would refuse the entry, or would silently do the wrong
  thing (a duplicate `id` overwrites an existing card). Never hand over output
  with an error outstanding.
- **warning** — accepted by the app, but it breaks a rule above: a 70-word back,
  an invented tag, a hint that leaks its answer, an mcq whose every answer sits
  at the same index. Fix these too; `--strict` makes them fail the run.

Loop until it prints `OK`. If it reports something you believe is a false
positive, say so explicitly in your reply rather than quietly ignoring it.

### The three failures it exists to catch

**A single backslash.** `"$Av = \lambda v$"` is not valid JSON — `\l` is not an
escape sequence, and the whole payload fails to parse. Every backslash in maths
must be doubled: `"$Av = \\lambda v$"`. This is the most common failure by a
wide margin.

**Comments.** The examples in this file annotate with `//` for readability.
JSON has no comments. Real output must contain none.

**Trailing commas.** Valid in JavaScript, invalid in JSON.

### If Python is unavailable

Fall back to checking by hand: valid JSON (no comments, no trailing commas,
doubled backslashes) · every card has `id`, `front`, `back`, and a deck · no
`back` over ~50 words or holding two independent facts · no `front` that is
unanswerable out of context · tags from the controlled list · mcqs with four
options, a varied answer index, `explain` present, and distractors that are
wrong for a nameable reason. Say in your reply that you could not run the
validator.

### What it cannot check

Judgement stays yours: whether a distractor is *plausibly* wrong rather than
merely present, whether a card is worth making at all, and whether the deck path
reuses an existing subject with its exact spelling. Look at the deck list before
you invent a subject.

---

## Shape of a finished answer

Two complete, validated examples live in `samples/` at the repository root —
`mathematics-linear-algebra.json` and `computer-science-networks.json`. Both pass
`--strict`, and the test suite keeps them that way. Read one before writing your
first batch.

> 24 cards for `Mathematics::Linear Algebra`, covering eigenvalues through
> diagonalisation.

```json
{
  "deck": "Mathematics::Linear Algebra",
  "cards": [
    {
      "id": "la.eigenvector.def",
      "front": "Define an eigenvector of $A$",
      "back": "A **nonzero** vector $v$ such that $Av = \\lambda v$ for some scalar $\\lambda$.\n\n- $\\lambda$ is the corresponding eigenvalue\n- The zero vector is excluded, or every scalar would qualify",
      "tags": ["definition"]
    },
    {
      "id": "la.diagonalisable.condition",
      "front": "When is an $n \\times n$ matrix diagonalisable?",
      "back": "When it has $n$ linearly independent eigenvectors.\n\n- $n$ distinct eigenvalues is sufficient but not necessary\n- $I$ is diagonalisable with one repeated eigenvalue",
      "hint": "count eigenvectors",
      "tags": ["theorem"]
    }
  ]
}
```

If the user asked for both, put `cards` and `quiz` in the same object rather than
emitting two blocks.
