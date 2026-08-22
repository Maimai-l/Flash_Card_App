---
name: knowledge-cards
description: Author import JSON for the Knowledge Cards app — flashcards and quizzes for maths, computer science, and exam syllabi. Use whenever the user asks for cards, a deck, a quiz, or revision material for that app, or pastes its schema; also when they say "make cards for X", "出卡", "做一份测验", or hand over lecture notes / a syllabus / a chapter to turn into cards. Do NOT use for general explanation, tutoring, or study planning.
---

# Authoring cards for Knowledge Cards

You are writing data, not prose. The output is a JSON object the user pastes
into the app's Import page. Everything below is a rule, not a suggestion — the
app schedules this material for months, so a sloppy card is a sloppy month.

**This file is the whole specification.** Every key name, every accepted value,
and every rule is defined here. Do not look for a schema document elsewhere;
there is nothing else to read. The only other files in this skill are
`scripts/validate_cards.py` and two validated examples in `reference/`.

---

## Before you write anything

### 1. Triage the material three ways

Not everything in a chapter belongs in the app. Decide per item:

| Goes in | What it is | Test |
|---|---|---|
| **a card** | one fact, definition, relationship or distinction you must recall cold | Could you write the answer on a blank page from the prompt alone? |
| **a quiz question** | something with a checkable answer that is better *chosen or produced* than recalled | Is there a definite right answer you can write down in advance? |
| **neither** | exam technique, marking-scheme wording, "how do I decide which method to use", study strategy, anything whose answer is "it depends on the question in front of you" | If the honest answer starts "it depends", it is not data. |

The third row is the one that gets forgotten. When material fails both tests,
**say it in your reply as ordinary prose and encode nothing**. Do not manufacture
a card like `"front": "What is the test?"` to give it somewhere to live — that
card is unanswerable in a shuffled deck and will waste the user's reviews for
months.

### 2. Settle the deck path

See *Deck naming*. Reuse an existing subject with its exact spelling; look at
the user's deck list before inventing one.

### 3. Settle the scope

One chapter, one lecture, one syllabus section. See *Scope* — deliver the whole of it in one
reply rather than stopping after a first instalment.

### 4. Language

Cards are written in **English**, with the Chinese term in parentheses the first
time a piece of technical vocabulary appears on that card:

```
"front": "What does a cache miss (缓存未命中) cost?"
"back":  "A fetch from the next level down..."
```

This holds regardless of what language the conversation is in. Do not switch to
Chinese just because the user is writing in Chinese; they will ask if they want
it. Write a card wholly in Chinese only when the user says so, or when the
material itself is Chinese-language content.

---

## The output contract

1. Write the JSON **to a file** in a writable location (`/tmp/cards.json`).
2. Run the validator over it until it prints `OK` (see *Validate*).
3. Paste the validated content into your reply as one fenced json block.

Writing JSON straight into the reply is how invalid JSON reaches the user. Write
the file first. A sentence before the block naming the deck and the count is
fine; an essay is not.

---

## Complete field reference

### Top level

| Key | Required | Type | Meaning |
|---|---|---|---|
| `deck` | no | string | Default deck for every card below. A card may override it. |
| `cards` | see note | array of **card** objects | |
| `quiz` | see note | one **quiz** object | |
| `quizzes` | see note | array of **quiz** objects | Several quizzes in one import. |

At least one of `cards`, `quiz`, `quizzes` must be present. All three may appear
together in a single object.

### Card object

| Key | Required | Type | Meaning |
|---|---|---|---|
| `front` | **yes** | string | The prompt: a question or an imperative. |
| `back` | **yes** | string | The answer. |
| `deck` | yes, here or at top level | string | `Subject::Module` |
| `id` | strongly recommended | string | Stable slug; re-import updates instead of duplicating. |
| `hint` | no | string | Shown only on request, before the answer. |
| `tags` | no | array of strings | From the controlled vocabulary below. |

### Quiz object

| Key | Required | Type | Meaning |
|---|---|---|---|
| `name` | **yes** | string | Shown in the quiz list. |
| `questions` | **yes** | array of **question** objects | Non-empty. |
| `subject` | recommended | string | The *subject* level of the deck, so the quiz groups with its cards. |
| `id` | recommended | string | Stable slug; re-import replaces the questions and keeps the score history. |

### How they nest

```jsonc
{
  "deck": "Computer Science::Networks",
  "cards": [
    { "id": "net.arp", "front": "What does ARP resolve?",
      "back": "An IP address to a MAC address, on the local link only.",
      "tags": ["definition"] }
  ],
  "quiz": {
    "id": "net.transport",
    "name": "Transport layer basics",
    "subject": "Computer Science",
    "questions": [
      { "type": "mcq", "prompt": "...", "options": ["a", "b", "c", "d"],
        "answer": 0, "explain": "..." },
      { "type": "cloze", "text": "SYN, {{SYN-ACK}}, {{ACK}}." }
    ]
  }
}
```

Use `"quizzes": [ { ... }, { ... } ]` instead of `"quiz"` when one import
carries several quizzes. `questions` is the key inside a quiz object; there is
no other place question objects may appear.

### Question objects

Four types. `type` is required and must be exactly one of `mcq`, `cloze`,
`short`, `ordering` — anything else is dropped at import with a warning, so the
quiz silently arrives shorter than you wrote it.

**`mcq`** — multiple choice.

```jsonc
{
  "type": "mcq",
  "prompt": "Which is **not** guaranteed by TCP?",
  "options": ["Ordered delivery",
              "Retransmission of lost segments",
              "Bounded latency",
              "Flow control"],
  "answer": 2,
  "explain": "TCP promises delivery, not timeliness — nothing in it bounds latency. Flow control is guaranteed: the receive window exists to stop a fast sender overrunning a slow receiver."
}
```

| Key | Required | Type | Meaning |
|---|---|---|---|
| `prompt` | **yes** | string | The question. |
| `options` | **yes** | array of strings | At least 2; four is the house style. |
| `answer` | **yes** | integer, or array of integers | Zero-based index into `options`. Use an array for multi-answer. |
| `explain` | **yes** by this skill | string | Why the right answer is right, and what the attractive wrong one gets wrong. |

**`cloze`** — fill the blanks. The text goes in `text`, not `prompt`.

```jsonc
{
  "type": "cloze",
  "text": "The TCP handshake is SYN, {{SYN-ACK|SYN ACK}}, then {{ACK}}.",
  "explain": "Three segments, synchronising sequence numbers in both directions.",
  "match": "loose"
}
```

| Key | Required | Type | Meaning |
|---|---|---|---|
| `text` | **yes** | string | Sentence with `{{...}}` marking each blank. One or two blanks. |
| `explain` | no | string | |
| `match` | no | `"loose"` (default) or `"exact"` | |

Alternatives inside a blank are separated by a pipe; the first is shown as the
answer: `{{SYN-ACK|SYN ACK}}`, `{{n|dim V}}`.

**`short`** — typed answer. The accepted answers go in `answers`, an array.

```jsonc
{
  "type": "short",
  "prompt": "Which OSI layer does TCP sit at?",
  "answers": ["transport", "layer 4", "4"],
  "match": "loose",
  "explain": "Segments and ports live at layer 4."
}
```

| Key | Required | Type | Meaning |
|---|---|---|---|
| `prompt` | **yes** | string | |
| `answers` | **yes** | array of strings | Every acceptable form. Non-empty. |
| `match` | no | `"loose"` (default) or `"exact"` | |
| `explain` | no | string | |

**`ordering`** — put the steps back in order. The steps go in `items`.

```jsonc
{
  "type": "ordering",
  "prompt": "Order these by what a packet meets first, leaving your machine",
  "items": ["Application", "Transport", "Network", "Data link"],
  "explain": "Each layer wraps the one above it on the way out."
}
```

| Key | Required | Type | Meaning |
|---|---|---|---|
| `prompt` | **yes** | string | |
| `items` | **yes** | array of strings | **Written in the correct order** — the app shuffles them. 3–6 items, each under ~8 words. |
| `explain` | no | string | |

### Matching

`"loose"` (the default everywhere) ignores case, surrounding whitespace, and
punctuation, including full-width CJK punctuation. `"exact"` compares the
trimmed string as written; use it only when the precise form is the point.

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
| `CAIE 9618::Data Representation` | `9618 Paper 1 Revision Notes 2026` (dated, verbose) |

Rules:

- Two levels by default. Add a third only when a module has grown big enough
  that the user would want to study its parts separately — that is a judgement
  about their revision, not a card count.
- Title Case. No dates, no years, no revision/notes/practice suffixes.
- Reuse an existing subject exactly as spelled — a typo creates a second subject
  with its own daily budget.
- Set `deck` once at the top level; use the per-card override only when a batch
  genuinely spans modules.

---

## Writing cards

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
  "back": "The retransmission timer expires, or three duplicate ACKs arrive for
           the preceding segment." }
{ "front": "Which two algorithms make up TCP congestion control?",
  "back": "Slow start, then AIMD — additive increase, multiplicative decrease." }
```

### `front`

Must be a question or an imperative. The validator accepts a front containing
`?` or `？`, or one starting with any of these openers — this is the list it
actually checks, reproduced verbatim:

```
what which why when where who whose how
define state name list give recall identify
explain describe outline justify compare contrast distinguish summarise
  summarize interpret
calculate compute evaluate solve find determine derive prove show verify
  simplify expand factorise factorize differentiate integrate convert express
  rewrite write build construct draw sketch label complete translate order
  arrange given suppose consider
```

Beyond that:

- Under ~20 words. If it needs a paragraph of setup, the card is too big.
- Answerable without seeing other cards. "And the second case?" is meaningless
  in a shuffled deck.
- `list` and `name` are valid openers, but **"List all …" is still banned** — an
  open-ended enumeration cannot be graded honestly. "List the three states of a
  TCP connection" is fine; "List all TCP options" is not.
- Include the qualifier that makes the answer unique. "What is the complexity?"
  is unanswerable; "What is the average-case complexity of quicksort?" is not.

### `back`

- **First sentence is the answer.** No restating the question, no "Well, …".
- Under ~50 words. Supporting detail goes in up to four bullets beneath.
- **Length is measured in English-word equivalents.** A CJK character counts as
  0.4 of a word, so the ceiling is roughly 125 Chinese characters, and a
  bilingual card is not penalised for carrying both forms of a term.
- No hedging ("usually", "some people say") unless the hedge is the fact.
- Bold at most one phrase per card, and only the word carrying the distinction.
- Do not end with an unasked-for aside. If it is worth knowing, it is its own card.

### `hint`

Optional and rare. Only when `front` is genuinely ambiguous without a nudge —
not to make a hard card easier. Under 8 words, and it must not contain the
answer. The validator flags a hint sharing distinctive words with its own back,
in Latin script and in Chinese.

```jsonc
"front": "When is $A$ diagonalisable?", "hint": "count eigenvectors"   // good
"front": "When is $A$ diagonalisable?", "hint": "n independent ones"   // gives it away
```

### `tags`

Lower case, singular, from this controlled list. Two at most:

`definition` · `theorem` · `proof` · `formula` · `procedure` · `example` ·
`pitfall` · `exam`

`pitfall` for cards that exist because the fact is commonly confused; `exam` for
material a syllabus explicitly names. Do not invent tags per chapter — the deck
path already says which chapter it is.

### `id`

Include one on every card. It makes an import repeatable: re-importing an edited
card updates it instead of creating a duplicate.

```
<subject-abbr>.<topic>.<slug>

la.eigenvector.def
net.tcp.handshake-why-three
9618.data-rep.twos-complement
```

Lower case, dot-separated, hyphens inside a segment, ASCII only, stable forever.
When you revise a card's wording, keep its `id` — that is the whole point.
Two cards sharing an `id` is an error: the second silently overwrites the first.

### Comparison cards

Allowed and useful, but the back must be structured and the axis of comparison
named in the front:

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
- Display mode for anything with a fraction, sum, integral, or matrix.
- Markdown available in card text: bold, italic, inline code, `- ` bullets,
  `1. ` numbered lists, blank line between paragraphs.
- Prose is prose — do not wrap ordinary words in dollar signs to look formal.

---

## Writing quizzes

A quiz is a fixed set for one sitting. It is not scheduled and does not touch any
card's schedule, so it is for *checking* a chapter, not for memorising it.

- Mix types. An all-MCQ quiz tests recognition only.

**MCQ distractors must be wrong for a nameable reason** — a real misconception,
an off-by-one, a swapped direction, the right answer to a neighbouring question.
Never filler, never obviously absurd. Keep all options the same grammatical shape
and roughly the same length; a longer, more qualified option is a tell. Vary the
answer index across the quiz.

**Cloze** blanks the load-bearing term, never an article or a connective. The
surrounding text must make the expected form obvious.

**Short answer** needs every acceptable form listed. If you cannot enumerate
them, it is not a short-answer question — make it a card instead.

**Ordering** is for genuine sequences: protocol exchanges, algorithm phases,
proof steps, layer stacks. Not for ranking by size or preference, where
"correct" is arguable.

---

## Scope

**Deliver the whole scope the user asked for, in one reply and in one JSON
object.** If they asked for a chapter, they get the chapter. Only stop early if
the user asked for a part, or if you genuinely cannot fit the rest — and then say
exactly what is missing.

There is no card limit. The app imports any number of cards in one paste, its
preview reports problems per entry however long the list is, and the only bound
anywhere is a 32 MB request body. Do not split output into instalments, and do
not invent a batch size.

- **Card count follows the material's term density, not a target.** A dense
  syllabus chapter — data representation, instruction sets, statistical tests —
  legitimately yields 60–90 cards. A discursive chapter yields 15–25. Neither
  number is a goal.
- Never pad to hit a number the user named, and never trim below what the
  material carries. If you found fewer than asked, say so and why.
- Order cards the way the material is taught — definitions before theorems,
  theorems before applications. New cards enter the queue in insertion order.

---

## Which numbers are real

The app enforces almost nothing. Knowing which is which stops you treating a
style preference as a hard stop.

| | |
|---|---|
| **Enforced by the app** | Required fields (`front`, `back`, a deck, quiz `name` and `questions`, each question type's own keys) · `answer` in range · at least 2 options · cloze needs a blank · 32 MB request body |
| **Enforced by this skill** | The controlled tag vocabulary · `explain` on every mcq · unknown question types are an error rather than a silent drop |
| **Heuristics that warn, and may be overridden with a reason** | ~20-word front · ~50-word-equivalent back · 8-word hint · four mcq options · one or two cloze blanks · 3–6 ordering items · three or more questions per quiz |

Nothing caps how many cards you write.

---

## Validate — not optional

```bash
python3 /absolute/path/to/knowledge-cards/scripts/validate_cards.py /tmp/cards.json --strict
```

Use the **absolute path** to the script. The skill directory is often read-only,
so write your JSON somewhere writable such as `/tmp`. Pass `-` instead of a file
to read stdin. Exit code 0 means clean, 1 means something to fix.

Two levels:

- **ERROR** — the app would refuse the entry, or would silently do the wrong
  thing (a duplicate `id` overwrites an existing card). Never hand over output
  with an error outstanding.
- **warning** — accepted by the app, but it breaks a rule above: a 70-word back,
  an invented tag, a hint that leaks its answer, an mcq whose every answer sits
  at the same index. Fix these; `--strict` makes them fail the run. Where a
  warning is a heuristic (see *Which numbers are real*) and the material genuinely
  needs the exception, keep it and say so in your reply.

Loop until it prints `OK`. If it reports something you believe is a false
positive, say so explicitly in your reply rather than quietly ignoring it.

### The three failures it exists to catch

**A single backslash.** A lone backslash before a TeX command is not valid JSON —
`\l` is not an escape sequence, and the whole payload fails to parse. Every
backslash in maths must be doubled. This is the most common failure by a wide
margin.

**Comments.** The examples in this file annotate with `//` for readability.
JSON has no comments. Real output must contain none.

**Trailing commas.** Valid in JavaScript, invalid in JSON.

### If Python is unavailable

Check by hand: valid JSON (no comments, no trailing commas, doubled
backslashes) · every card has `id`, `front`, `back`, and a deck · no duplicate
`id` · no `back` over ~50 word-equivalents or holding two independent facts · no
`front` that is unanswerable out of context · tags from the controlled list ·
mcqs with four options, a varied answer index, `explain` present, and distractors
wrong for a nameable reason · cloze text in `text` with blanks · short answers in
`answers` · ordering steps in `items`. Say in your reply that you could not run
the validator.

### What it cannot check

Judgement stays yours: whether a distractor is *plausibly* wrong rather than
merely present, whether a card is worth making at all, whether material should
have been triaged into "neither", and whether the deck path reuses an existing
subject with its exact spelling.

---

## Worked examples

`reference/example-cards.json` and `reference/example-quiz.json` sit next to this
file. Both pass `--strict`, and the repository's test suite keeps them that way.
Read one before your first batch.

A finished answer looks like this:

> 24 cards for `Mathematics::Linear Algebra`, covering eigenvalues through
> diagonalisation.

```json
{
  "deck": "Mathematics::Linear Algebra",
  "cards": [
    {
      "id": "la.eigenvector.def",
      "front": "Define an eigenvector of $A$",
      "back": "A **nonzero** vector $v$ such that $Av = \\lambda v$ for some scalar $\\lambda$.\n\n- $\\lambda$ is the corresponding eigenvalue\n- Zero is excluded, or every scalar would qualify",
      "tags": ["definition"]
    },
    {
      "id": "la.diagonalisable.condition",
      "front": "When is an $n \\times n$ matrix diagonalisable?",
      "back": "When it has $n$ linearly independent eigenvectors.\n\n- $n$ distinct eigenvalues is sufficient but not necessary\n- $I$ is diagonalisable with one repeated eigenvalue",
      "hint": "count them",
      "tags": ["theorem"]
    }
  ]
}
```

If the user asked for both cards and a quiz, put `cards` and `quiz` in the same
object rather than emitting two blocks.
