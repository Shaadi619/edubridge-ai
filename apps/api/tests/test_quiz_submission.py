import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.routers import quizzes


@pytest.fixture
def submission(monkeypatch):
    client = AsyncMock()
    client.__aenter__.return_value = client
    monkeypatch.setattr(quizzes.httpx, "AsyncClient", lambda **_: client)
    course_id, quiz_id, student_id = uuid4(), uuid4(), uuid4()
    settings = SimpleNamespace(supabase_service_role_key="test", supabase_url="https://example.com")
    user = SimpleNamespace(id=str(student_id))
    request = quizzes.SubmitQuizRequest(answers=[0, None], confidences=[3, None])

    def submit():
        return asyncio.run(quizzes.submit_quiz(course_id, quiz_id, request, user, settings))

    return client, submit, {
        "p_course_id": str(course_id),
        "p_quiz_id": str(quiz_id),
        "p_student_id": str(student_id),
        "p_answers": [0, None],
        "p_confidences": [3, None],
    }


def test_submit_returns_database_result_with_one_request(submission) -> None:
    client, submit, payload = submission
    result = {
        "attempt_id": str(uuid4()), "score": 50, "correct": 1, "total": 2,
        "assignment_completed": True, "confidence_gaps": 0,
    }
    client.post.return_value = httpx.Response(200, json=result)

    assert submit() == result
    client.post.assert_awaited_once_with(
        "https://example.com/rest/v1/rpc/submit_quiz_once",
        headers={"apikey": "test", "Authorization": "Bearer test"},
        json=payload,
    )
    client.get.assert_not_awaited()
    client.patch.assert_not_awaited()


@pytest.mark.parametrize(("code", "expected_status"), [
    ("PT400", 400), ("PT403", 403), ("PT404", 404), ("PGRST202", 503),
])
def test_submission_maps_database_errors(submission, code, expected_status) -> None:
    client, submit, _ = submission
    client.post.return_value = httpx.Response(400, json={"code": code, "message": "Database message"})

    with pytest.raises(HTTPException) as error:
        submit()

    assert error.value.status_code == expected_status
    assert ("Database message" in error.value.detail) == (expected_status < 500)


def test_indeterminate_network_failure_can_be_retried(submission) -> None:
    client, submit, _ = submission
    client.post.side_effect = httpx.ReadTimeout("timeout")

    with pytest.raises(HTTPException) as error:
        submit()

    assert error.value.status_code == 503
    assert "could not be confirmed" in error.value.detail
