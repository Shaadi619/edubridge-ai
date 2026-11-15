from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.routers.notifications import create_notifications
from app.routers.tutor import _course_access

router = APIRouter(prefix="/courses", tags=["announcements"])


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=5000)
    pinned: bool = False


def _config(settings: Settings) -> tuple[str, dict[str, str]]:
    key = settings.supabase_service_role_key
    return settings.supabase_url.rstrip("/"), {
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation",
    }


@router.get("/{course_id}/announcements")
async def list_announcements(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> list[dict]:
    base, headers = _config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        if not await _course_access(client, base, headers, str(course_id), user.id):
            raise HTTPException(status_code=403, detail="You are not a member of this course")
        response = await client.get(
            f"{base}/rest/v1/course_announcements", headers=headers,
            params={"course_id": f"eq.{course_id}", "select": "id,title,body,pinned,created_at", "order": "pinned.desc,created_at.desc"},
        )
        response.raise_for_status()
        return response.json()


@router.post("/{course_id}/announcements", status_code=status.HTTP_201_CREATED)
async def create_announcement(
    course_id: UUID,
    request: AnnouncementCreate,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    base, headers = _config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        course = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"eq.{course_id}", "teacher_id": f"eq.{user.id}", "select": "id,name"},
        )
        course.raise_for_status()
        if not course.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can post announcements")
        response = await client.post(
            f"{base}/rest/v1/course_announcements", headers=headers,
            json={"course_id": str(course_id), "author_id": user.id, "title": request.title.strip(), "body": request.body.strip(), "pinned": request.pinned},
        )
        response.raise_for_status()
        announcement = response.json()[0]
        enrollments = await client.get(
            f"{base}/rest/v1/enrollments", headers=headers,
            params={"course_id": f"eq.{course_id}", "status": "eq.approved", "select": "student_id"},
        )
        enrollments.raise_for_status()
        announcement_preview = request.body.strip()
        if len(announcement_preview) > 220:
            announcement_preview = f"{announcement_preview[:217]}…"
        await create_notifications(
            client, base, headers,
            recipient_ids=[row["student_id"] for row in enrollments.json()], course_id=str(course_id),
            notification_type="announcement", title=request.title.strip(),
            body=f"New announcement in {course.json()[0]['name']}: {announcement_preview}",
            metadata={"announcement_id": announcement["id"]},
        )
        return announcement


@router.delete("/{course_id}/announcements/{announcement_id}")
async def delete_announcement(
    course_id: UUID,
    announcement_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    base, headers = _config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        course = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"eq.{course_id}", "teacher_id": f"eq.{user.id}", "select": "id"},
        )
        course.raise_for_status()
        if not course.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can delete announcements")
        response = await client.delete(
            f"{base}/rest/v1/course_announcements", headers=headers,
            params={"id": f"eq.{announcement_id}", "course_id": f"eq.{course_id}"},
        )
        response.raise_for_status()
        return {"deleted": True}
