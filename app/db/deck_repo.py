"""
Deck storage.

Decks form a tree addressed by a `::`-separated path ("Mathematics::Linear
Algebra"). The path is stored on every row, so "this deck and everything under
it" is a single LIKE query rather than a recursive walk.

Daily limits are read from the *root* of a deck's branch: a subject sets the
budget once and every chapter under it draws from the same pool.
"""

from __future__ import annotations

from .connection import Repository

SEP = "::"


def split_path(path: str) -> list[str]:
    return [p.strip() for p in str(path or "").split(SEP) if p.strip()]


def normalise_path(path: str) -> str:
    return SEP.join(split_path(path))


def root_of(path: str) -> str:
    parts = split_path(path)
    return parts[0] if parts else ""


class DeckRepository(Repository):

    # ── Reads ─────────────────────────────────────────────────────────────

    def all_decks(self) -> list[dict]:
        return self._all("SELECT * FROM Deck ORDER BY path")

    def by_path(self, path: str) -> dict | None:
        return self._one("SELECT * FROM Deck WHERE path = ?", (normalise_path(path),))

    def by_id(self, deck_id: int) -> dict | None:
        return self._one("SELECT * FROM Deck WHERE deck_id = ?", (int(deck_id),))

    def descendant_ids(self, path: str) -> list[int]:
        """Deck ids of `path` and every deck beneath it. Empty path means all decks."""
        path = normalise_path(path)
        if not path:
            return [r["deck_id"] for r in self._all("SELECT deck_id FROM Deck")]
        rows = self._all(
            "SELECT deck_id FROM Deck WHERE path = ? OR path LIKE ?",
            (path, path + SEP + "%"),
        )
        return [r["deck_id"] for r in rows]

    def limits_for(self, path: str) -> tuple[int | None, int | None]:
        """The (new, review) limits set on the root of this deck's branch."""
        root = self.by_path(root_of(path))
        if not root:
            return (None, None)
        return (root["new_limit"], root["review_limit"])

    # ── Writes ────────────────────────────────────────────────────────────

    def ensure_path(self, path: str) -> int:
        """Create every missing level of `path` and return the leaf deck id."""
        parts = split_path(path)
        if not parts:
            raise ValueError("Deck path cannot be empty")
        parent_id, accumulated = None, []
        conn = self.db.connect()
        try:
            for part in parts:
                accumulated.append(part)
                full = SEP.join(accumulated)
                row = conn.execute("SELECT deck_id FROM Deck WHERE path = ?", (full,)).fetchone()
                if row:
                    parent_id = row["deck_id"]
                    continue
                cur = conn.execute(
                    "INSERT INTO Deck (name, path, parent_id) VALUES (?, ?, ?)",
                    (part, full, parent_id),
                )
                parent_id = cur.lastrowid
            conn.commit()
        finally:
            conn.close()
        return int(parent_id)

    def set_limits(self, path: str, new_limit, review_limit) -> None:
        self._exec(
            "UPDATE Deck SET new_limit = ?, review_limit = ? WHERE path = ?",
            (new_limit, review_limit, normalise_path(path)),
        )

    def rename(self, path: str, new_name: str) -> None:
        """Rename a deck in place, rewriting the stored paths of its subtree."""
        path = normalise_path(path)
        deck = self.by_path(path)
        if not deck:
            raise ValueError(f"Deck not found: {path}")
        new_name = new_name.replace(SEP, " ").strip()
        if not new_name:
            raise ValueError("Deck name cannot be empty")
        parts = split_path(path)
        new_path = SEP.join(parts[:-1] + [new_name])
        if new_path != path and self.by_path(new_path):
            raise ValueError(f"A deck named '{new_path}' already exists")
        conn = self.db.connect()
        try:
            conn.execute(
                "UPDATE Deck SET name = ?, path = ? WHERE deck_id = ?",
                (new_name, new_path, deck["deck_id"]),
            )
            conn.execute(
                "UPDATE Deck SET path = ? || substr(path, ?) WHERE path LIKE ?",
                (new_path, len(path) + 1, path + SEP + "%"),
            )
            conn.commit()
        finally:
            conn.close()

    def delete(self, path: str) -> None:
        """Delete a deck, its subtree, and every card in it."""
        self._exec("DELETE FROM Deck WHERE path = ? OR path LIKE ?",
                   (normalise_path(path), normalise_path(path) + SEP + "%"))

    def delete_empty(self, path: str) -> None:
        """Drop a deck only if neither it nor its subtree holds any card."""
        ids = self.descendant_ids(path)
        if not ids:
            return
        placeholders = ",".join("?" * len(ids))
        n = self._scalar(
            f"SELECT COUNT(*) FROM Card WHERE deck_id IN ({placeholders})", tuple(ids)
        )
        if n == 0:
            self.delete(path)
