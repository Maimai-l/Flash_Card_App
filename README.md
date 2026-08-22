# Knowledge Cards

A local flashcard app for knowledge points — maths, computer science, exam
material. Runs a small Python server on your own machine and opens in a browser.
No account, no network, no cloud; everything lives in one SQLite file.

Cards are written by an LLM and pasted in as JSON. The app schedules them and
gets out of the way.

## Running

```bash
pip install -r requirements.txt
python main.py
```

That starts a server on `127.0.0.1:8737` and opens your browser. `Ctrl-C` stops it.

```bash
python main.py --no-browser      # run without opening a browser
python main.py --port 9000       # use a different port
```

The server binds to loopback only and refuses cross-origin requests, so nothing
else on your network — or in another browser tab — can reach it.

## The two halves

**Cards** are persistent. Front, back, scheduled by
[FSRS](https://github.com/open-spaced-repetition/py-fsrs). You grade yourself
`Again / Hard / Good / Easy` (keys `1`–`4`), because a flashcard has no answer a
machine can check.

**Quizzes** are one-off. A fixed set of questions — multiple choice, cloze, short
answer, ordering — with the answer key written into the JSON. The app marks them,
so there is no self-rating, and nothing you do in a quiz touches any card's
schedule.

The two never mix. That is the whole design.

## Daily limits

Every subject has its own cap on new cards and reviews per day. Anything beyond
the cap simply does not appear — the backlog is shown as a quiet line of text,
not a red badge, and *Spread out* will flatten an accumulated pile across the
next few days.

Limits belong to top-level decks. Studying a chapter draws from its subject's
budget rather than getting a fresh one, and studying "all decks" walks each
subject's budget separately instead of merging them into a single pool.

There are no streaks and no targets. *Study more* on the finish screen ignores
the cap for that sitting and changes nothing about tomorrow. *Browse* reads
through a deck without scheduling anything at all.

## Importing

Paste JSON into the Import page. *Copy schema for LLM* puts a full worked
specification on your clipboard to hand to a model; paste back what it produces.
Import previews exactly what it would do before writing anything, and skips bad
entries rather than rejecting the whole paste.

The format is documented in [docs/SCHEMA.md](docs/SCHEMA.md). Sample files live
in [samples/](samples/).

## Keyboard

| Key | Where | Does |
|---|---|---|
| `Space` | reviewing | show the answer |
| `1` `2` `3` `4` | reviewing | Again / Hard / Good / Easy |
| `E` | reviewing | edit the current card in place |
| `Z` | reviewing | undo the last rating |
| `H` | reviewing | show the hint |
| `←` `→` | browsing | previous / next card |
| `1`…`9` | quiz | pick an option |
| `Enter` | quiz | check, then advance |
| `Esc` | anywhere | leave the session |

## Layout

```
main.py              start the server, open a browser
paths.py             where data and resources live
app/
  api.py             every method callable over POST /api
  server.py          static files + JSON dispatch, loopback only
  context.py         the object graph, wired once
  db/                schema and repositories (all SQL lives here)
  services/          scheduling, limits, quizzes, import/export, stats
web/
  index.html         the shell
  css/               tokens, components, per-view layout
  js/core/           transport, state, router, DOM, i18n, text rendering
  js/views/          one module per screen
  js/questions/      one module per question type
  vendor/katex/      bundled maths rendering, no CDN
tests/               pytest over repositories, services and HTTP
```

## Data

One SQLite file, plus a log:

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/KnowledgeCards/` |
| Linux | `~/.local/share/KnowledgeCards/` |
| Windows | `%APPDATA%\KnowledgeCards\` |

`KC_USER_DATA=/some/path` points the app somewhere else, which is how the tests
run against a throwaway directory.

Export from the Cards page for a portable backup; copy `knowledge.db` for a
complete one.

## Development

```bash
pip install -r requirements-dev.txt
python -m pytest tests/            # repositories, services, HTTP, skill validator
node tests/e2e/interaction.mjs     # browser pass over every screen
```

The e2e run needs Playwright and a server already running on port 8737.

## Authoring cards

`.claude/skills/knowledge-cards/` is a Claude Code skill that standardises how
cards get written — deck naming, field conventions, the atomicity rule, and the
distractor rules for quiz questions. Ask Claude for cards inside this repository
and it applies automatically; elsewhere, copy the folder into that project's
`.claude/skills/`.

The skill is self-contained: every field name, every rule and two worked
examples live inside its own folder, so copying the folder is enough. It ships a
validator and requires running it before handing anything over:

```bash
python3 .claude/skills/knowledge-cards/scripts/validate_cards.py cards.json --strict
```

Errors are things the app would reject or silently mishandle; warnings are
authoring rules. Standard library only, so it runs wherever the skill is copied.
`tests/test_skill_validator.py` asserts the validator flags everything the app's
importer rejects, so the two cannot drift apart, and holds `samples/` to a clean
`--strict` run.

The skill hands its output over as a **file**, not as JSON pasted into the chat —
a 90-card object is unusable as a code block, and the validated bytes are the
ones on disk.

To distribute or install it, package the folder into a `.skill` file (a zip
variant that Claude can install directly):

```bash
python3 -m scripts.package_skill /path/to/Flash_Card_App/.claude/skills/knowledge-cards
```

Run that from the `skill-creator` skill's directory. The resulting
`knowledge-cards.skill` is a build artifact and is not committed.

The Import page's *Copy schema for LLM* button covers the mechanical format for
one-off use without the skill.

## Language

English and 中文, switched in Settings. Card content is never translated.
