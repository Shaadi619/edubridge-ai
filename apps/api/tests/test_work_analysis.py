import base64

import pytest
from fastapi import HTTPException

from app.routers.work_analysis import WorkSubmissionRequest, _decode_work
from app.routers.voice import AudioTranscriptionRequest, _decode_audio


def test_decode_work_checks_file_signature() -> None:
    request = WorkSubmissionRequest(
        filename="reasoning.png", mime_type="image/png",
        data_base64=base64.b64encode(b"not-a-png").decode(), context="Check my reasoning",
    )

    with pytest.raises(HTTPException) as error:
        _decode_work(request)

    assert error.value.status_code == 400


def test_decode_work_accepts_valid_png_signature() -> None:
    content = b"\x89PNG\r\n\x1a\n" + b"image-bytes"
    request = WorkSubmissionRequest(
        filename="reasoning.png", mime_type="image/png",
        data_base64=base64.b64encode(content).decode(), context="Check my reasoning",
    )

    assert _decode_work(request) == content


def test_decode_audio_accepts_browser_webm_with_codec_parameter() -> None:
    content = b"\x1aE\xdf\xa3" + b"recorded-audio"
    request = AudioTranscriptionRequest(
        filename="teach-back.webm",
        mime_type="audio/webm;codecs=opus",
        data_base64=base64.b64encode(content).decode(),
    )

    decoded, mime_type = _decode_audio(request)

    assert decoded == content
    assert mime_type == "audio/webm"


def test_decode_audio_rejects_mismatched_signature() -> None:
    request = AudioTranscriptionRequest(
        filename="teach-back.mp3",
        mime_type="audio/mpeg",
        data_base64=base64.b64encode(b"not-an-mp3").decode(),
    )

    with pytest.raises(HTTPException) as error:
        _decode_audio(request)

    assert error.value.status_code == 400


# --- Show Your Work is opt-in per course -------------------------------------------

import asyncio as _asyncio
from unittest.mock import AsyncMock as _AsyncMock

import httpx as _httpx

from app.routers import work_analysis as _work_analysis


def _reply(status: int, data) -> _httpx.Response:
    return _httpx.Response(status, json=data, request=_httpx.Request("GET", "https://example.com"))


def test_show_work_is_off_unless_the_course_opts_in() -> None:
    client = _AsyncMock()
    for rows, expected in (([{"show_work_enabled": True}], True), ([{"show_work_enabled": False}], False), ([], False)):
        client.get.return_value = _reply(200, rows)
        assert _asyncio.run(_work_analysis._show_work_enabled(client, "https://example.com", {}, "course")) is expected


def test_show_work_is_off_before_the_migration_is_applied() -> None:
    client = _AsyncMock()
    client.get.return_value = _reply(400, {"message": "column courses.show_work_enabled does not exist"})
    assert _asyncio.run(_work_analysis._show_work_enabled(client, "https://example.com", {}, "course")) is False


def _analysis(step_sources, overall_sources, *, status="needs_revision", confidence=0.9):
    from app.ai.contracts import MisconceptionAnalysis, ShowWorkAnalysis, WorkStepFeedback
    return ShowWorkAnalysis(
        observed_work="2x + 3 = 7 so x = 5", summary="Check the subtraction step.", strengths=["Clear layout"],
        steps=[WorkStepFeedback(step_number=1, observed_reasoning="Added 3", status=status, feedback="Subtract 3 from both sides.", sources=step_sources)],
        sources=overall_sources,
        misconception=MisconceptionAnalysis(detected=True, concept="Inverse operations", confidence=confidence),
        grounded=True, next_step="Redo step 1.",
    )


def _evidence():
    from app.ai.contracts import EvidenceChunk
    return [EvidenceChunk(chunk_id="c1", document_id="d1", document_title="Algebra notes.pdf", page_number=4,
                          content="To undo addition,   subtract the same number from both sides of the equation.")]


def test_show_work_keeps_only_quotes_found_in_the_course_text() -> None:
    from app.ai.contracts import EvidenceQuote
    from app.routers.work_analysis import _friendly_analysis, _review_status

    real = EvidenceQuote(chunk_id="c1", quote="subtract the same number from both sides")
    friendly = _friendly_analysis(_analysis([real], []), _evidence())
    step = friendly["steps"][0]
    assert step["grounded"] is True
    assert step["citations"] == [{"document_title": "Algebra notes.pdf", "page_number": 4, "source_kind": "page",
                                  "chunk_id": "c1", "quote": "subtract the same number from both sides"}]
    assert friendly["grounded"] is True
    assert _review_status(friendly) == "pending"


def test_show_work_drops_invented_quotes_and_holds_back_the_teacher_flag() -> None:
    from app.ai.contracts import EvidenceQuote
    from app.routers.work_analysis import _friendly_analysis, _review_status

    invented = EvidenceQuote(chunk_id="c1", quote="always move numbers across and flip the sign")
    unknown = EvidenceQuote(chunk_id="nope", quote="subtract the same number from both sides")
    friendly = _friendly_analysis(_analysis([invented], [unknown]), _evidence())
    assert friendly["steps"][0]["citations"] == []
    assert friendly["steps"][0]["grounded"] is False
    assert friendly["grounded"] is False
    assert _review_status(friendly) == "not_required"


def test_show_work_correct_steps_do_not_need_a_quote() -> None:
    from app.routers.work_analysis import _friendly_analysis
    friendly = _friendly_analysis(_analysis([], [], status="correct"), _evidence())
    assert friendly["steps"][0]["grounded"] is True
