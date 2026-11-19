from uuid import uuid4
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.main import app
from app.routers import tutor_reviews


def test_review_routes_take_teacher_identity_from_login(monkeypatch):
    course, teacher, message = map(str, (uuid4(), uuid4(), uuid4()))
    rpc = AsyncMock(side_effect=[[], "confirmed"])
    monkeypatch.setattr(tutor_reviews, "_rpc", rpc)
    client = TestClient(app)
    monkeypatch.setitem(app.dependency_overrides, get_settings, lambda: Settings(supabase_url="https://fixture.test"))
    path = f"/api/v1/courses/teacher/{course}/tutor-flags"
    assert client.get(path).status_code in (401, 403)
    monkeypatch.setitem(app.dependency_overrides, current_user, lambda: AuthenticatedUser(teacher, None, "authenticated"))
    assert client.get(path).json() == []
    result = client.patch(f"{path}/{message}/review", json={"decision": "confirmed", "p_teacher": "ignored"})
    assert result.json() == {"decision": "confirmed"}
    assert rpc.await_args.args[2] == {"p_course": course, "p_teacher": teacher, "p_message": message, "p_decision": "confirmed"}
    assert client.patch(f"{path}/{message}/review", json={"decision": "other"}).status_code == 422
    assert rpc.await_count == 2
