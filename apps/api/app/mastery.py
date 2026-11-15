import logging
from datetime import UTC, datetime, timedelta

import httpx

logger = logging.getLogger(__name__)


def evidence_count(total: int, completed_teach_backs: int) -> int:
    return total + completed_teach_backs * 2


def _score(
    correct: int,
    total: int,
    open_misconceptions: int,
    completed_teach_backs: int = 0,
    verified_teach_backs: int = 0,
) -> float:
    weighted_total = evidence_count(total, completed_teach_backs)
    if weighted_total == 0:
        return 0.0
    weighted_correct = correct + verified_teach_backs * 2
    smoothed_score = 100 * (weighted_correct + 1) / (weighted_total + 2)
    return round(min(smoothed_score, 49 if open_misconceptions else 100), 2)


def _confidence(total: int, completed_teach_backs: int) -> float:
    return round(min(0.95, evidence_count(total, completed_teach_backs) / 6), 3)


def _review_due(now: datetime, mastery_score: float, open_misconceptions: int) -> str:
    days = 2 if open_misconceptions or mastery_score < 60 else 7 if mastery_score < 85 else 14
    return (now + timedelta(days=days)).isoformat()


async def _existing(
    client: httpx.AsyncClient, base: str, headers: dict, course_id: str, student_id: str,
) -> dict[str, dict]:
    response = await client.get(
        f"{base}/rest/v1/student_concept_mastery",
        headers=headers,
        params={
            "course_id": f"eq.{course_id}",
            "student_id": f"eq.{student_id}",
            "select": "concept,correct_answers,total_answers,open_misconceptions,mastery_score,confidence,completed_teach_backs,verified_teach_backs",
        },
    )
    response.raise_for_status()
    return {row["concept"]: row for row in response.json()}


async def _upsert(client: httpx.AsyncClient, base: str, headers: dict, rows: list[dict]) -> None:
    if not rows:
        return
    upsert_headers = {**headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
    response = await client.post(
        f"{base}/rest/v1/student_concept_mastery",
        headers=upsert_headers,
        params={"on_conflict": "course_id,student_id,concept"},
        json=rows,
    )
    response.raise_for_status()


async def change_misconception_evidence(
    client: httpx.AsyncClient,
    base: str,
    headers: dict,
    *,
    course_id: str,
    student_id: str,
    concept: str,
    delta: int,
) -> bool:
    try:
        existing = await _existing(client, base, headers, course_id, student_id)
        current = existing.get(concept, {})
        correct = int(current.get("correct_answers", 0))
        total = int(current.get("total_answers", 0))
        open_count = max(0, int(current.get("open_misconceptions", 0)) + delta)
        completed_teach_backs = int(current.get("completed_teach_backs", 0))
        verified_teach_backs = int(current.get("verified_teach_backs", 0))
        mastery = _score(correct, total, open_count, completed_teach_backs, verified_teach_backs)
        now = datetime.now(UTC)
        await _upsert(client, base, headers, [{
            "course_id": course_id,
            "student_id": student_id,
            "concept": concept,
            "mastery_score": mastery,
            "confidence": _confidence(total, completed_teach_backs),
            "correct_answers": correct,
            "total_answers": total,
            "open_misconceptions": open_count,
            "completed_teach_backs": completed_teach_backs,
            "verified_teach_backs": verified_teach_backs,
            "last_practiced_at": now.isoformat(),
            "review_due_at": _review_due(now, mastery, open_count),
            "updated_at": now.isoformat(),
        }])
        return True
    except httpx.HTTPError:
        logger.exception("Could not update misconception mastery evidence for student %s", student_id)
        return False


async def record_teach_back_evidence(
    client: httpx.AsyncClient,
    base: str,
    headers: dict,
    *,
    course_id: str,
    student_id: str,
    concept: str,
    corrected: bool,
    reopen: bool = False,
) -> bool:
    try:
        existing = await _existing(client, base, headers, course_id, student_id)
        current = existing.get(concept, {})
        correct = int(current.get("correct_answers", 0))
        total = int(current.get("total_answers", 0))
        completed = int(current.get("completed_teach_backs", 0)) + 1
        verified = int(current.get("verified_teach_backs", 0)) + int(corrected)
        open_count = max(0, int(current.get("open_misconceptions", 0)) - int(corrected) + int(reopen))
        mastery = _score(correct, total, open_count, completed, verified)
        now = datetime.now(UTC)
        await _upsert(client, base, headers, [{
            "course_id": course_id,
            "student_id": student_id,
            "concept": concept,
            "mastery_score": mastery,
            "confidence": _confidence(total, completed),
            "correct_answers": correct,
            "total_answers": total,
            "open_misconceptions": open_count,
            "completed_teach_backs": completed,
            "verified_teach_backs": verified,
            "last_practiced_at": now.isoformat(),
            "review_due_at": _review_due(now, mastery, open_count),
            "updated_at": now.isoformat(),
        }])
        return True
    except httpx.HTTPError:
        logger.exception("Could not record teach-back mastery evidence for student %s", student_id)
        return False
