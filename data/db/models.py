from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Word:
    word_id: int = 0
    vocab: str = ""
    definition_zh: str = ""   # Chinese definition/meaning
    example_en: str = ""      # English example sentence
    example_zh: str = ""      # Chinese translation of example
    phone_us: str = ""        # US IPA pronunciation
    phone_uk: str = ""        # UK IPA pronunciation
    stability: float = 0.0
    difficulty: float = 0.0
    due_date: Optional[str] = None
    last_review: Optional[str] = None
    fsrs_state: int = 0
    fsrs_step: int = 0
    created_time: Optional[str] = None
    updated_time: Optional[str] = None


@dataclass
class WordBook:
    book_id: int = 0
    book_name: str = ""
    created_time: Optional[str] = None
    updated_time: Optional[str] = None
