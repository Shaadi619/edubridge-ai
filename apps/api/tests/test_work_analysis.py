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
