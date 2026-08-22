# Import format

> This is the app's reference for what the importer accepts. If you are *writing*
> cards, the authority is `.claude/skills/knowledge-cards/SKILL.md`, which is
> self-contained and ships its own validator — do not treat this file as a
> prerequisite for it.

Everything enters the app as JSON pasted into the Import page. There are two
shapes, and they are unrelated to each other:

| Shape | What it is | Scheduled? | Counts against daily limits? |
|---|---|---|---|
| `cards` | Persistent flashcards, front and back | Yes, by FSRS | Yes |
| `quiz` | A fixed question set you take on demand | No | No |

A quiz question never attaches to a card, and a card never carries questions.
Deleting every card in a subject leaves its quizzes untouched, and taking a quiz
changes nothing about what is due.

Both shapes may appear in the same object.

---

## Cards

```jsonc
{
  "deck": "Mathematics::Linear Algebra",   // default deck for every card below
  "cards": [
    {
      "front": "Define an eigenvector of $A$",
      "back": "A **nonzero** vector $v$ such that $Av = \\lambda v$.",
      "hint": "think about direction",     // optional, revealed on request
      "tags": ["definition", "exam"],      // optional
      "id": "la.eigenvector.def",          // optional, see below
      "deck": "Mathematics::Other"         // optional, overrides the top-level deck
    }
  ]
}
```

**Required:** `front`, `back`, and a deck (either per card or at the top level).

**Decks** are a tree written with `::`. `Mathematics::Linear Algebra::Eigenvalues`
creates all three levels. Daily limits belong to the top level — the subject.

**`id`** makes an import repeatable. A card with an `id` that already exists is
updated in place rather than duplicated, so you can hand a deck back to an LLM,
have it revise the wording, and re-import without creating a second copy.

Without an `id`, a card whose `front` already exists in the same deck is reported
as a duplicate and skipped. Tick *Import duplicates too* to override that.

---

## Quizzes

```jsonc
{
  "quiz": {
    "name": "Linear Algebra — Ch.3",
    "subject": "Mathematics",              // optional, groups the quiz list
    "id": "la.ch3",                        // optional; re-import replaces this quiz
    "questions": [ ... ]
  }
}
```

Use `"quizzes": [ ... ]` to import several at once. Re-importing a quiz replaces
its question list wholesale; past attempt scores are kept. A half-finished run of
that quiz is discarded, because its saved answers point at questions that no
longer exist.

### Question types

**`mcq`** — the options and the answer key are yours. The app never generates
distractors.

```jsonc
{ "type": "mcq",
  "prompt": "Which is NOT a vector space axiom?",
  "options": ["Closure under addition",
              "A multiplicative inverse for every vector",
              "Associativity of addition",
              "Existence of a zero vector"],
  "answer": 1,                             // option index; [0, 2] for multi-answer
  "explain": "Vector spaces need additive inverses, not multiplicative ones." }
```

Single-answer questions submit on click. Multi-answer questions toggle and wait
for *Check*.

**`cloze`** — you decide what is hidden. The app never picks blanks itself.

```jsonc
{ "type": "cloze",
  "text": "rank(A) + {{nullity(A)}} = {{n|dim V}}",
  "match": "loose",                        // optional: "loose" (default) or "exact"
  "explain": "Rank-nullity theorem." }
```

Each `{{...}}` is one blank. Alternatives are separated by `|`; the first is what
gets shown as the answer.

**`short`** — graded against the list you supply.

```jsonc
{ "type": "short",
  "prompt": "Symbol conventionally used for an eigenvalue?",
  "answers": ["lambda", "λ"],
  "match": "loose" }
```

**`ordering`** — `items` are written in the correct order and shuffled for you.

```jsonc
{ "type": "ordering",
  "prompt": "Order the steps of Gaussian elimination",
  "items": ["Forward elimination to row echelon form",
            "Back substitution",
            "Read off the solution"] }
```

### Matching

`match: "loose"` (the default) ignores case, surrounding whitespace, and
punctuation — including full-width CJK punctuation. `match: "exact"` compares the
trimmed string as written; use it when the exact form is the point.

### Unknown types

A question whose `type` is not one of the four above is reported as a warning at
import time and dropped. The rest of the quiz imports normally.

---

## Text formatting

Both card text and question text accept:

- **Maths** — `$...$` inline, `$$...$$` display, TeX syntax, rendered by a
  bundled copy of KaTeX. No network access is involved.
- **Markdown**, a small subset: `**bold**`, `*italic*`, `` `code` ``, `- ` bullet
  lists, `1. ` numbered lists, and blank lines between paragraphs.

Remember that JSON needs its backslashes doubled: `$Av = \\lambda v$`.

---

## Export

*Cards → Export cards* copies the current deck back out in exactly the format
above, and each quiz can be exported from its `⋯` menu. Both round-trip: paste
what you exported and you get the same content back.

---

## Adding a question type

One file plus one line. `web/js/questions/<type>.js` exports an object with:

| Member | Purpose |
|---|---|
| `autoSubmit(question)` | submit as soon as an answer is picked? |
| `initialResponse(question)` | the blank response to start from |
| `render(question, state)` | HTML for the unanswered and marked states |
| `mount(root, q, state, ctx)` | wire up inputs; `ctx = {setResponse, submit}` |
| `canSubmit(question, state)` | is there enough of an answer to grade? |
| `grade(question, response)` | `true` / `false` |
| `summary(question, response)` | `{given, correct}` for the results page |
| `onKey(event, ...)` | optional; return `true` if the key was handled |
| `label(question)` | optional; short text for the results list |

Register it in `web/js/questions/index.js`, and add its validation rules to
`_validate_question` in `app/services/import_service.py` so bad data is caught at
import rather than at 2am mid-quiz.
