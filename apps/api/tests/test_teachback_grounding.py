import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.ai.contracts import EvidenceChunk, EvidenceQuote, TeachBackEvaluation
from app.routers import teachback


SOURCE = EvidenceChunk(
    chunk_id="chunk-1",
    document_id="document-1",
    document_title="Course notes.pdf",
    page_number=5,
    content="Photosynthesis produces oxygen.\n  The oxygen comes from water.",
)
VALID_QUOTE = EvidenceQuote(
    chunk_id=SOURCE.chunk_id, quote="Photosynthesis produces oxygen. The oxygen comes from water.",
)


def _response(data) -> httpx.Response:
    return httpx.Response(200, json=data, request=httpx.Request("GET", "https://example.com"))


def _submit(monkeypatch, endpoint, evaluation: TeachBackEvaluation, *, evidence=(SOURCE,)):
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.get.side_effect = [
        _response([{
            "completed_at": None, "misconception_id": "misconception-1",
            "question": "Where does oxygen released by photosynthesis come from?",
            "evidence": [item.model_dump() for item in evidence],
        }]),
        _response([{
            "concept": "Photosynthesis", "label": "Oxygen source",
            "explanation": "The student attributed the oxygen to carbon dioxide.",
            "learning_status": "open",
        }]),
        _response([{"teacher_id": "teacher", "name": "Science"}]),
    ]
    client.patch.return_value = _response([])
    model = AsyncMock(return_value=evaluation)
    mastery = AsyncMock()
    notification = AsyncMock()
    monkeypatch.setattr(teachback.httpx, "AsyncClient", lambda **_: client)
    monkeypatch.setattr(teachback, "_provider", lambda _: SimpleNamespace(generate_structured=model))
    monkeypatch.setattr(teachback, "record_teach_back_evidence", mastery)
    monkeypatch.setattr(teachback, "create_notification", notification)
    submit = endpoint(
        uuid4(), uuid4(), teachback.TeachBackSubmit(response="It is released when water is split."),
        SimpleNamespace(id="student"),
        SimpleNamespace(supabase_url="https://example.com", supabase_service_role_key="test"),
    )
    return submit, client, model, mastery, notification


@pytest.mark.parametrize("endpoint", [teachback.submit_teach_back, teachback.submit_retention_check])
@pytest.mark.parametrize(("grounded", "verdict", "sources"), [
    (False, "corrected", [VALID_QUOTE]),
    (False, "still_present", [VALID_QUOTE]),
    (True, "corrected", []),
    (True, "corrected", [EvidenceQuote(chunk_id=SOURCE.chunk_id, quote="A made-up quote.")]),
    (True, "corrected", [EvidenceQuote(chunk_id="unretrieved", quote=VALID_QUOTE.quote)]),
])
def test_unsupported_verdict_keeps_the_check_open(
    monkeypatch, endpoint, grounded, verdict, sources,
) -> None:
    evaluation = TeachBackEvaluation(
        grounded=grounded, verdict=verdict, feedback="Evaluator feedback", sources=sources,
    )
    submit, client, _, mastery, notification = _submit(monkeypatch, endpoint, evaluation)

    with pytest.raises(HTTPException) as error:
        asyncio.run(submit)

    assert error.value.status_code == 422
    assert "Your progress is unchanged" in error.value.detail
    client.patch.assert_not_awaited()
    mastery.assert_not_awaited()
    notification.assert_not_awaited()


@pytest.mark.parametrize("endpoint", [teachback.submit_teach_back, teachback.submit_retention_check])
def test_missing_evidence_skips_the_model(monkeypatch, endpoint) -> None:
    evaluation = TeachBackEvaluation(
        grounded=True, verdict="corrected", feedback="Evaluator feedback", sources=[VALID_QUOTE],
    )
    submit, client, model, _, _ = _submit(monkeypatch, endpoint, evaluation, evidence=())

    with pytest.raises(HTTPException) as error:
        asyncio.run(submit)

    assert error.value.status_code == 422
    model.assert_not_awaited()
    client.patch.assert_not_awaited()


@pytest.mark.parametrize(("endpoint", "retention_status"), [
    (teachback.submit_teach_back, "scheduled"),
    (teachback.submit_retention_check, "retained"),
])
def test_supported_verdict_updates_progress(monkeypatch, endpoint, retention_status) -> None:
    evaluation = TeachBackEvaluation(
        grounded=True, verdict="corrected", feedback="You explained where the oxygen comes from.",
        sources=[VALID_QUOTE],
    )
    submit, client, model, mastery, notification = _submit(monkeypatch, endpoint, evaluation)

    result = asyncio.run(submit)

    assert result.verdict == "corrected"
    assert result.citations[0].model_dump() == {
        "document_title": "Course notes.pdf", "page_number": 5, "source_kind": "page",
    }
    assert client.patch.await_count == 2
    update = client.patch.await_args.kwargs["json"]
    assert update["learning_status"] == "verified"
    assert update["retention_status"] == retention_status
    model.assert_awaited_once()
    mastery.assert_awaited_once()
    notification.assert_awaited_once()
