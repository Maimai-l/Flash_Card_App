# FlashCard App

A desktop vocabulary learning app for macOS, built with Python + pywebview.

## Features

- **FSRS spaced repetition** — Smart scheduling based on the Free Spaced Repetition Scheduler algorithm. Words are reviewed at optimal intervals based on your performance.
- **Multiple word books** — Comes bundled with CET-4/6, TOEFL, and GRE-8000 word lists. Import your own via Excel, JSON, TXT, or clipboard.
- **Daily sessions** — Each day you get a fixed set of new words + due reviews. Rate each word (Again / Hard / Good / Easy) to update its schedule.
- **Mini Games** — Practice with Card Match (flip-card matching game). More games coming.
- **Study calendar** — Visual history of completed study days.
- **Import / Export** — Import word lists from spreadsheets or text files; export the app log for debugging.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | HTML/CSS/JS (SPA) via pywebview |
| Backend | Python 3.11+ |
| Database | SQLite (auto-migrated, v1→v8) |
| Scheduling | FSRS algorithm (`fsrs` library) |
| Packaging | PyInstaller (macOS `.app`) |

## Running in Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run
python main.py
```

## Building

```bash
pyinstaller letmepack.spec -y
cp -R dist/FlashCardApp.app
```

The built app is self-contained — no Python installation required on the target machine.

## Data Storage

User data (database, logs, settings) is stored in:
```
~/Library/Application Support/FlashCardApp/
```

Resetting the app from Settings wipes study progress and user-imported books, while keeping the bundled word lists intact.
