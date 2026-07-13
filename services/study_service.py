"""
Study service: the FSRS-driven daily session — word selection, due counts,
today's stats, and the database overview. All SQL lives in the repositories;
this layer only composes their results with app_info preferences.
"""
import datetime


class StudyService:
    def __init__(self, word_repo, book_repo, app_service):
        self.word_repo = word_repo
        self.book_repo = book_repo
        self.app = app_service

    def get_session_words(self, book_name, new_limit: int = 20) -> list:
        return self.word_repo.get_session_words(book_name, new_limit)

    def get_due_words_for_refresh(self, book_name, exclude_words=None) -> list:
        return self.word_repo.get_due_for_refresh(book_name, exclude_words or [])

    def get_learned_words(self, book_name=None, limit: int = 20) -> list:
        return self.word_repo.get_learned_words(book_name, limit)

    def get_debug_words(self, book_name=None, limit: int = 20) -> list:
        return self.word_repo.get_random_words(book_name, limit)

    def get_today_stats(self, book_name=None) -> dict:
        info = self.app.get_app_info()
        new_limit = info.get("daily_new_limit", 20)
        new_available = min(self.word_repo.count_new_words(book_name), new_limit)
        review_due = self.word_repo.count_due_reviews(book_name)
        today = str(datetime.date.today())
        return {
            "new_count": new_available,
            "review_count": review_due,
            "total_due": new_available + review_due,
            "today_done": info.get("last_session_date") == today,
            "daily_new_limit": new_limit,
            "selected_book": info.get("selected_book"),
        }

    def get_db_stats(self) -> dict:
        return self.word_repo.get_overview_stats()

    def get_book_complete_percentage(self, book_name) -> dict:
        if book_name != "All":
            return self.book_repo.get_book_completion_stats(book_name)
        return self.book_repo.get_book_completion_stats()

    def get_book_names(self, details: bool = False):
        return self.book_repo.get_all_books(details)
