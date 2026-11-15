import re
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.prerequisites import find_prerequisite_gap
from app.routers.tutor import _course_access

router = APIRouter(prefix="/courses", tags=["study plans"])


class StudyPlanUpdate(BaseModel):
    completed: bool


def concept_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")[:160]


def recommendation_priority(*, open_misconceptions: int, review_due: bool, mastery_score: float) -> tuple[str, str]:
    if open_misconceptions > 0:
        return "high", "misconception"
    if review_due:
        return "high", "retention"
    if mastery_score < 60:
        return "medium", "mastery"
    return "low", "mastery"


@router.get("/{course_id}/study-plan")
async def get_study_plan(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> list[dict]:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation,resolution=merge-duplicates"}
    base = settings.supabase_url.rstrip("/")
    course_id_string = str(course_id)
    async with httpx.AsyncClient(timeout=30) as client:
        if not await _course_access(client, base, headers, course_id_string, user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        profile_response = await client.get(
            f"{base}/rest/v1/profiles", headers=headers,
            params={"id": f"eq.{user.id}", "role": "eq.student", "select": "id", "limit": "1"},
        )
        profile_response.raise_for_status()
        if not profile_response.json():
            raise HTTPException(status_code=403, detail="Study plans are available to students")
        mastery_response = await client.get(
            f"{base}/rest/v1/student_concept_mastery", headers=headers,
            params={
                "course_id": f"eq.{course_id_string}", "student_id": f"eq.{user.id}",
                "select": "concept,mastery_score,total_answers,completed_teach_backs,open_misconceptions,review_due_at,last_practiced_at",
            },
        )
        mastery_response.raise_for_status()
        mastery_rows = mastery_response.json()
        topics_response = await client.get(
            f"{base}/rest/v1/course_topics", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "id,name"},
        )
        topics_response.raise_for_status()
        links_response = await client.get(
            f"{base}/rest/v1/course_topic_prerequisites", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "topic_id,prerequisite_topic_id"},
        )
        links_response.raise_for_status()
        existing_response = await client.get(
            f"{base}/rest/v1/study_plan_items", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "student_id": f"eq.{user.id}", "select": "id,concept_key,action,priority,source,status,evidence_version,due_at,completed_at"},
        )
        existing_response.raise_for_status()
        existing = {row["concept_key"]: row for row in existing_response.json()}
        now = datetime.now(UTC)
        recommendations_by_key: dict[str, dict] = {}
        for row in mastery_rows:
            score = float(row["mastery_score"] or 0)
            review_due = bool(row["review_due_at"] and datetime.fromisoformat(row["review_due_at"].replace("Z", "+00:00")) <= now)
            if row["open_misconceptions"] <= 0 and not review_due and score >= 70:
                continue
            item_key = concept_key(row["concept"])
            priority, source = recommendation_priority(
                open_misconceptions=row["open_misconceptions"], review_due=review_due, mastery_score=score,
            )
            version = int(row["total_answers"] or 0) + int(row["completed_teach_backs"] or 0) * 2
            old = existing.get(item_key)
            should_reopen = bool(old and old["status"] == "completed" and version > old["evidence_version"])
            teacher_assigned = bool(old and old["status"] == "pending" and old["action"].startswith("Teacher assigned:"))
            prerequisite_gap = find_prerequisite_gap(
                row["concept"], topics_response.json(), links_response.json(), mastery_rows,
            )
            recommendations_by_key[item_key] = {
                "course_id": course_id_string,
                "student_id": user.id,
                "concept": row["concept"],
                "concept_key": item_key,
                "action": old["action"] if teacher_assigned else (
                    f"After completing the prerequisite {prerequisite_gap['prerequisite_concept']}, return to this concept and complete targeted practice."
                    if prerequisite_gap else "Review the concept, then complete targeted practice to check your understanding."
                ),
                "priority": old["priority"] if teacher_assigned else priority,
                "source": old["source"] if teacher_assigned else source,
                "status": "pending" if should_reopen or not old else old["status"],
                "evidence_version": version,
                "due_at": (now + timedelta(days=1 if priority == "high" else 3)).isoformat() if should_reopen or not old else old["due_at"],
                "completed_at": None if should_reopen or not old else old["completed_at"],
            }
            if prerequisite_gap:
                prerequisite_key = concept_key(prerequisite_gap["prerequisite_concept"])
                prerequisite_old = existing.get(prerequisite_key)
                prerequisite_teacher_assigned = bool(
                    prerequisite_old and prerequisite_old["status"] == "pending"
                    and prerequisite_old["action"].startswith("Teacher assigned:")
                )
                prerequisite_version = max(1, int(prerequisite_gap["evidence_count"]))
                prerequisite_should_reopen = bool(
                    prerequisite_old and prerequisite_old["status"] == "completed"
                    and prerequisite_version > prerequisite_old["evidence_version"]
                )
                recommendations_by_key.setdefault(prerequisite_key, {
                    "course_id": course_id_string,
                    "student_id": user.id,
                    "concept": prerequisite_gap["prerequisite_concept"],
                    "concept_key": prerequisite_key,
                    "action": prerequisite_old["action"] if prerequisite_teacher_assigned else f"Prerequisite first: strengthen this concept before continuing with {row['concept']}, then complete targeted practice.",
                    "priority": prerequisite_old["priority"] if prerequisite_teacher_assigned else ("high" if prerequisite_gap["mastery_score"] < 50 else "medium"),
                    "source": prerequisite_old["source"] if prerequisite_teacher_assigned else "mastery",
                    "status": "pending" if prerequisite_should_reopen or not prerequisite_old else prerequisite_old["status"],
                    "evidence_version": prerequisite_version,
                    "due_at": (now + timedelta(days=1)).isoformat() if prerequisite_should_reopen or not prerequisite_old else prerequisite_old["due_at"],
                    "completed_at": None if prerequisite_should_reopen or not prerequisite_old else prerequisite_old["completed_at"],
                })
        recommendations = list(recommendations_by_key.values())
        if recommendations:
            sync_response = await client.post(
                f"{base}/rest/v1/study_plan_items?on_conflict=course_id,student_id,concept_key",
                headers=headers, json=recommendations,
            )
            sync_response.raise_for_status()
        result_response = await client.get(
            f"{base}/rest/v1/study_plan_items", headers=headers,
            params={
                "course_id": f"eq.{course_id_string}", "student_id": f"eq.{user.id}",
                "select": "id,concept,action,priority,source,status,due_at,completed_at,updated_at",
                "order": "status.asc,due_at.asc", "limit": "10",
            },
        )
        result_response.raise_for_status()
        return result_response.json()


@router.patch("/{course_id}/study-plan/{item_id}")
async def update_study_plan_item(
    course_id: UUID,
    item_id: UUID,
    request: StudyPlanUpdate,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.patch(
            f"{base}/rest/v1/study_plan_items", headers=headers,
            params={"id": f"eq.{item_id}", "course_id": f"eq.{course_id}", "student_id": f"eq.{user.id}"},
            json={
                "status": "completed" if request.completed else "pending",
                "completed_at": datetime.now(UTC).isoformat() if request.completed else None,
            },
        )
        response.raise_for_status()
        if not response.json():
            raise HTTPException(status_code=404, detail="Study-plan item not found")
        return response.json()[0]
