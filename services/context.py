"""
AppContext: the single wiring point for the backend.

Seeds user data, runs DB migrations, constructs the repositories, then the
services on top of them. main.py, the dev bridge, and the tests all build the
same object graph through here — no circular wiring, no god object.
"""
import logging

from paths import data_path, ensure_parent_dir, ensure_user_data_seeded

from db.connection import DatabaseConnection
from db.word_repo import WordRepository
from db.book_repo import BookRepository

from services.app_service import AppService
from services.study_service import StudyService
from services.import_service import ImportService
from services.fsrs_service import FsrsService
from services.update_service import UpdateService

logger = logging.getLogger(__name__)


class AppContext:
    def __init__(self):
        ensure_user_data_seeded()

        self.database_dir = data_path("database")
        self.db_path = str(self.database_dir / "vocabulary.db")
        ensure_parent_dir(self.database_dir / "dummy")

        self.db_conn = DatabaseConnection(self.db_path)
        self.db_conn.initialize_database()

        # Repositories (own all SQL)
        self.word_repo = WordRepository(self.db_path)
        self.book_repo = BookRepository(self.db_path)

        # Services (business logic)
        self.app = AppService(self.db_conn, self.word_repo, self.database_dir)
        self.study = StudyService(self.word_repo, self.book_repo, self.app)
        self.imports = ImportService(self.word_repo, self.book_repo)
        self.fsrs = FsrsService(self.word_repo)
        self.updates = UpdateService()
