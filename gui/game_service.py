"""
Game subsystem — session management and word selection.

GameSessionManager is thread-safe (single threading.Lock).
It is constructed in main.py and injected into Api.
"""

import logging
import subprocess
import threading
import time
import uuid
from typing import Optional

import data.fsrs_system as fsrs

logger = logging.getLogger(__name__)

# ── Timing thresholds for FSRS rating conversion ──────────────────────────
_FAST_S = 3.0    # < 3 s → Easy (4)
_SLOW_S = 10.0   # > 10 s → Hard (2), else → Good (3)

# Sessions older than this are reaped lazily on the next create_session() call
SESSION_TTL_S = 3600  # 1 hour

# ── Game registry ──────────────────────────────────────────────────────────

GAME_REGISTRY: dict[str, dict] = {
    "flash_memory": {
        "id":          "flash_memory",
        "name":        "Flash Memory",
        "description": "Memorise cards briefly, then match word to definition.",
        "icon":        "flash",
        "min_words":   4,
        "max_words":   20,
        "config_schema": {
            "word_count":  {"type": "int",  "default": 10,   "min": 4,    "max": 20},
            "preview_ms":  {"type": "int",  "default": 3000, "min": 1000, "max": 8000},
            "fsrs_update": {"type": "bool", "default": True},
        },
        "word_fields": ["word", "definition"],
    },
    "word_scramble": {
        "id":          "word_scramble",
        "name":        "Word Scramble",
        "description": "Rearrange letters to spell the word — definition is the hint.",
        "icon":        "scramble",
        "min_words":   5,
        "max_words":   30,
        "config_schema": {
            "word_count":   {"type": "int",  "default": 15, "min": 5, "max": 30},
            "time_limit_s": {"type": "int",  "default": 0,  "min": 0, "max": 300},
            "fsrs_update":  {"type": "bool", "default": True},
        },
        "word_fields": ["word", "definition"],
    },
    "speed_typing": {
        "id":          "speed_typing",
        "name":        "Speed Typing",
        "description": "Type each word as fast as possible — definition shown as prompt.",
        "icon":        "typing",
        "min_words":   5,
        "max_words":   50,
        "config_schema": {
            "word_count":   {"type": "int",  "default": 20, "min": 5,  "max": 50},
            "round_time_s": {"type": "int",  "default": 60, "min": 30, "max": 180},
            "fsrs_update":  {"type": "bool", "default": True},
        },
        "word_fields": ["word", "definition", "example"],
    },
    "battle_mcq": {
        "id":          "battle_mcq",
        "name":        "Battle MCQ",
        "description": "Fast multiple choice with lives and a score streak.",
        "icon":        "battle",
        "min_words":   8,
        "max_words":   40,
        "config_schema": {
            "word_count":   {"type": "int",  "default": 20, "min": 8,  "max": 40},
            "lives":        {"type": "int",  "default": 3,  "min": 1,  "max": 5},
            "time_per_q_s": {"type": "int",  "default": 10, "min": 5,  "max": 30},
            "fsrs_update":  {"type": "bool", "default": False},  # arcade mode
        },
        "word_fields": ["word", "definition"],
    },
    "unity_slot": {
        "id":          "unity_slot",
        "name":        "Unity Game",
        "description": "Launch an external Unity game that receives your word list.",
        "icon":        "unity",
        "min_words":   1,
        "max_words":   100,
        "config_schema": {
            "word_count":     {"type": "int",    "default": 20, "min": 1, "max": 100},
            "unity_exe_path": {"type": "string", "default": ""},
            "fsrs_update":    {"type": "bool",   "default": True},
        },
        "word_fields": ["word", "definition", "example", "chinese"],
    },
    "card_match": {
        "id":          "card_match",
        "name":        "Card Match",
        "description": "Flip cards to pair each word with its definition.",
        "icon":        "match",
        "min_words":   3,
        "max_words":   12,
        "config_schema": {
            "word_count":  {"type": "int",  "default": 6,  "min": 3, "max": 12},
            "fsrs_update": {"type": "bool", "default": True},
        },
        "word_fields": ["word", "definition"],
    },
}


# ── Session model ──────────────────────────────────────────────────────────

class GameSession:
    """
    Per-game-session state.  States:
        PENDING   — created, words selected; client not yet playing
        ACTIVE    — client started gameplay (or Unity connected)
        COMPLETE  — submit_results called successfully
        ABANDONED — Unity process died before submitting, or TTL expired
    """

    def __init__(
        self,
        session_id: str,
        game_id: str,
        book_name: str,
        config: dict,
        words: list[dict],
    ):
        self.session_id = session_id
        self.game_id    = game_id
        self.book_name  = book_name
        self.config     = config
        self.words      = words
        self.word_set   = {w["word"].lower() for w in words}

        self.state       = "PENDING"
        self.created_at  = time.monotonic()

        self.unity_pid:  Optional[int]                 = None
        self.unity_proc: Optional[subprocess.Popen]    = None
        self.results:    Optional[list[dict]]           = None
        self.score:      Optional[int]                  = None


# ── Manager ────────────────────────────────────────────────────────────────

class GameSessionManager:
    """
    Thread-safe manager for all active game sessions.
    All public methods that touch _sessions acquire self._lock first.
    SQLite is accessed via per-call connections (already thread-safe).
    """

    def __init__(self, library, ws_server=None):
        """
        library    : gui.library.LibraryService instance
        ws_server  : data.game_ws_server.GameWsServer (may be set later via attribute)
        """
        self.library    = library
        self.ws_server  = ws_server
        self._lock      = threading.Lock()
        self._sessions: dict[str, GameSession] = {}

    # ── Public: game list ──────────────────────────────────────────────────

    def get_game_list(self) -> list[dict]:
        """Return all registered game types (without internal word_fields key)."""
        return [
            {k: v for k, v in meta.items() if k != "word_fields"}
            for meta in GAME_REGISTRY.values()
        ]

    # ── Public: session lifecycle ──────────────────────────────────────────

    def create_session(self, game_id: str, book_name: str, config: dict) -> dict:
        """
        Validate game_id, apply config defaults, select words, store session.

        Returns {ok, session_id, game_id, words, config, word_count}
        or      {error}.
        """
        if game_id not in GAME_REGISTRY:
            return {"error": f"Unknown game_id '{game_id}'"}

        meta     = GAME_REGISTRY[game_id]
        resolved = _resolve_config(meta["config_schema"], config)
        count    = resolved["word_count"]

        all_learned = bool(config.get("all_learned", False))
        words = self._select_words(game_id, book_name, count, all_learned=all_learned)
        if isinstance(words, dict):  # error dict
            return words

        if len(words) < meta["min_words"]:
            return {
                "error": (
                    f"Not enough words in '{book_name}' "
                    f"(need ≥{meta['min_words']}, got {len(words)})"
                )
            }

        session_id = str(uuid.uuid4())
        session    = GameSession(session_id, game_id, book_name, resolved, words)

        self._reap_old_sessions()
        with self._lock:
            self._sessions[session_id] = session

        return {
            "ok":         True,
            "session_id": session_id,
            "game_id":    game_id,
            "words":      words,
            "config":     resolved,
            "word_count": len(words),
        }

    def submit_results(self, session_id: str, results: list[dict]) -> dict:
        """
        Save per-word results, optionally apply FSRS updates, mark session COMPLETE.

        results items: {word, correct, elapsed_s, skipped?}
        Returns {ok, fsrs_updated, score, accuracy, session_id} or {error}.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return {"error": f"Session '{session_id}' not found or expired"}
            if session.state == "COMPLETE":
                return {"error": "Session already completed"}
            if session.state == "ABANDONED":
                return {"error": "Session was abandoned"}
            session.state = "ACTIVE"

        fsrs_update = session.config.get("fsrs_update", True)
        fsrs_updated = correct_count = total = 0

        for r in results:
            word      = (r.get("word") or "").strip()
            correct   = bool(r.get("correct", False))
            elapsed_s = float(r.get("elapsed_s", 5.0))
            skipped   = bool(r.get("skipped", False))

            if not word or word.lower() not in session.word_set or skipped:
                continue

            total += 1
            if correct:
                correct_count += 1

            if fsrs_update:
                fast_s = float(session.config.get("easy_s",  _FAST_S))
                slow_s = float(session.config.get("hard_s",  _SLOW_S))
                rating = _fsrs_rating(correct, elapsed_s, fast_s, slow_s)
                res    = fsrs.record_answer(self.library.db_path, word, rating)
                if res.get("ok"):
                    fsrs_updated += 1

        score    = _compute_score(session.game_id, results)
        accuracy = (correct_count / total) if total > 0 else 0.0

        with self._lock:
            session.state   = "COMPLETE"
            session.results = results
            session.score   = score

        return {
            "ok":           True,
            "fsrs_updated": fsrs_updated,
            "score":        score,
            "accuracy":     round(accuracy, 4),
            "session_id":   session_id,
        }

    def get_session_result(self, session_id: str) -> dict:
        """Return stored result for a session (used by Unity slot JS polling)."""
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return {"error": "Session not found"}
            return {
                "state":   session.state,
                "score":   session.score,
                "results": session.results,
            }

    def launch_unity(self, game_id: str, unity_exe_path: str, config: dict) -> dict:
        """
        Spawn the Unity executable as a subprocess.
        config must contain session_id (from create_session).

        Unity is launched with:
            --ws-host 127.0.0.1 --ws-port 18766 --session-id <uuid>
        """
        session_id = config.get("session_id")
        if not session_id:
            return {"error": "config must contain 'session_id'"}

        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return {"error": f"Session '{session_id}' not found"}

        cmd = [
            unity_exe_path,
            "--ws-host", "127.0.0.1",
            "--ws-port", "18766",
            "--session-id", session_id,
        ]

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
            )
        except FileNotFoundError:
            return {"error": f"Unity executable not found: {unity_exe_path}"}
        except Exception as e:
            return {"error": f"Failed to launch Unity: {e}"}

        with self._lock:
            session.unity_pid  = proc.pid
            session.unity_proc = proc
            session.state      = "ACTIVE"

        # Daemon watcher: detect Unity process death without blocking main thread
        watcher = threading.Thread(
            target=self._unity_watcher,
            args=(session_id, proc),
            daemon=True,
            name=f"unity-watcher-{session_id[:8]}",
        )
        watcher.start()

        return {"ok": True, "pid": proc.pid, "session_id": session_id}

    # ── Internal: word selection ───────────────────────────────────────────

    def _select_words(self, game_id: str, book_name: str, count: int,
                      all_learned: bool = False) -> list[dict] | dict:
        try:
            if all_learned:
                # All-learned mode: any word that has been reviewed at least once
                words = self.library.get_learned_words(book_name, limit=count * 2)
            else:
                # Primary: FSRS-driven (due + new, same pool as the main practice session)
                words = self.library.get_session_words(book_name, new_limit=count)

            # word_scramble / speed_typing: skip trivially short words
            if game_id in ("word_scramble", "speed_typing"):
                words = [w for w in words if len(w.get("word", "")) >= 3]

            # Pad with random words if the FSRS queue is too small
            if len(words) < count:
                extra = self.library.get_debug_words(book_name, limit=count * 2)
                seen  = {w["word"].lower() for w in words}
                if game_id in ("word_scramble", "speed_typing"):
                    extra = [w for w in extra if len(w.get("word", "")) >= 3]
                for w in extra:
                    if w["word"].lower() not in seen:
                        words.append(w)
                        seen.add(w["word"].lower())
                    if len(words) >= count:
                        break

            return words[:count]

        except Exception as e:
            logger.exception("_select_words failed: %s", e)
            return {"error": str(e)}

    # ── Internal: Unity process watching ──────────────────────────────────

    def _unity_watcher(self, session_id: str, proc: subprocess.Popen):
        """
        Blocks (in its own daemon thread) until the Unity process exits.
        Marks the session ABANDONED if it never reached COMPLETE.
        """
        exit_code = proc.wait()
        logger.info("Unity process for session %s exited (code=%d)", session_id, exit_code)

        with self._lock:
            session = self._sessions.get(session_id)
            if session and session.state == "ACTIVE":
                session.state = "ABANDONED"
                logger.warning(
                    "Unity session %s ABANDONED (process exited before submitting results)",
                    session_id,
                )

        # Tell the WS server to close any lingering socket for this session
        if self.ws_server:
            self.ws_server.notify_session_ended(session_id)

    # ── Internal: session reaping ──────────────────────────────────────────

    def _reap_old_sessions(self):
        """Remove sessions older than SESSION_TTL_S. Called before creating a new session."""
        now = time.monotonic()
        with self._lock:
            stale = [
                sid for sid, s in self._sessions.items()
                if (now - s.created_at) > SESSION_TTL_S
            ]
            for sid in stale:
                logger.debug("Reaping stale session %s", sid)
                del self._sessions[sid]


# ── Pure helper functions (no state) ──────────────────────────────────────

def _fsrs_rating(correct: bool, elapsed_s: float,
                 fast_s: float = _FAST_S, slow_s: float = _SLOW_S) -> int:
    """Map game performance to a py-fsrs Rating int (1–4)."""
    if not correct:
        return 1  # Again
    if elapsed_s < fast_s:
        return 4  # Easy
    if elapsed_s <= slow_s:
        return 3  # Good
    return 2      # Hard


def _compute_score(game_id: str, results: list[dict]) -> int:
    """Game-specific scoring formula."""
    if game_id == "battle_mcq":
        score = streak = 0
        for r in results:
            if r.get("skipped"):
                streak = 0
                continue
            if r.get("correct"):
                streak += 1
                score  += 10 * min(streak, 3)
            else:
                streak = 0
        return score

    if game_id == "word_scramble":
        score = 0
        for r in results:
            if r.get("skipped"):
                continue
            if r.get("correct"):
                score += 15
                if float(r.get("elapsed_s", 99)) < 5.0:
                    score += 5
            else:
                score -= 5
        return max(0, score)

    if game_id == "card_match":
        score = 0
        for r in results:
            if r.get("correct"):
                score += 20
                elapsed = float(r.get("elapsed_s", 99))
                if elapsed < 5.0:
                    score += 10
                elif elapsed < 10.0:
                    score += 5
        return score

    # Default (flash_memory, speed_typing, unity_slot):
    # 10 pts correct + speed bonus
    score = 0
    for r in results:
        if r.get("skipped"):
            continue
        if r.get("correct"):
            score += 10
            elapsed = float(r.get("elapsed_s", 99))
            if elapsed < 3.0:
                score += 5
            elif elapsed < 6.0:
                score += 2
    return score


def _resolve_config(schema: dict, user_config: dict) -> dict:
    """Apply defaults for missing keys; clamp ints to min/max; ignore unknown keys."""
    resolved = {}
    for key, spec in schema.items():
        val = user_config.get(key, spec["default"])
        if spec["type"] == "int":
            try:
                val = int(val)
                val = max(spec.get("min", val), min(spec.get("max", val), val))
            except (TypeError, ValueError):
                val = spec["default"]
        elif spec["type"] == "bool":
            val = bool(val)
        resolved[key] = val
    return resolved
