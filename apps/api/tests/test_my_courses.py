import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from app.routers import enrollments


def _reply(status: int, data) -> httpx.Response:
    return httpx.Response(status, json=data, request=httpx.Request("GET", "https://example.com"))


def _run(monkeypatch, course_replies: list[httpx.Response]) -> list[dict]:
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.get.side_effect = [
        _reply(200, [{"course_id": "course-1"}]),
        *course_replies,
        _reply(200, [{"id": "teacher-1", "display_name": "Shaadi Rashid"}]),
    ]
    monkeypatch.setattr(enrollments.httpx, "AsyncClient", lambda **_: client)
    monkeypatch.setattr(enrollments, "_client_config", lambda _: ("https://example.com", {}))
    return asyncio.run(enrollments.my_courses(SimpleNamespace(id="student"), SimpleNamespace()))


ROW = {"id": "course-1", "name": "Advanced AI", "subject": "AI", "enrollment_code": "COM-NF7E", "teacher_id": "teacher-1"}


def test_my_courses_includes_the_show_work_setting(monkeypatch) -> None:
    rows = _run(monkeypatch, [_reply(200, [{**ROW, "show_work_enabled": True}])])
    assert rows[0]["show_work_enabled"] is True
    assert rows[0]["teacher"] == "Shaadi Rashid"


def test_my_courses_still_loads_before_the_migration(monkeypatch) -> None:
    rows = _run(monkeypatch, [_reply(400, {"message": "column does not exist"}), _reply(200, [ROW])])
    assert rows[0]["show_work_enabled"] is False
    assert rows[0]["name"] == "Advanced AI"
