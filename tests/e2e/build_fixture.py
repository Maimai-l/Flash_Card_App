"""Build a small v9 fixture DB at the path given as argv[1]/data/database/vocabulary.db."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from conftest import build_fixture_db  # noqa: E402


def main(target: str):
    ud = Path(target)
    (ud / "data" / "database").mkdir(parents=True, exist_ok=True)
    build_fixture_db(ud / "data" / "database" / "vocabulary.db")
    (ud / "seed_version").write_text("1")
    print(f"fixture built at {ud}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/fc_e2e")
