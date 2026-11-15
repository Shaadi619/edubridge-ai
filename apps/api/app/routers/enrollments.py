from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.routers.notifications import create_notification

router = APIRouter(tags=["enrollment"])


class CoursePreview(BaseModel):
    id: str
    name: str
    subject: str
    teacher: str
    enrollment_code: str
    students: int
    documents: int


class ReviewRequest(BaseModel):
    action: Literal["approved", "denied"]


def _client_config(settings: Settings) -> tuple[str, dict[str, str]]:
    key = settings.supabase_service_role_key
    return settings.supabase_url.rstrip("/"), {
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"
    }


@router.get("/courses/lookup", response_model=CoursePreview)
async def lookup_course(code: str = Query(min_length=3, max_length=32), user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> CoursePreview:
    del user
    base, headers = _client_config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(f"{base}/rest/v1/courses", headers=headers, params={"enrollment_code": f"eq.{code.strip().upper()}", "archived_at": "is.null", "select": "id,name,subject,enrollment_code,teacher_id", "limit": "1"})
        response.raise_for_status()
        rows = response.json()
        if not rows:
            raise HTTPException(status_code=404, detail="No course found with that code")
        row = rows[0]
        teacher = await client.get(f"{base}/rest/v1/profiles", headers=headers, params={"id": f"eq.{row['teacher_id']}", "select": "display_name"})
        teacher.raise_for_status()
        enrollments = await client.get(
            f"{base}/rest/v1/enrollments", headers={**headers, "Prefer": "count=exact"},
            params={"course_id": f"eq.{row['id']}", "status": "eq.approved", "select": "id", "limit": "1"},
        )
        enrollments.raise_for_status()
        materials = await client.get(
            f"{base}/rest/v1/materials", headers={**headers, "Prefer": "count=exact"},
            params={"course_id": f"eq.{row['id']}", "status": "eq.ready", "select": "id", "limit": "1"},
        )
        materials.raise_for_status()
        return CoursePreview(
            **{k: row[k] for k in ("id", "name", "subject", "enrollment_code")},
            teacher=teacher.json()[0]["display_name"],
            students=int(enrollments.headers.get("content-range", "0/0").split("/")[-1] or 0),
            documents=int(materials.headers.get("content-range", "0/0").split("/")[-1] or 0),
        )


@router.post("/courses/{course_id}/enrollment")
async def request_enrollment(course_id: UUID, user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> dict:
    base, headers = _client_config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        profile = await client.get(f"{base}/rest/v1/profiles", headers=headers, params={"id": f"eq.{user.id}", "select": "role,display_name"})
        if not profile.json() or profile.json()[0]["role"] != "student":
            raise HTTPException(status_code=403, detail="Only student accounts can request enrollment")
        existing = await client.get(f"{base}/rest/v1/enrollments", headers=headers, params={"course_id": f"eq.{course_id}", "student_id": f"eq.{user.id}", "select": "id,status"})
        existing.raise_for_status()
        if existing.json():
            raise HTTPException(status_code=409, detail=f"Enrollment request already exists ({existing.json()[0]['status']})")
        course = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"eq.{course_id}", "select": "id,name,teacher_id"},
        )
        course.raise_for_status()
        if not course.json():
            raise HTTPException(status_code=404, detail="Course not found")
        response = await client.post(f"{base}/rest/v1/enrollments", headers=headers, json={"course_id": str(course_id), "student_id": user.id, "status": "pending"})
        response.raise_for_status()
        course_row = course.json()[0]
        await create_notification(
            client, base, headers, recipient_id=course_row["teacher_id"], course_id=str(course_id),
            notification_type="enroll", title="New enrollment request",
            body=f"{profile.json()[0]['display_name']} wants to join {course_row['name']}.",
            metadata={"enrollment_id": response.json()[0]["id"]},
        )
        return response.json()[0]


@router.get("/teacher/enrollments")
async def teacher_enrollments(user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> list[dict]:
    base, headers = _client_config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        courses = await client.get(f"{base}/rest/v1/courses", headers=headers, params={"teacher_id": f"eq.{user.id}", "select": "id,name,enrollment_code"})
        courses.raise_for_status()
        course_map = {row["id"]: row for row in courses.json()}
        if not course_map:
            return []
        enrollments = await client.get(f"{base}/rest/v1/enrollments", headers=headers, params={"course_id": f"in.({','.join(course_map)})", "select": "id,course_id,student_id,status,created_at", "order": "created_at.desc"})
        enrollments.raise_for_status()
        student_ids = {row["student_id"] for row in enrollments.json()}
        profiles = {}
        if student_ids:
            profile_response = await client.get(f"{base}/rest/v1/profiles", headers=headers, params={"id": f"in.({','.join(student_ids)})", "select": "id,display_name"})
            profile_response.raise_for_status()
            profiles = {row["id"]: row["display_name"] for row in profile_response.json()}
        return [{**row, "student_name": profiles.get(row["student_id"], "Student"), "course_name": course_map[row["course_id"]]["name"], "enrollment_code": course_map[row["course_id"]]["enrollment_code"]} for row in enrollments.json()]


@router.get("/me/enrollments")
async def my_enrollments(user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> list[dict]:
    base, headers = _client_config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{base}/rest/v1/enrollments", headers=headers,
            params={"student_id": f"eq.{user.id}", "select": "id,course_id,status,created_at", "order": "created_at.desc"},
        )
        response.raise_for_status()
        rows = response.json()
        if not rows:
            return []
        course_ids = {row["course_id"] for row in rows}
        course_response = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"in.({','.join(course_ids)})", "select": "id,name,enrollment_code,teacher_id"},
        )
        course_response.raise_for_status()
        courses = {row["id"]: row for row in course_response.json()}
        teacher_ids = {row["teacher_id"] for row in courses.values()}
        teachers: dict[str, str] = {}
        if teacher_ids:
            teacher_response = await client.get(
                f"{base}/rest/v1/profiles", headers=headers,
                params={"id": f"in.({','.join(teacher_ids)})", "select": "id,display_name"},
            )
            teacher_response.raise_for_status()
            teachers = {row["id"]: row["display_name"] for row in teacher_response.json()}
        return [
            {
                **row,
                "course_name": courses.get(row["course_id"], {}).get("name", "Course"),
                "enrollment_code": courses.get(row["course_id"], {}).get("enrollment_code", ""),
                "teacher": teachers.get(courses.get(row["course_id"], {}).get("teacher_id", ""), "Teacher"),
            }
            for row in rows
        ]


@router.delete("/enrollments/{enrollment_id}")
async def cancel_enrollment(enrollment_id: UUID, user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> dict:
    base, headers = _client_config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        enrollment = await client.get(
            f"{base}/rest/v1/enrollments", headers=headers,
            params={"id": f"eq.{enrollment_id}", "student_id": f"eq.{user.id}", "select": "id,status"},
        )
        enrollment.raise_for_status()
        if not enrollment.json():
            raise HTTPException(status_code=404, detail="Enrollment request not found")
        if enrollment.json()[0]["status"] != "pending":
            raise HTTPException(status_code=409, detail="Only pending requests can be cancelled")
        deleted = await client.delete(f"{base}/rest/v1/enrollments?id=eq.{enrollment_id}", headers=headers)
        deleted.raise_for_status()
        return {"deleted": True}


@router.patch("/enrollments/{enrollment_id}")
async def review_enrollment(enrollment_id: UUID, request: ReviewRequest, user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> dict:
    base, headers = _client_config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        enrollment = await client.get(f"{base}/rest/v1/enrollments", headers=headers, params={"id": f"eq.{enrollment_id}", "select": "id,course_id,student_id,status"})
        enrollment.raise_for_status()
        if not enrollment.json():
            raise HTTPException(status_code=404, detail="Enrollment request not found")
        row = enrollment.json()[0]
        course = await client.get(f"{base}/rest/v1/courses", headers=headers, params={"id": f"eq.{row['course_id']}", "teacher_id": f"eq.{user.id}", "select": "id,name"})
        if not course.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can review this request")
        if row["status"] != "pending":
            raise HTTPException(status_code=409, detail="This request has already been reviewed")
        updated = await client.patch(f"{base}/rest/v1/enrollments?id=eq.{enrollment_id}", headers=headers, json={"status": request.action, "reviewed_by": user.id, "reviewed_at": datetime.now(timezone.utc).isoformat()})
        updated.raise_for_status()
        course_name = course.json()[0]["name"]
        approved = request.action == "approved"
        await create_notification(
            client, base, headers,
            recipient_id=row["student_id"], course_id=row["course_id"], notification_type="enroll",
            title="Enrollment approved" if approved else "Enrollment request declined",
            body=f"You can now access {course_name}." if approved else f"Your request to join {course_name} was not approved.",
            metadata={"enrollment_id": str(enrollment_id), "decision": request.action},
        )
        return updated.json()[0]


@router.get("/me/courses")
async def my_courses(user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> list[dict]:
    base, headers = _client_config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        enrollments = await client.get(f"{base}/rest/v1/enrollments", headers=headers, params={"student_id": f"eq.{user.id}", "status": "eq.approved", "select": "course_id"})
        enrollments.raise_for_status()
        ids = [row["course_id"] for row in enrollments.json()]
        if not ids:
            return []
        courses = await client.get(f"{base}/rest/v1/courses", headers=headers, params={"id": f"in.({','.join(ids)})", "select": "id,name,subject,enrollment_code,teacher_id"})
        courses.raise_for_status()
        rows = courses.json()
        teacher_ids = {row["teacher_id"] for row in rows}
        teachers = await client.get(f"{base}/rest/v1/profiles", headers=headers, params={"id": f"in.({','.join(teacher_ids)})", "select": "id,display_name"})
        teachers.raise_for_status()
        teacher_map = {row["id"]: row["display_name"] for row in teachers.json()}
        return [{**row, "teacher": teacher_map.get(row["teacher_id"], "Teacher")} for row in rows]
