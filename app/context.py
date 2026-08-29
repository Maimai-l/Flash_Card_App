"""
AppContext: the one place the object graph is wired.

main.py, the HTTP layer and the tests all build the same graph through here,
so there is no second definition of how the app fits together.
"""

from __future__ import annotations

import logging

from paths import DB_PATH

from .db.connection import Database
from .db.card_repo import CardRepository
from .db.deck_repo import DeckRepository
from .db.quiz_repo import QuizRepository
from .db.settings_repo import SettingsRepository
from .services.fsrs_service import FsrsService
from .services.import_service import ImportService
from .services.quiz_service import QuizService
from .services.stats_service import StatsService
from .services.study_service import StudyService

logger = logging.getLogger(__name__)


class AppContext:
    def __init__(self, db_path=None):
        self.db_path = str(db_path or DB_PATH)
        self.database = Database(self.db_path)
        self.database.initialize()

        self.decks = DeckRepository(self.database)
        self.cards = CardRepository(self.database)
        self.quizzes = QuizRepository(self.database)
        self.settings = SettingsRepository(self.database)

        self.fsrs = FsrsService()
        self.study = StudyService(self.decks, self.cards, self.settings, self.fsrs)
        self.quiz = QuizService(self.quizzes)
        self.imports = ImportService(self.decks, self.cards, self.quizzes)
        self.stats = StatsService(self.decks, self.cards,
                          quizzes=self.quizzes, settings=self.settings, study=self.study)
