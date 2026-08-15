"""Key/value application settings."""

from __future__ import annotations

from .connection import Repository


class SettingsRepository(Repository):

    def all(self) -> dict:
        return {r["key"]: r["value"] for r in self._all("SELECT key, value FROM Settings")}

    def get(self, key: str, default=None):
        row = self._one("SELECT value FROM Settings WHERE key = ?", (key,))
        return row["value"] if row else default

    def get_int(self, key: str, default: int) -> int:
        try:
            return int(self.get(key, default))
        except (TypeError, ValueError):
            return default

    def set(self, key: str, value) -> None:
        self._exec(
            "INSERT INTO Settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )

    def set_many(self, values: dict) -> None:
        for key, value in values.items():
            self.set(key, value)
