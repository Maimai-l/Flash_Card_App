import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture
def context(tmp_path, monkeypatch):
    """A fresh AppContext backed by a throwaway database."""
    monkeypatch.setenv("KC_USER_DATA", str(tmp_path))
    from app.context import AppContext
    return AppContext(db_path=tmp_path / "test.db")


@pytest.fixture
def api(context):
    from app.api import Api
    return Api(context)
