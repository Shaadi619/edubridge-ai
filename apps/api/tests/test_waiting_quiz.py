import asyncio
from unittest.mock import AsyncMock, MagicMock

import httpx

from app.routers import quizzes


def _response(status: int, payload) -> httpx.Response:
    return httpx.Response(status, json=payload, request=httpx.Request("POST", "https://example.com"))


def test_stored_quiz_keeps_its_citations_and_quotes() -> None:
    quiz = quizzes._generated_quiz(
        {"id": "q1", "title": "SVM practice", "difficulty_mode": "hard", "focus_concept": None, "prerequisite_concepts": []},
        [{
            "id": "a", "position": 0, "prompt": "Why maximise the margin?", "options": ["A", "B", "C", "D"],
            "correct_option": 2, "explanation": "Wider gaps generalise better.", "concept": "Margin", "difficulty": 3,
            "citations": [{"chunk_id": "c7", "document_title": "Lecture_07.pdf", "page_number": 4, "source_kind": "page",
                           "quote": "The SVM picks the line with the widest gap"}],
        }],
    )
    assert quiz.difficulty_mode == "hard"
    assert quiz.questions[0].citations[0].quote == "The SVM picks the line with the widest gap"


def test_unknown_difficulty_falls_back_to_adaptive() -> None:
    quiz = quizzes._generated_quiz({"id": "q1", "title": "Quiz", "difficulty_mode": None}, [])
    assert quiz.difficulty_mode == "adaptive"


def test_only_one_waiting_quiz_can_be_reserved() -> None:
    client = MagicMock()
    client.post = AsyncMock(return_value=_response(201, [{"id": "slot"}]))
    assert asyncio.run(quizzes._claim_waiting_slot(client, "https://example.com", {}, "course", "student")) == "slot"
    # The unique index rejects a second reservation for the same student and course.
    client.post = AsyncMock(return_value=_response(409, {"code": "23505"}))
    assert asyncio.run(quizzes._claim_waiting_slot(client, "https://example.com", {}, "course", "student")) is None
