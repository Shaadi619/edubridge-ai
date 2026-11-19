from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings

router = APIRouter(prefix="/courses/teacher/{course_id}/tutor-flags", tags=["tutor reviews"])


class Review(BaseModel):
    decision: Literal["confirmed", "dismissed"]


async def _rpc(settings: Settings, name: str, params: dict):
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            result = await client.post(f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/{name}",
                                       headers=headers, json=params)
            if result.status_code in (403, 404, 409):
                detail = {403: "Only the course teacher can review tutor observations.",
                          404: "This observation is no longer available.",
                          409: "This observation already has a different decision. Refresh the list."}
                code = result.status_code
                payload = result.json()
                if isinstance(payload, dict) and payload.get("code") == f"PT{code}":
                    raise HTTPException(code, detail[code])
            result.raise_for_status()
            return result.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(503, "Tutor reviews are unavailable. Please try again.") from error


@router.get("")
async def pending(course_id: UUID, user: AuthenticatedUser = Depends(current_user),
                  settings: Settings = Depends(get_settings)) -> list[dict]:
    return await _rpc(settings, "pending_tutor_flags", {"p_course": str(course_id), "p_teacher": user.id})


@router.patch("/{message_id}/review")
async def review(course_id: UUID, message_id: UUID, request: Review,
                 user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> dict:
    decision = await _rpc(settings, "review_tutor_flag", {
        "p_course": str(course_id), "p_teacher": user.id, "p_message": str(message_id), "p_decision": request.decision,
    })
    return {"decision": decision}
