import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.ai.contracts import (
    Citation,
    EvidenceChunk,
    EvidenceQuote,
    QuizItemVerification,
    QuizQuestion,
    QuizResult,
    QuizVerificationResult,
)
from app.ai.quiz_verification import QuizVerificationError, generate_verified_quiz, shuffle_verified_quiz
from app.routers import quizzes


SOURCE = EvidenceChunk(
    chunk_id="source-1",
    document_id="document-1",
    document_title="Plant biology.pdf",
    page_number=7,
    content="Plants release oxygen\n during photosynthesis.",
)


def draft_question(prompt: str, **updates) -> QuizQuestion:
    return QuizQuestion(
        prompt=prompt,
        options=["Oxygen", "Nitrogen", "Argon", "Hydrogen"],
        correct_option=0,
        explanation="Draft explanation",
        concept="Photosynthesis",
        difficulty=2,
        citations=[Citation(
            chunk_id=SOURCE.chunk_id, document_id="untrusted-id", document_title="Untrusted title",
        )],
    ).model_copy(update=updates)


def verified_item(index: int = 0, **updates) -> QuizItemVerification:
    return QuizItemVerification(
        question_index=index,
        supported_option_indices=[0],
        explanation="Photosynthesis releases oxygen.",
        sources=[EvidenceQuote(
            chunk_id=SOURCE.chunk_id, quote="Plants release oxygen during photosynthesis.",
        )],
    ).model_copy(update=updates)


def generate(provider, count: int = 1) -> QuizResult:
    return asyncio.run(generate_verified_quiz(
        provider, [SOURCE],
        question_count=count,
        difficulty_mode="adaptive",
        difficulty_instruction="Use difficulty 2–4.",
        focus_concept="Photosynthesis",
        prerequisite_concepts=["Plant cells"],
        priority_concepts=["Photosynthesis"],
    ))


def test_verifier_only_sees_stem_options_and_evidence() -> None:
    provider = SimpleNamespace(generate_structured=AsyncMock(side_effect=[
        QuizResult(title="Plant quiz", questions=[draft_question("Which gas is released?")]),
        QuizVerificationResult(questions=[verified_item()]),
    ]))

    result = generate(provider)

    assert provider.generate_structured.await_count == 2
    payload = json.loads(provider.generate_structured.await_args.kwargs["user_prompt"])
    assert set(payload["questions"][0]) == {"question_index", "prompt", "options"}
    question = result.questions[0]
    assert question.explanation == "Photosynthesis releases oxygen."
    assert question.citations[0].document_title == SOURCE.document_title
    assert question.citations[0].page_number == 7


def test_refill_preserves_verified_items_and_original_positions() -> None:
    provider = SimpleNamespace(generate_structured=AsyncMock(side_effect=[
        QuizResult(title="Plant quiz", questions=[
            draft_question("Incorrect draft key?", correct_option=1),
            draft_question("Question already verified?"),
        ]),
        QuizVerificationResult(questions=[verified_item(1), verified_item(0)]),
        QuizResult(title="Refill", questions=[draft_question("Replacement for the first item?")]),
        QuizVerificationResult(questions=[verified_item(0)]),
    ]))

    result = generate(provider, count=2)

    assert result.title == "Plant quiz"
    assert [question.prompt for question in result.questions] == [
        "Replacement for the first item?", "Question already verified?",
    ]
    refill_request = json.loads(provider.generate_structured.await_args_list[2].kwargs["user_prompt"])
    assert refill_request["question_count"] == 1
    assert refill_request["question_positions"] == [1]
    assert refill_request["accepted_question_prompts"] == ["Question already verified?"]


@pytest.mark.parametrize("updates", [
    {"correct_option": 4},
    {"correct_option": -1},
    {"options": ["Oxygen", "  OXYGEN ", "Argon", "Hydrogen"]},
    {"options": ["Oxygen", "  ", "Argon", "Hydrogen"]},
    {"options": ["Oxygen", "Nitrogen", "Argon"]},
    {"citations": []},
])
def test_invalid_drafts_never_reach_verifier(updates: dict) -> None:
    response = QuizResult(title="Invalid", questions=[draft_question("Question?", **updates)])
    provider = SimpleNamespace(generate_structured=AsyncMock(return_value=response))

    with pytest.raises(QuizVerificationError):
        generate(provider)

    assert [call.kwargs["output_type"] for call in provider.generate_structured.await_args_list] == [
        QuizResult, QuizResult,
    ]


def test_short_quiz_only_contains_verified_items_after_refill() -> None:
    draft = QuizResult(title="Plant quiz", questions=[
        draft_question(f"Question {index}?") for index in range(4)
    ])
    provider = SimpleNamespace(generate_structured=AsyncMock(side_effect=[
        draft,
        QuizVerificationResult(questions=[verified_item(index) for index in (0, 2, 3)]),
        QuizResult(title="Refill", questions=[draft_question("Replacement?")]),
        QuizVerificationResult(questions=[verified_item(1, supported_option_indices=[1])]),
    ]))

    assert [question.prompt for question in generate(provider, count=4).questions] == [
        "Question 0?", "Question 2?", "Question 3?",
    ]


@pytest.mark.parametrize("verdicts", [
    [],
    [verified_item(1)],
    [verified_item(), verified_item()],
    [verified_item(supported_option_indices=[0, 1])],
    [verified_item(supported_option_indices=[])],
    [verified_item(explanation=" ")],
    [verified_item(sources=[EvidenceQuote(chunk_id=SOURCE.chunk_id, quote="Invented quote")])],
    [verified_item(sources=[EvidenceQuote(chunk_id="unknown", quote=SOURCE.content)])],
])
def test_unverified_answers_fail_after_one_refill(verdicts: list[QuizItemVerification]) -> None:
    draft = QuizResult(title="Plant quiz", questions=[draft_question("Which gas is released?")])
    verdict = QuizVerificationResult(questions=verdicts)
    provider = SimpleNamespace(generate_structured=AsyncMock(side_effect=[draft, verdict, draft, verdict]))

    with pytest.raises(QuizVerificationError, match="could not be verified"):
        generate(provider)

    assert provider.generate_structured.await_count == 4


@pytest.mark.parametrize("verification_fails", [True, False])
def test_quiz_endpoint_only_stores_verified_options_with_matching_key(monkeypatch, verification_fails) -> None:
    def response(payload):
        return httpx.Response(200, json=payload, request=httpx.Request("GET", "https://example.com"))

    client = AsyncMock()
    client.__aenter__.return_value = client
    client.get.return_value = response([])
    async def post(url, *, headers, json):
        if url.endswith("/rpc/match_course_material_chunks"):
            return response([{
                "chunk_id": SOURCE.chunk_id, "material_id": SOURCE.document_id,
                "material_title": SOURCE.document_title, "page_number": SOURCE.page_number,
                "content": SOURCE.content,
            }])
        if url.endswith("/quizzes"):
            return response([{"id": "quiz"}])
        assert url.endswith("/quiz_questions")
        return response([{"id": str(row["position"]), "position": row["position"]} for row in reversed(json)])
    client.post.side_effect = post
    embedding = SimpleNamespace(embeddings=SimpleNamespace(create=AsyncMock(
        return_value=SimpleNamespace(data=[SimpleNamespace(embedding=[0.1])]),
    )))
    settings = SimpleNamespace(
        supabase_url="https://example.com", supabase_service_role_key="test",
        azure_openai_endpoint="https://example.com", azure_openai_api_key="test",
        azure_openai_api_version="test", azure_openai_tier1_deployment="test",
        azure_openai_tier2_deployment="test",
    )
    monkeypatch.setattr(quizzes.httpx, "AsyncClient", lambda **_: client)
    monkeypatch.setattr(quizzes, "embedding_client", lambda _: (embedding, "test"))
    monkeypatch.setattr(quizzes, "_course_access", AsyncMock(return_value=True))
    monkeypatch.setattr(quizzes, "AzureOpenAIProvider", lambda **_: object())
    verified = QuizResult(title="Verified", questions=[
        draft_question(f"Question {index}?", explanation="Oxygen is released, which matches option 0.")
        for index in range(4)
    ])
    if verification_fails:
        monkeypatch.setattr(quizzes, "generate_verified_quiz", AsyncMock(
            side_effect=QuizVerificationError("Quiz verification failed."),
        ))
        with pytest.raises(HTTPException) as exc:
            asyncio.run(quizzes.generate_quiz(uuid4(), quizzes.GenerateQuizRequest(), SimpleNamespace(id="student"), settings))
        assert exc.value.status_code == 502
        assert client.post.await_count == 1
        assert client.post.await_args.args[0].endswith("/rpc/match_course_material_chunks")
        return
    monkeypatch.setattr(quizzes, "generate_verified_quiz", AsyncMock(return_value=verified))
    quiz = asyncio.run(quizzes.generate_quiz(uuid4(), quizzes.GenerateQuizRequest(), SimpleNamespace(id="student"), settings))
    stored = client.post.await_args.kwargs["json"]
    assert len({question.correct_option for question in quiz.questions}) > 1
    for index, (question, row) in enumerate(zip(quiz.questions, stored, strict=True)):
        assert question.id == str(index)
        assert question.options == row["options"]
        assert question.correct_option == row["correct_option"]
        assert question.options[question.correct_option] == "Oxygen"
        assert question.explanation == row["explanation"] == "Oxygen is released."


def test_shuffle_keeps_correct_text_and_citations_when_original_key_varies() -> None:
    originals = [
        draft_question(f"Question {index}?", correct_option=index % 4,
                       explanation="Option 1 is correct because the source supports it.")
        for index in range(8)
    ]
    result = shuffle_verified_quiz(QuizResult(title="Verified", questions=originals))
    destinations = [item.correct_option for item in result.questions]
    assert max(destinations.count(index) for index in range(4)) <= 4
    for original, shuffled in zip(originals, result.questions, strict=True):
        correct = original.options[original.correct_option]
        assert sorted(shuffled.options) == sorted(original.options)
        assert shuffled.options[shuffled.correct_option] == correct
        assert correct in shuffled.explanation and "Option 1" not in shuffled.explanation
        assert shuffled.citations == original.citations
