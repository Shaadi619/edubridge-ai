import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.ai.contracts import (
    EvidenceChunk, EvidenceQuote, GroundedExplanationSection, MisconceptionAnalysis, TutorDraft,
)
from app.routers import tutor


QUESTION = "I think the oxygen comes from carbon dioxide"
SOURCE = EvidenceChunk(
    chunk_id="water", document_id="notes", document_title="Week 2 slides.pptx", page_number=4,
    content="In photosynthesis, oxygen released\n comes from water.",
)
QUOTE = EvidenceQuote(
    chunk_id=SOURCE.chunk_id, quote="In photosynthesis, oxygen released comes from water.",
)


def _match(chunk: EvidenceChunk = SOURCE, *, similarity: float = 0.60) -> dict:
    return {
        "chunk_id": chunk.chunk_id, "material_id": chunk.document_id,
        "material_title": chunk.document_title, "page_number": chunk.page_number,
        "content": chunk.content, "similarity": similarity,
    }


def _draft(**updates) -> TutorDraft:
    return TutorDraft(
        grounded=True,
        sections=[GroundedExplanationSection(text="The oxygen comes from water.", sources=[QUOTE])],
        misconception=MisconceptionAnalysis(
            detected=True, confidence=0.92, concept="Photosynthesis", label="Source of oxygen",
            explanation="The source is water.", evidence_from_student="oxygen comes from carbon dioxide",
        ),
        misconception_sources=[QUOTE],
    ).model_copy(update=updates)


def test_select_evidence_filters_low_non_finite_and_duplicate_matches() -> None:
    duplicate = SOURCE.model_copy(update={"chunk_id": "duplicated", "content": QUOTE.quote})
    unique = [
        SOURCE.model_copy(update={"chunk_id": f"id-{index}", "content": f"Unique excerpt {index}"})
        for index in range(5)
    ]
    matches = [
        _match(similarity=float("nan")), _match(similarity=0.29), _match(similarity=0.30),
        _match(duplicate),
        *(_match(chunk) for chunk in unique),
    ]

    assert [chunk.chunk_id for chunk in tutor._select_evidence(matches, 0.30)] == [
        "water", "id-0", "id-1", "id-2",
    ]


def test_same_slide_citations_keep_each_verified_excerpt_clickable() -> None:
    second = SOURCE.model_copy(update={"chunk_id": "second", "content": "Another passage."})
    draft = _draft(sections=[
        GroundedExplanationSection(text="First explanation.", sources=[QUOTE]),
        GroundedExplanationSection(
            text="Second explanation.",
            sources=[EvidenceQuote(chunk_id=second.chunk_id, quote=second.content)],
        ),
    ])

    answer = tutor._validated_tutor_answer(draft, QUESTION, [SOURCE, second])

    assert answer.grounded
    assert len(answer.citations) == 2
    assert all(citation.source_kind == "slide" for citation in answer.citations)


@pytest.mark.parametrize(("student_quote", "course_quote"), [
    ("the oxygen comes from space", QUOTE),
    ("...", QUOTE),
    ("oxygen comes from carbon dioxide", EvidenceQuote(chunk_id="water", quote="Made-up support")),
])
def test_grounded_answer_can_exclude_an_unsupported_misconception(student_quote, course_quote) -> None:
    draft = _draft(misconception_sources=[course_quote])
    draft.misconception.evidence_from_student = student_quote

    answer = tutor._validated_tutor_answer(draft, QUESTION, [SOURCE])

    assert answer.grounded
    assert not answer.misconception.detected


@pytest.fixture
def route(monkeypatch):
    def arrange(matches: list[dict], draft: TutorDraft):
        client = AsyncMock()
        client.__aenter__.return_value = client
        model = AsyncMock(return_value=draft)
        embed = AsyncMock(return_value=SimpleNamespace(data=[SimpleNamespace(embedding=[0.1])]))
        persist = AsyncMock()

        async def reply(url, **kwargs):
            data = matches if url.endswith("/rpc/match_course_material_chunks") else [{"id": "saved"}]
            return httpx.Response(200, json=data, request=httpx.Request("POST", url))

        client.post.side_effect = reply
        monkeypatch.setattr(tutor.httpx, "AsyncClient", lambda **_: client)
        monkeypatch.setattr(tutor, "embedding_client", lambda _: (SimpleNamespace(
            embeddings=SimpleNamespace(create=embed),
        ), "test"))
        monkeypatch.setattr(tutor, "_course_access", AsyncMock(return_value=True))
        monkeypatch.setattr(tutor, "AzureOpenAIProvider", lambda **_: SimpleNamespace(generate_structured=model))
        monkeypatch.setattr(tutor, "_persist_misconception", persist)
        settings = SimpleNamespace(
            supabase_service_role_key="test", supabase_url="https://example.com",
            azure_openai_endpoint="https://example.com", azure_openai_api_key="test",
            azure_openai_api_version="test", azure_openai_tier1_deployment="fast",
            azure_openai_tier2_deployment="reasoning", tutor_min_similarity=0.30,
        )
        return SimpleNamespace(
            client=client, model=model, embed=embed, persist=persist, settings=settings,
            user=SimpleNamespace(id="student"), course_id=uuid4(),
        )

    return arrange


@pytest.mark.parametrize(("matches", "reason"), [
    ([], tutor.NO_INDEXED_EVIDENCE),
    ([_match(similarity=0.20)], tutor.INSUFFICIENT_EVIDENCE),
])
def test_weak_retrieval_skips_answer_generation(route, matches, reason) -> None:
    case = route(matches, _draft())
    response = asyncio.run(tutor.tutor(
        case.course_id, tutor.TutorQuery(question=QUESTION), case.user, case.settings,
    ))

    assert response.answer.answer == reason
    assert not response.answer.grounded
    case.model.assert_not_awaited()
    case.persist.assert_not_awaited()
    saved = case.client.post.await_args.kwargs["json"]
    assert saved["content"] == reason
    assert saved["model_tier"] is None


def test_unsupported_section_replaces_whole_draft_before_saving(route) -> None:
    draft = _draft()
    draft.sections.append(GroundedExplanationSection(
        text="An unsupported statement.",
        sources=[EvidenceQuote(chunk_id=SOURCE.chunk_id, quote="A fabricated quote.")],
    ))
    case = route([_match()], draft)

    response = asyncio.run(tutor.tutor(
        case.course_id, tutor.TutorQuery(question=QUESTION), case.user, case.settings,
    ))

    assert response.answer.answer == tutor.INSUFFICIENT_EVIDENCE
    assert response.answer.citations == []
    assert not response.answer.misconception.detected
    assert case.client.post.await_args.kwargs["json"]["content"] == tutor.INSUFFICIENT_EVIDENCE
    case.persist.assert_not_awaited()


def test_grounded_response_keeps_real_citation_and_misconception(route) -> None:
    weak = SOURCE.model_copy(update={"chunk_id": "weak", "content": "Weak passage"})
    case = route([_match(), _match(weak, similarity=0.21)], _draft())
    response = asyncio.run(tutor.tutor(
        case.course_id, tutor.TutorQuery(question=QUESTION), case.user, case.settings,
    ))

    assert response.answer.grounded
    assert response.answer.citations[0].chunk_id == SOURCE.chunk_id
    assert response.answer.misconception.detected
    prompt = json.loads(case.model.await_args.kwargs["user_prompt"])
    assert [item["chunk_id"] for item in prompt["course_evidence"]] == [SOURCE.chunk_id]
    case.persist.assert_awaited_once()


def test_conversation_must_belong_to_user_and_course_before_paid_calls(route) -> None:
    case = route([_match()], _draft())
    case.client.get.return_value = httpx.Response(
        200, json=[], request=httpx.Request("GET", "https://example.com"),
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(tutor.tutor(
            case.course_id, tutor.TutorQuery(question=QUESTION, conversation_id=uuid4()),
            case.user, case.settings,
        ))

    assert error.value.status_code == 404
    case.embed.assert_not_awaited()
    case.model.assert_not_awaited()
    case.client.post.assert_not_awaited()


@pytest.mark.parametrize(("similarity", "quote", "grounded", "model_calls"), [
    (0.20, QUOTE, False, 0),
    (0.60, EvidenceQuote(chunk_id="unknown", quote=QUOTE.quote), False, 1),
    (0.60, QUOTE, True, 1),
])
def test_alternate_explanation_applies_same_checks(route, similarity, quote, grounded, model_calls) -> None:
    draft = _draft(sections=[GroundedExplanationSection(text="Simple explanation", sources=[quote])])
    case = route([_match(similarity=similarity)], draft)
    response = asyncio.run(tutor.alternative_explanation(
        case.course_id, tutor.AlternativeExplanationRequest(question=QUESTION, format="simpler"),
        case.user, case.settings,
    ))

    assert response.grounded is grounded
    assert response.answer == ("Simple explanation" if grounded else tutor.INSUFFICIENT_EVIDENCE)
    assert bool(response.citations) is grounded
    assert case.model.await_count == model_calls
