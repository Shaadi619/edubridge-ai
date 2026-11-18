import logging
from datetime import UTC, datetime, timedelta
from itertools import combinations
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai.azure_provider import AzureOpenAIProvider
from app.ai.contracts import EvidenceChunk
from app.ai.embeddings import embedding_client
from app.ai.quiz_verification import QuizVerificationError, generate_verified_quiz, shuffle_verified_quiz
from app.auth import AuthenticatedUser, current_user
from app.concepts import friendly_concept, group_concept_records
from app.config import Settings, get_settings
from app.mastery import _confidence, _score, evidence_count
from app.prerequisites import find_prerequisite_gap, ordered_prerequisite_concepts
from app.routers.notifications import create_notification
from app.routers.study_plans import concept_key
from app.routers.tutor import _course_access, _source_kind

router = APIRouter(prefix="/courses", tags=["quizzes"])
logger = logging.getLogger(__name__)


class GenerateQuizRequest(BaseModel):
    question_count: int = Field(default=4, ge=3, le=8)
    focus_concept: str | None = Field(default=None, max_length=160)


class QuizCitation(BaseModel):
    chunk_id: str
    document_title: str
    page_number: int | None
    source_kind: str


class GeneratedQuestion(BaseModel):
    id: str
    prompt: str
    options: list[str]
    correct_option: int
    explanation: str
    concept: str
    difficulty: int
    citations: list[QuizCitation]


class GeneratedQuiz(BaseModel):
    id: str
    title: str
    difficulty_mode: Literal["easy", "adaptive", "hard"]
    focus_concept: str | None = None
    prerequisite_concepts: list[str] = Field(default_factory=list)
    questions: list[GeneratedQuestion]


class SubmitQuizRequest(BaseModel):
    answers: list[int | None]
    confidences: list[Literal[1, 2, 3] | None] = Field(default_factory=list)


class AssignPracticeRequest(BaseModel):
    concept: str = Field(min_length=1, max_length=160)
    action: str | None = Field(default=None, max_length=600)
    student_message: str | None = Field(default=None, max_length=500)
    due_days: int = Field(default=3, ge=1, le=30)


def _difficulty_instruction(mode: str) -> str:
    return {
        "easy": "Use difficulty 1-2. Focus on foundational recall, definitions, and one-step conceptual understanding.",
        "hard": "Use difficulty 4-5. Focus on application, comparison, and multi-step reasoning without adding facts outside the evidence.",
        "adaptive": "Use a balanced difficulty mix from 2-4, targeting weak concepts more heavily while keeping the quiz achievable.",
    }.get(mode, "Use a balanced difficulty mix from 2-4, targeting weak concepts more heavily while keeping the quiz achievable.")


QUEUE_LIMIT = 25


def _intervention_queue(
    misconceptions: list[dict], study_plans: list[dict], names: dict[str, str], now: datetime,
    citations_by_misconception: dict[str, list[dict]] | None = None,
    confidence_gaps: list[dict] | None = None,
    prerequisite_gaps: list[dict] | None = None,
) -> list[dict]:
    """Build a deterministic, token-free queue from existing learning evidence."""
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    source_rank = {"retention": 0, "prerequisite_gap": 1, "confidence_gap": 2, "misconception": 3, "study_plan": 4}
    queue: dict[tuple[str, str], dict] = {}
    assigned = {
        (plan["student_id"], concept_key(plan["concept"]))
        for plan in study_plans
        if plan.get("status") == "pending" and str(plan.get("action", "")).startswith("Teacher assigned:")
    }

    def rank(item: dict) -> tuple[int, int, int]:
        # The student's own words are the most useful evidence for a teacher,
        # so an item that has them wins over another item on the same concept.
        has_words = 0 if item.get("student_evidence") else 1
        return (has_words, priority_rank[item["priority"]], source_rank[item["source"]])

    def add(item: dict) -> None:
        key = (item["student_id"], concept_key(item["concept"]))
        item["practice_assigned"] = key in assigned
        current = queue.get(key)
        if current is None or rank(item) < rank(current):
            if current is not None and current["source"] == "study_plan" and item["source"] != "study_plan":
                item["overdue_task"] = True
            queue[key] = item
        elif item["source"] == "study_plan" and current["source"] != "study_plan":
            current["overdue_task"] = True

    for gap in prerequisite_gaps or []:
        score_text = f" Current mastery evidence is {gap['mastery_score']}%." if gap.get("evidence_count", 0) > 0 else ""
        add({
            "id": f"prerequisite-{gap['student_id']}-{concept_key(gap['prerequisite_concept'])}-{concept_key(gap['downstream_concept'])}",
            "student_id": gap["student_id"],
            "student": names.get(gap["student_id"], "Student"),
            "concept": gap["prerequisite_concept"],
            "downstream_concept": gap["downstream_concept"],
            "priority": "high" if gap.get("open_misconceptions", 0) > 0 or gap.get("mastery_score", 100) < 50 else "medium",
            "source": "prerequisite_gap",
            "reason": f"Possible prerequisite gap: difficulty with {gap['downstream_concept']} may be connected to weaker evidence in {gap['prerequisite_concept']}.{score_text}",
            "recommended_action": f"Review and assign targeted practice on {gap['prerequisite_concept']} before returning to {gap['downstream_concept']}.",
            "due_at": gap.get("detected_at"),
            "citations": gap.get("citations", []),
        })

    for gap in confidence_gaps or []:
        add({
            "id": f"confidence-{gap['student_id']}-{concept_key(gap['concept'])}",
            "student_id": gap["student_id"],
            "student": names.get(gap["student_id"], "Student"),
            "concept": gap["concept"],
            "priority": "high",
            "source": "confidence_gap",
            "reason": f"The student was very confident but incorrect {gap['count']} time{'s' if gap['count'] != 1 else ''}.",
            "recommended_action": "Ask the student to explain their reasoning before giving the correction, then assign targeted practice.",
            "due_at": gap.get("last_detected_at"),
            "citations": [],
        })

    for misconception in misconceptions:
        if misconception.get("retention_status") == "needs_review":
            add({
                "id": f"retention-{misconception['id']}",
                "student_id": misconception["student_id"],
                "student": names.get(misconception["student_id"], "Student"),
                "concept": misconception["concept"],
                "priority": "high",
                "source": "retention",
                "misconception_id": misconception["id"],
                "student_evidence": misconception.get("student_evidence"),
                "reason": "The student did not retain this concept during the follow-up check.",
                "recommended_action": "Review the cited course material with the student, then assign targeted practice.",
                "due_at": misconception.get("retention_due_at"),
                "citations": (citations_by_misconception or {}).get(misconception["id"], []),
            })
        elif misconception.get("status") == "open":
            repeated = int(misconception.get("occurrence_count") or 1) > 1
            add({
                "id": f"misconception-{misconception['id']}",
                "student_id": misconception["student_id"],
                "student": names.get(misconception["student_id"], "Student"),
                "concept": misconception["concept"],
                "priority": "high" if repeated else "medium",
                "source": "misconception",
                "misconception_id": misconception["id"],
                "student_evidence": misconception.get("student_evidence"),
                "reason": "This misconception has appeared more than once." if repeated else "An unresolved misconception was detected.",
                "recommended_action": misconception.get("recommended_intervention") or "Ask the student to complete a teach-back check before marking it resolved.",
                "due_at": misconception.get("last_detected_at") or misconception.get("created_at"),
                "citations": (citations_by_misconception or {}).get(misconception["id"], []),
            })

    for plan in study_plans:
        due_at = datetime.fromisoformat(plan["due_at"].replace("Z", "+00:00"))
        if plan.get("status") != "pending" or due_at > now:
            continue
        add({
            "id": f"plan-{plan['id']}",
            "student_id": plan["student_id"],
            "student": names.get(plan["student_id"], "Student"),
            "concept": plan["concept"],
            "priority": "high",
            "source": "study_plan",
            "reason": "A recommended study-plan activity is overdue.",
            "recommended_action": "Check in with the student and ask them to complete the targeted practice activity.",
            "due_at": plan["due_at"],
            "citations": [],
        })

    return sorted(
        queue.values(),
        key=lambda item: (
            0 if item.get("student_evidence") else 1, priority_rank[item["priority"]], item.get("due_at") or "",
        ),
    )[:QUEUE_LIMIT]


def _confidence_gap_records(
    answers: list[dict], attempt_student: dict[str, str], concepts: dict[str, str], attempt_dates: dict[str, str] | None = None,
) -> list[dict]:
    gaps: dict[tuple[str, str], dict] = {}
    for answer in answers:
        student_id = attempt_student.get(answer["attempt_id"])
        if not student_id or answer.get("is_correct") is not False or answer.get("confidence") != 3:
            continue
        concept = friendly_concept(concepts.get(answer["question_id"], "Course concept"))
        key = (student_id, concept_key(concept))
        gap = gaps.setdefault(key, {
            "student_id": student_id, "concept": concept, "count": 0,
            "last_detected_at": (attempt_dates or {}).get(answer["attempt_id"]),
        })
        gap["count"] += 1
    return list(gaps.values())


def _prerequisite_gap_records(
    signals: list[dict], mastery_by_student: dict[str, list[dict]], topics: list[dict], links: list[dict],
) -> list[dict]:
    topic_by_id = {str(topic["id"]): topic["name"] for topic in topics}
    gaps: dict[tuple[str, str, str], dict] = {}
    for signal in signals:
        student_id = signal.get("student_id")
        concept = signal.get("concept")
        if not student_id or not concept:
            continue
        gap = find_prerequisite_gap(concept, topics, links, mastery_by_student.get(student_id, []))
        if not gap:
            continue
        path_concepts = {concept_key(name) for name in [*ordered_prerequisite_concepts(concept, topics, links), concept]}
        relationship_citations: list[dict] = []
        for link in links:
            prerequisite_name = topic_by_id.get(str(link.get("prerequisite_topic_id")), "")
            topic_name = topic_by_id.get(str(link.get("topic_id")), "")
            if concept_key(prerequisite_name) not in path_concepts or concept_key(topic_name) not in path_concepts:
                continue
            for citation in link.get("evidence") or []:
                if isinstance(citation, dict) and citation.get("document_title"):
                    relationship_citations.append(citation)
        unique_citations: list[dict] = []
        seen: set[tuple[str, int | None]] = set()
        for citation in [*relationship_citations, *(signal.get("citations") or [])]:
            location = (citation.get("document_title", ""), citation.get("page_number"))
            if location in seen or not location[0]:
                continue
            seen.add(location)
            unique_citations.append(citation)
            if len(unique_citations) == 3:
                break
        record = {
            **gap, "student_id": student_id, "detected_at": signal.get("detected_at"),
            "citations": unique_citations,
        }
        gaps[(student_id, concept_key(gap["prerequisite_concept"]), concept_key(concept))] = record
    return list(gaps.values())


def _prerequisite_concepts(focus_concept: str, topics: list[dict], links: list[dict]) -> list[str]:
    return ordered_prerequisite_concepts(focus_concept, topics, links)


def _class_misconception_network(misconceptions: list[dict]) -> dict:
    """Build an undirected class co-occurrence graph from open misconception evidence."""
    node_data: dict[str, dict] = {}
    concepts_by_student: dict[str, set[str]] = {}
    for item in misconceptions:
        if item.get("status") != "open":
            continue
        concept = friendly_concept(item.get("concept") or "Course concept")
        key = concept_key(concept) or str(item["id"])
        node = node_data.setdefault(key, {"id": key, "concept": concept, "students": set(), "occurrences": 0})
        node["students"].add(item["student_id"])
        node["occurrences"] += int(item.get("occurrence_count") or 1)
        concepts_by_student.setdefault(item["student_id"], set()).add(key)

    edge_students: dict[tuple[str, str], set[str]] = {}
    for student_id, keys in concepts_by_student.items():
        for left, right in combinations(sorted(keys), 2):
            edge_students.setdefault((left, right), set()).add(student_id)
    connections = {key: 0 for key in node_data}
    edges = []
    for (source, target), students in edge_students.items():
        shared = len(students)
        connections[source] += shared
        connections[target] += shared
        edges.append({"source": source, "target": target, "shared_students": shared})
    nodes = [{
        "id": node["id"], "concept": node["concept"], "affected_students": len(node["students"]),
        "occurrences": node["occurrences"], "connection_strength": connections[node["id"]],
    } for node in node_data.values()]
    nodes.sort(key=lambda node: (-node["connection_strength"], -node["affected_students"], node["concept"].casefold()))
    edges.sort(key=lambda edge: -edge["shared_students"])
    return {
        "nodes": nodes,
        "edges": edges,
        "hub_concept": nodes[0]["id"] if nodes and nodes[0]["connection_strength"] > 0 else None,
    }


async def _misconception_course_citations(
    client: httpx.AsyncClient, base: str, headers: dict, misconceptions: list[dict],
) -> dict[str, list[dict]]:
    """Resolve each misconception's source question to the grounded answer citations that followed it."""
    source_ids = [item["source_message_id"] for item in misconceptions if item.get("source_message_id")]
    if not source_ids:
        return {}
    source_response = await client.get(
        f"{base}/rest/v1/messages", headers=headers,
        params={"id": f"in.({','.join(source_ids)})", "select": "id,conversation_id,created_at"},
    )
    source_response.raise_for_status()
    sources = source_response.json()
    if not sources:
        return {}
    conversation_ids = list(dict.fromkeys(item["conversation_id"] for item in sources))
    answers_response = await client.get(
        f"{base}/rest/v1/messages", headers=headers,
        params={
            "conversation_id": f"in.({','.join(conversation_ids)})", "author_role": "eq.assistant",
            "select": "id,conversation_id,created_at", "order": "created_at.asc",
        },
    )
    answers_response.raise_for_status()
    answers = answers_response.json()
    answer_by_source: dict[str, str] = {}
    for source in sources:
        source_time = datetime.fromisoformat(source["created_at"].replace("Z", "+00:00"))
        match = next((
            answer for answer in answers
            if answer["conversation_id"] == source["conversation_id"]
            and datetime.fromisoformat(answer["created_at"].replace("Z", "+00:00")) >= source_time
        ), None)
        if match:
            answer_by_source[source["id"]] = match["id"]
    if not answer_by_source:
        return {}
    citation_response = await client.get(
        f"{base}/rest/v1/message_citations", headers=headers,
        params={"message_id": f"in.({','.join(answer_by_source.values())})", "select": "message_id,chunk_id"},
    )
    citation_response.raise_for_status()
    citation_rows = citation_response.json()
    if not citation_rows:
        return {}
    chunk_response = await client.get(
        f"{base}/rest/v1/material_chunks", headers=headers,
        params={"id": f"in.({','.join(row['chunk_id'] for row in citation_rows)})", "select": "id,material_id,page_number"},
    )
    chunk_response.raise_for_status()
    chunks = {row["id"]: row for row in chunk_response.json()}
    material_ids = list(dict.fromkeys(row["material_id"] for row in chunks.values()))
    if not material_ids:
        return {}
    material_response = await client.get(
        f"{base}/rest/v1/materials", headers=headers,
        params={"id": f"in.({','.join(material_ids)})", "select": "id,title"},
    )
    material_response.raise_for_status()
    materials = {row["id"]: row["title"] for row in material_response.json()}
    citations_by_answer: dict[str, list[dict]] = {}
    for row in citation_rows:
        chunk = chunks.get(row["chunk_id"])
        if not chunk or chunk["material_id"] not in materials:
            continue
        title = materials[chunk["material_id"]]
        citation = {
            "document_title": title,
            "page_number": chunk.get("page_number"),
            "source_kind": _source_kind(title, chunk.get("page_number")),
            "chunk_id": row["chunk_id"],
        }
        current = citations_by_answer.setdefault(row["message_id"], [])
        if citation not in current and len(current) < 2:
            current.append(citation)
    misconception_by_source = {
        item["source_message_id"]: item["id"] for item in misconceptions if item.get("source_message_id")
    }
    return {
        misconception_by_source[source_id]: citations_by_answer.get(answer_id, [])
        for source_id, answer_id in answer_by_source.items()
        if source_id in misconception_by_source and citations_by_answer.get(answer_id)
    }


@router.post("/teacher/{course_id}/interventions/{student_id}/assign-practice")
async def assign_targeted_practice(
    course_id: UUID,
    student_id: UUID,
    request: AssignPracticeRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    concept = request.concept.strip()
    if not concept:
        raise HTTPException(status_code=422, detail="A practice concept is required")
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=20) as client:
        course_response = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"eq.{course_id}", "teacher_id": f"eq.{user.id}", "select": "id,name", "limit": "1"},
        )
        course_response.raise_for_status()
        if not course_response.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can assign practice")
        enrollment_response = await client.get(
            f"{base}/rest/v1/enrollments", headers=headers,
            params={"course_id": f"eq.{course_id}", "student_id": f"eq.{student_id}", "status": "eq.approved", "select": "id", "limit": "1"},
        )
        enrollment_response.raise_for_status()
        if not enrollment_response.json():
            raise HTTPException(status_code=404, detail="This student is not enrolled in the course")

        now = datetime.now(UTC)
        action = request.action.strip() if request.action else "Complete a targeted quiz, then review the explanations for any missed questions."
        student_message = request.student_message.strip() if request.student_message else f"Your teacher assigned practice on {concept} in {course_response.json()[0]['name']}."
        plan_response = await client.post(
            f"{base}/rest/v1/study_plan_items?on_conflict=course_id,student_id,concept_key",
            headers={**headers, "Prefer": "return=representation,resolution=merge-duplicates"},
            json={
                "course_id": str(course_id),
                "student_id": str(student_id),
                "concept": concept,
                "concept_key": concept_key(concept),
                "action": f"Teacher assigned: {action}",
                "priority": "high",
                "source": "mastery",
                "status": "pending",
                "due_at": (now + timedelta(days=request.due_days)).isoformat(),
                "completed_at": None,
            },
        )
        plan_response.raise_for_status()
        await create_notification(
            client, base, headers,
            recipient_id=str(student_id), course_id=str(course_id), notification_type="quiz",
            title="Targeted practice assigned",
            body=student_message,
            metadata={"student_id": str(student_id), "focus_concept": concept, "assignment": True},
        )
        item = plan_response.json()[0]
        return {"assigned": True, "study_plan_item_id": item["id"], "concept": concept, "due_at": item["due_at"]}


@router.get("/{course_id}/progress")
async def course_progress(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        if not await _course_access(client, base, headers, str(course_id), user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        quizzes_response = await client.get(
            f"{base}/rest/v1/quizzes", headers=headers,
            params={"course_id": f"eq.{course_id}", "student_id": f"eq.{user.id}", "select": "id,title"},
        )
        quizzes_response.raise_for_status()
        quizzes = quizzes_response.json()
        if not quizzes:
            return {"quiz_count": 0, "average_score": 0, "best_score": 0, "weak_topics": [], "topic_scores": [], "attempts": []}
        quiz_map = {row["id"]: row["title"] for row in quizzes}
        quiz_filter = f"in.({','.join(quiz_map)})"
        attempts_response = await client.get(
            f"{base}/rest/v1/quiz_attempts", headers=headers,
            params={"quiz_id": quiz_filter, "student_id": f"eq.{user.id}", "completed_at": "not.is.null", "select": "id,quiz_id,score,started_at,completed_at", "order": "completed_at.desc"},
        )
        attempts_response.raise_for_status()
        attempts = attempts_response.json()
        if not attempts:
            return {"quiz_count": 0, "average_score": 0, "best_score": 0, "weak_topics": [], "topic_scores": [], "attempts": []}
        attempt_ids = [row["id"] for row in attempts]
        questions_response = await client.get(
            f"{base}/rest/v1/quiz_questions", headers=headers,
            params={"quiz_id": quiz_filter, "select": "id,concept"},
        )
        questions_response.raise_for_status()
        concept_by_question = {row["id"]: row["concept"] for row in questions_response.json()}
        answers_response = await client.get(
            f"{base}/rest/v1/quiz_answers", headers=headers,
            params={"attempt_id": f"in.({','.join(attempt_ids)})", "select": "attempt_id,question_id,is_correct"},
        )
        answers_response.raise_for_status()
        topic_totals: dict[str, list[int]] = {}
        attempt_totals: dict[str, list[int]] = {}
        for answer in answers_response.json():
            concept = concept_by_question.get(answer["question_id"], "Course concepts")
            topic_totals.setdefault(concept, [0, 0])
            topic_totals[concept][1] += 1
            attempt_totals.setdefault(answer["attempt_id"], [0, 0])
            attempt_totals[answer["attempt_id"]][1] += 1
            if answer["is_correct"]:
                topic_totals[concept][0] += 1
                attempt_totals[answer["attempt_id"]][0] += 1
        topic_scores = sorted(
            [{"topic": topic, "score": round(correct * 100 / total)} for topic, (correct, total) in topic_totals.items()],
            key=lambda row: row["score"],
        )
        scores = [float(row["score"]) for row in attempts]
        return {
            "quiz_count": len(attempts),
            "average_score": round(sum(scores) / len(scores)),
            "best_score": round(max(scores)),
            "weak_topics": [row["topic"] for row in topic_scores if row["score"] < 70][:3],
            "topic_scores": topic_scores,
            "attempts": [{
                "id": row["id"], "title": quiz_map.get(row["quiz_id"], "Course quiz"), "score": round(float(row["score"])),
                "correct": attempt_totals.get(row["id"], [0, 0])[0], "total": attempt_totals.get(row["id"], [0, 0])[1],
                "completed_at": row["completed_at"],
            } for row in attempts[:10]],
        }


@router.get("/{course_id}/concept-mastery")
async def concept_mastery(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> list[dict]:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        if not await _course_access(client, base, headers, str(course_id), user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        mastery_response = await client.get(
            f"{base}/rest/v1/student_concept_mastery", headers=headers,
            params={
                "course_id": f"eq.{course_id}", "student_id": f"eq.{user.id}",
                "select": "concept,mastery_score,confidence,correct_answers,total_answers,open_misconceptions,completed_teach_backs,verified_teach_backs,last_practiced_at,review_due_at",
                "order": "mastery_score.asc,concept.asc",
            },
        )
        mastery_response.raise_for_status()
        rows = mastery_response.json()
        misconceptions_response = await client.get(
            f"{base}/rest/v1/misconceptions", headers=headers,
            params={
                "course_id": f"eq.{course_id}", "student_id": f"eq.{user.id}", "status": "neq.dismissed",
                "select": "id,student_id,concept,label,student_evidence,learning_status,created_at",
                "order": "created_at.desc",
            },
        )
        misconceptions_response.raise_for_status()
        mastery_by_concept = {row["concept"].casefold(): row for row in rows}
        grouped_keys: set[str] = set()
        grouped_rows = []
        for group in group_concept_records(misconceptions_response.json()):
            related = [mastery_by_concept[item["concept"].casefold()] for item in group if item["concept"].casefold() in mastery_by_concept]
            if not related:
                continue
            grouped_keys.update(row["concept"].casefold() for row in related)
            correct = sum(row["correct_answers"] for row in related)
            total = sum(row["total_answers"] for row in related)
            completed = sum(row["completed_teach_backs"] for row in related)
            verified = sum(row["verified_teach_backs"] for row in related)
            open_count = 0 if group[0]["learning_status"] == "verified" else 1
            primary = related[0]
            grouped_rows.append({
                **primary,
                "concept": group[0]["concept"],
                "correct_answers": correct,
                "total_answers": total,
                "completed_teach_backs": completed,
                "verified_teach_backs": verified,
                "open_misconceptions": open_count,
                "mastery_score": _score(correct, total, open_count, completed, verified),
                "confidence": _confidence(total, completed),
            })
        rows = [row for row in rows if row["concept"].casefold() not in grouped_keys] + grouped_rows
        stored = {row["concept"].casefold() for row in rows}
        topics_response = await client.get(
            f"{base}/rest/v1/course_topics", headers=headers,
            params={"course_id": f"eq.{course_id}", "select": "name", "order": "name.asc"},
        )
        topics_response.raise_for_status()
        rows.extend({
            "concept": topic["name"], "mastery_score": 0, "confidence": 0,
            "correct_answers": 0, "total_answers": 0, "open_misconceptions": 0,
            "completed_teach_backs": 0, "verified_teach_backs": 0,
            "last_practiced_at": None, "review_due_at": None,
        } for topic in topics_response.json() if topic["name"].casefold() not in stored)
        now = datetime.now(UTC)
        result = []
        for row in rows:
            weighted_evidence = evidence_count(row["total_answers"], row["completed_teach_backs"])
            enough_evidence = weighted_evidence >= 3
            score = float(row["mastery_score"])
            result.append({
            **row,
            "concept": friendly_concept(row["concept"]),
            "mastery_score": score if enough_evidence else None,
            "confidence": float(row["confidence"]),
            "evidence_count": weighted_evidence,
            "evidence_sufficient": enough_evidence,
            "status": "not_started" if weighted_evidence == 0 and row["open_misconceptions"] == 0
            else "needs_review" if row["open_misconceptions"] > 0
            else "verified_once" if not enough_evidence and row["verified_teach_backs"] > 0
            else "needs_review" if enough_evidence and score < 60
            else "developing" if not enough_evidence or score < 85 else "strong",
            "review_due": bool(row["review_due_at"] and datetime.fromisoformat(row["review_due_at"].replace("Z", "+00:00")) <= now),
            })
        return result


@router.get("/teacher/{course_id}/analytics")
async def teacher_course_analytics(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        course_response = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"eq.{course_id}", "teacher_id": f"eq.{user.id}", "select": "id,name"},
        )
        course_response.raise_for_status()
        if not course_response.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can view analytics")
        enrollments_response = await client.get(
            f"{base}/rest/v1/enrollments", headers=headers,
            params={"course_id": f"eq.{course_id}", "status": "eq.approved", "select": "student_id"},
        )
        enrollments_response.raise_for_status()
        student_ids = [row["student_id"] for row in enrollments_response.json()]
        materials_response = await client.get(
            f"{base}/rest/v1/materials", headers=headers,
            params={"course_id": f"eq.{course_id}", "status": "eq.ready", "select": "id"},
        )
        materials_response.raise_for_status()
        if not student_ids:
            return {"active_students": 0, "average_score": 0, "open_flags": 0, "overdue_study_tasks": 0, "quizzes_today": 0, "document_count": len(materials_response.json()), "students": [], "attention": [], "intervention_queue": [], "misconception_network": {"nodes": [], "edges": [], "hub_concept": None}, "topic_scores": [], "misconceptions": []}
        profiles_response = await client.get(
            f"{base}/rest/v1/profiles", headers=headers,
            params={"id": f"in.({','.join(student_ids)})", "select": "id,display_name"},
        )
        profiles_response.raise_for_status()
        names = {row["id"]: row["display_name"] for row in profiles_response.json()}
        quizzes_response = await client.get(
            f"{base}/rest/v1/quizzes", headers=headers,
            params={"course_id": f"eq.{course_id}", "select": "id,student_id"},
        )
        quizzes_response.raise_for_status()
        quizzes = quizzes_response.json()
        quiz_owner = {row["id"]: row["student_id"] for row in quizzes}
        attempts = []
        answers = []
        concepts: dict[str, str] = {}
        if quiz_owner:
            quiz_filter = f"in.({','.join(quiz_owner)})"
            attempts_response = await client.get(
                f"{base}/rest/v1/quiz_attempts", headers=headers,
                params={"quiz_id": quiz_filter, "completed_at": "not.is.null", "select": "id,quiz_id,student_id,score,completed_at"},
            )
            attempts_response.raise_for_status()
            attempts = attempts_response.json()
            questions_response = await client.get(
                f"{base}/rest/v1/quiz_questions", headers=headers,
                params={"quiz_id": quiz_filter, "select": "id,concept"},
            )
            questions_response.raise_for_status()
            concepts = {row["id"]: row["concept"] for row in questions_response.json()}
            if attempts:
                answers_response = await client.get(
                    f"{base}/rest/v1/quiz_answers", headers=headers,
                    params={"attempt_id": f"in.({','.join(row['id'] for row in attempts)})", "select": "attempt_id,question_id,is_correct,confidence"},
                )
                if answers_response.status_code == 400:
                    answers_response = await client.get(
                        f"{base}/rest/v1/quiz_answers", headers=headers,
                        params={"attempt_id": f"in.({','.join(row['id'] for row in attempts)})", "select": "attempt_id,question_id,is_correct"},
                    )
                answers_response.raise_for_status()
                answers = [{"confidence": None, **row} for row in answers_response.json()]
        misconceptions_response = await client.get(
            f"{base}/rest/v1/misconceptions", headers=headers,
            params={"course_id": f"eq.{course_id}", "select": "id,student_id,source_message_id,concept,explanation,student_evidence,recommended_intervention,status,created_at,occurrence_count,last_detected_at,retention_status,retention_due_at", "order": "created_at.desc"},
        )
        misconceptions_response.raise_for_status()
        misconceptions = misconceptions_response.json()
        open_misconceptions = [item for item in misconceptions if item["status"] == "open"]
        study_plan_response = await client.get(
            f"{base}/rest/v1/study_plan_items", headers=headers,
            params={"course_id": f"eq.{course_id}", "status": "eq.pending", "select": "id,student_id,concept,action,source,status,due_at"},
        )
        study_plan_response.raise_for_status()
        now = datetime.now(UTC)
        overdue_plans = [
            item for item in study_plan_response.json()
            if datetime.fromisoformat(item["due_at"].replace("Z", "+00:00")) <= now
        ]
        overdue_by_student: dict[str, int] = {}
        for item in overdue_plans:
            overdue_by_student[item["student_id"]] = overdue_by_student.get(item["student_id"], 0) + 1
        attempts_by_student: dict[str, list[dict]] = {student_id: [] for student_id in student_ids}
        attempt_student: dict[str, str] = {}
        attempt_dates: dict[str, str] = {}
        for attempt in attempts:
            attempts_by_student.setdefault(attempt["student_id"], []).append(attempt)
            attempt_student[attempt["id"]] = attempt["student_id"]
            attempt_dates[attempt["id"]] = attempt["completed_at"]
        topic_results: dict[str, dict[str, list[int]]] = {student_id: {} for student_id in student_ids}
        for answer in answers:
            student_id = attempt_student.get(answer["attempt_id"])
            if not student_id:
                continue
            concept = concepts.get(answer["question_id"], "Course concepts")
            result = topic_results[student_id].setdefault(concept, [0, 0])
            result[1] += 1
            if answer["is_correct"]:
                result[0] += 1
        confidence_gaps = _confidence_gap_records(answers, attempt_student, concepts, attempt_dates)
        citation_map = await _misconception_course_citations(client, base, headers, misconceptions)
        graph_topics_response = await client.get(
            f"{base}/rest/v1/course_topics", headers=headers,
            params={"course_id": f"eq.{course_id}", "select": "id,name"},
        )
        graph_topics_response.raise_for_status()
        graph_links_response = await client.get(
            f"{base}/rest/v1/course_topic_prerequisites", headers=headers,
            params={"course_id": f"eq.{course_id}", "select": "topic_id,prerequisite_topic_id,reason,confidence,evidence"},
        )
        if graph_links_response.status_code == 400:
            graph_links_response = await client.get(
                f"{base}/rest/v1/course_topic_prerequisites", headers=headers,
                params={"course_id": f"eq.{course_id}", "select": "topic_id,prerequisite_topic_id"},
            )
        graph_links_response.raise_for_status()
        graph_links = [{"evidence": [], **row} for row in graph_links_response.json()]
        mastery_response = await client.get(
            f"{base}/rest/v1/student_concept_mastery", headers=headers,
            params={
                "course_id": f"eq.{course_id}",
                "select": "student_id,concept,mastery_score,total_answers,completed_teach_backs,open_misconceptions",
            },
        )
        mastery_response.raise_for_status()
        mastery_by_student: dict[str, list[dict]] = {}
        for row in mastery_response.json():
            mastery_by_student.setdefault(row["student_id"], []).append(row)
        prerequisite_signals = [{
            "student_id": item["student_id"], "concept": item["concept"],
            "detected_at": item.get("last_detected_at") or item.get("created_at"),
            "citations": citation_map.get(item["id"], []),
        } for item in misconceptions if item.get("status") == "open" or item.get("retention_status") == "needs_review"]
        prerequisite_signals.extend({
            "student_id": gap["student_id"], "concept": gap["concept"],
            "detected_at": gap.get("last_detected_at"), "citations": [],
        } for gap in confidence_gaps)
        prerequisite_gaps = _prerequisite_gap_records(
            prerequisite_signals, mastery_by_student, graph_topics_response.json(), graph_links,
        )
        interventions = _intervention_queue(
            misconceptions, study_plan_response.json(), names, now, citation_map, confidence_gaps, prerequisite_gaps,
        )
        misconception_topics: dict[str, list[str]] = {student_id: [] for student_id in student_ids}
        for item in open_misconceptions:
            misconception_topics.setdefault(item["student_id"], []).append(item["concept"])
        students = []
        for student_id in student_ids:
            student_attempts = attempts_by_student.get(student_id, [])
            average = round(sum(float(row["score"]) for row in student_attempts) / len(student_attempts)) if student_attempts else 0
            weak = [topic for topic, (correct, total) in topic_results.get(student_id, {}).items() if correct * 100 / total < 70]
            weak = list(dict.fromkeys([*misconception_topics.get(student_id, []), *weak]))[:3]
            status_value = "struggling" if student_attempts and average < 50 else "excelling" if average >= 80 else "active"
            students.append({"id": student_id, "name": names.get(student_id, "Student"), "progress": average, "quizzes": len(student_attempts), "weak": weak, "status": status_value, "overdue_tasks": overdue_by_student.get(student_id, 0)})
        completed_scores = [float(row["score"]) for row in attempts]
        today = datetime.now(UTC).date()
        attention = [{
            "id": item["id"], "student_id": item["student_id"], "student": names.get(item["student_id"], "Student"),
            "concept": item["concept"], "issue": item["explanation"], "status": item["status"], "created_at": item["created_at"],
        } for item in open_misconceptions[:5]]
        class_topics: dict[str, list[int]] = {}
        for student_topics in topic_results.values():
            for topic, (correct, total) in student_topics.items():
                aggregate = class_topics.setdefault(topic, [0, 0])
                aggregate[0] += correct
                aggregate[1] += total
        return {
            "active_students": len(student_ids),
            "average_score": round(sum(completed_scores) / len(completed_scores)) if completed_scores else 0,
            "open_flags": len(open_misconceptions),
            "overdue_study_tasks": len(overdue_plans),
            "quizzes_today": sum(datetime.fromisoformat(row["completed_at"].replace("Z", "+00:00")).date() == today for row in attempts),
            "document_count": len(materials_response.json()),
            "students": students,
            "attention": attention,
            "intervention_queue": interventions,
            "misconception_network": _class_misconception_network(misconceptions),
            "topic_scores": sorted(
                [{"topic": topic, "score": round(correct * 100 / total)} for topic, (correct, total) in class_topics.items()],
                key=lambda row: row["score"],
            ),
            "misconceptions": [{**item, "student": names.get(item["student_id"], "Student")} for item in misconceptions],
        }


@router.get("/teacher/{course_id}/mastery-journeys")
async def teacher_mastery_journeys(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        course_response = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"eq.{course_id}", "teacher_id": f"eq.{user.id}", "select": "id"},
        )
        course_response.raise_for_status()
        if not course_response.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can view mastery journeys")

        misconceptions_response = await client.get(
            f"{base}/rest/v1/misconceptions", headers=headers,
            params={
                "course_id": f"eq.{course_id}",
                "select": "id,student_id,concept,label,student_evidence,explanation,learning_status,created_at,verified_at,retention_status,retention_due_at,retained_at",
                "order": "created_at.desc",
            },
        )
        misconceptions_response.raise_for_status()
        misconceptions = misconceptions_response.json()
        if not misconceptions:
            return {"summary": {"detected": 0, "improving": 0, "verified": 0, "retained": 0, "verification_rate": 0}, "journeys": []}

        student_ids = list(dict.fromkeys(item["student_id"] for item in misconceptions))
        profiles_response = await client.get(
            f"{base}/rest/v1/profiles", headers=headers,
            params={"id": f"in.({','.join(student_ids)})", "select": "id,display_name"},
        )
        profiles_response.raise_for_status()
        names = {row["id"]: row["display_name"] for row in profiles_response.json()}

        verification_response = await client.get(
            f"{base}/rest/v1/misconception_verifications", headers=headers,
            params={
                "course_id": f"eq.{course_id}",
                "select": "id,misconception_id,verdict,feedback,created_at,completed_at",
                "order": "created_at.desc",
            },
        )
        verification_response.raise_for_status()
        attempts_by_misconception: dict[str, list[dict]] = {}
        for attempt in verification_response.json():
            attempts_by_misconception.setdefault(attempt["misconception_id"], []).append(attempt)

        retention_response = await client.get(
            f"{base}/rest/v1/retention_checks", headers=headers,
            params={
                "course_id": f"eq.{course_id}",
                "select": "id,misconception_id,verdict,feedback,created_at,completed_at",
                "order": "created_at.desc",
            },
        )
        retention_response.raise_for_status()
        retention_by_misconception: dict[str, list[dict]] = {}
        for check in retention_response.json():
            retention_by_misconception.setdefault(check["misconception_id"], []).append(check)

        mastery_response = await client.get(
            f"{base}/rest/v1/student_concept_mastery", headers=headers,
            params={
                "course_id": f"eq.{course_id}",
                "select": "student_id,concept,mastery_score,confidence,correct_answers,total_answers,open_misconceptions,completed_teach_backs,verified_teach_backs,updated_at",
            },
        )
        mastery_response.raise_for_status()
        mastery = {
            (row["student_id"], row["concept"].casefold()): row
            for row in mastery_response.json()
        }

        journeys = []
        for group in group_concept_records(misconceptions):
            item = group[0]
            attempts = sorted(
                (attempt for related in group for attempt in attempts_by_misconception.get(related["id"], [])),
                key=lambda attempt: attempt["created_at"], reverse=True,
            )
            latest = attempts[0] if attempts else None
            retention_checks = sorted(
                (check for related in group for check in retention_by_misconception.get(related["id"], [])),
                key=lambda check: check["created_at"], reverse=True,
            )
            concept_mastery = next((
                mastery.get((related["student_id"], related["concept"].casefold()))
                for related in group
                if mastery.get((related["student_id"], related["concept"].casefold()))
            ), None)
            weighted_evidence = evidence_count(
                concept_mastery["total_answers"] if concept_mastery else 0,
                concept_mastery["completed_teach_backs"] if concept_mastery else 0,
            )
            journeys.append({
                **item,
                "concept": friendly_concept(item["concept"]),
                "student": names.get(item["student_id"], "Student"),
                "mastery_score": float(concept_mastery["mastery_score"]) if concept_mastery and weighted_evidence >= 3 else None,
                "confidence": float(concept_mastery["confidence"]) if concept_mastery else 0,
                "correct_answers": concept_mastery["correct_answers"] if concept_mastery else 0,
                "total_answers": concept_mastery["total_answers"] if concept_mastery else 0,
                "evidence_count": weighted_evidence,
                "evidence_sufficient": weighted_evidence >= 3,
                "teach_back_attempts": len(attempts),
                "related_records": len(group),
                "latest_verdict": latest["verdict"] if latest else None,
                "latest_feedback": latest["feedback"] if latest else None,
                "last_attempt_at": latest["completed_at"] if latest else None,
                "retention_checks": len(retention_checks),
            })

        detected = sum(item["learning_status"] == "open" for item in journeys)
        improving = sum(item["learning_status"] == "improving" for item in journeys)
        retained = sum(item["retention_status"] == "retained" for item in journeys)
        verified = sum(
            item["learning_status"] == "verified" and item["retention_status"] != "retained"
            for item in journeys
        )
        return {
            "summary": {
                "detected": detected,
                "improving": improving,
                "verified": verified,
                "retained": retained,
                "verification_rate": round((verified + retained) * 100 / len(journeys)),
            },
            "journeys": journeys,
        }


@router.patch("/teacher/{course_id}/misconceptions/{misconception_id}")
async def address_misconception(
    course_id: UUID,
    misconception_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        course_response = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"eq.{course_id}", "teacher_id": f"eq.{user.id}", "select": "id"},
        )
        course_response.raise_for_status()
        if not course_response.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can update misconceptions")
        response = await client.patch(
            f"{base}/rest/v1/misconceptions", headers=headers,
            params={"id": f"eq.{misconception_id}", "course_id": f"eq.{course_id}"},
            json={"status": "addressed", "reviewed_by": user.id, "reviewed_at": datetime.now(UTC).isoformat()},
        )
        response.raise_for_status()
        if not response.json():
            raise HTTPException(status_code=404, detail="Misconception not found")
        misconception = response.json()[0]
        await create_notification(
            client, base, headers,
            recipient_id=misconception["student_id"], course_id=str(course_id),
            notification_type="misconception", title="Misconception reviewed",
            body=f"Your teacher reviewed your {misconception['concept']} misconception in {course_response.json()[0]['name']}.",
            metadata={"misconception_id": str(misconception_id)},
        )
        return misconception


@router.get("/teacher/{course_id}/students/{student_id}/progress")
async def teacher_student_progress(
    course_id: UUID,
    student_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        course_response = await client.get(
            f"{base}/rest/v1/courses", headers=headers,
            params={"id": f"eq.{course_id}", "teacher_id": f"eq.{user.id}", "select": "id"},
        )
        course_response.raise_for_status()
        if not course_response.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can view student progress")
        enrollment_response = await client.get(
            f"{base}/rest/v1/enrollments", headers=headers,
            params={"course_id": f"eq.{course_id}", "student_id": f"eq.{student_id}", "status": "eq.approved", "select": "id"},
        )
        enrollment_response.raise_for_status()
        if not enrollment_response.json():
            raise HTTPException(status_code=404, detail="Approved student not found in this course")
        profile_response = await client.get(
            f"{base}/rest/v1/profiles", headers=headers,
            params={"id": f"eq.{student_id}", "select": "display_name"},
        )
        profile_response.raise_for_status()
        name = profile_response.json()[0]["display_name"] if profile_response.json() else "Student"
        quizzes_response = await client.get(
            f"{base}/rest/v1/quizzes", headers=headers,
            params={"course_id": f"eq.{course_id}", "student_id": f"eq.{student_id}", "select": "id,title"},
        )
        quizzes_response.raise_for_status()
        quiz_map = {row["id"]: row["title"] for row in quizzes_response.json()}
        attempts = []
        answers = []
        concept_by_question: dict[str, str] = {}
        if quiz_map:
            quiz_filter = f"in.({','.join(quiz_map)})"
            attempts_response = await client.get(
                f"{base}/rest/v1/quiz_attempts", headers=headers,
                params={"quiz_id": quiz_filter, "student_id": f"eq.{student_id}", "completed_at": "not.is.null", "select": "id,quiz_id,score,completed_at", "order": "completed_at.desc"},
            )
            attempts_response.raise_for_status()
            attempts = attempts_response.json()
            questions_response = await client.get(
                f"{base}/rest/v1/quiz_questions", headers=headers,
                params={"quiz_id": quiz_filter, "select": "id,concept"},
            )
            questions_response.raise_for_status()
            concept_by_question = {row["id"]: row["concept"] for row in questions_response.json()}
            if attempts:
                answers_response = await client.get(
                    f"{base}/rest/v1/quiz_answers", headers=headers,
                    params={"attempt_id": f"in.({','.join(row['id'] for row in attempts)})", "select": "attempt_id,question_id,is_correct"},
                )
                answers_response.raise_for_status()
                answers = answers_response.json()
        topic_totals: dict[str, list[int]] = {}
        attempt_totals: dict[str, list[int]] = {}
        for answer in answers:
            concept = concept_by_question.get(answer["question_id"], "Course concepts")
            topic_totals.setdefault(concept, [0, 0])
            topic_totals[concept][1] += 1
            attempt_totals.setdefault(answer["attempt_id"], [0, 0])
            attempt_totals[answer["attempt_id"]][1] += 1
            if answer["is_correct"]:
                topic_totals[concept][0] += 1
                attempt_totals[answer["attempt_id"]][0] += 1
        topic_scores = sorted(
            [{"topic": topic, "score": round(correct * 100 / total)} for topic, (correct, total) in topic_totals.items()],
            key=lambda row: row["score"],
        )
        misconceptions_response = await client.get(
            f"{base}/rest/v1/misconceptions", headers=headers,
            params={"course_id": f"eq.{course_id}", "student_id": f"eq.{student_id}", "select": "id,concept,explanation,status,created_at", "order": "created_at.desc"},
        )
        misconceptions_response.raise_for_status()
        scores = [float(row["score"]) for row in attempts]
        return {
            "student_id": str(student_id), "name": name,
            "average_score": round(sum(scores) / len(scores)) if scores else 0,
            "quiz_count": len(attempts), "weak_topics": [row["topic"] for row in topic_scores if row["score"] < 70],
            "topic_scores": topic_scores,
            "attempts": [{
                "id": row["id"], "title": quiz_map.get(row["quiz_id"], "Course quiz"), "score": round(float(row["score"])),
                "correct": attempt_totals.get(row["id"], [0, 0])[0], "total": attempt_totals.get(row["id"], [0, 0])[1], "completed_at": row["completed_at"],
            } for row in attempts],
            "misconceptions": misconceptions_response.json(),
        }


@router.post("/{course_id}/quizzes/generate", response_model=GeneratedQuiz)
async def generate_quiz(
    course_id: UUID,
    request: GenerateQuizRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> GeneratedQuiz:
    configured = embedding_client(settings)
    if not configured:
        raise HTTPException(status_code=503, detail="Semantic retrieval is not configured")
    if not (settings.azure_openai_endpoint and settings.azure_openai_api_key and settings.azure_openai_tier2_deployment):
        raise HTTPException(status_code=503, detail="Quiz model is not configured")
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
    base = settings.supabase_url.rstrip("/")
    course_id_string = str(course_id)
    async with httpx.AsyncClient(timeout=60) as client:
        if not await _course_access(client, base, headers, course_id_string, user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        preference_response = await client.get(
            f"{base}/rest/v1/user_preferences", headers=headers,
            params={"user_id": f"eq.{user.id}", "select": "preferences", "limit": "1"},
        )
        preference_response.raise_for_status()
        stored_preferences = preference_response.json()[0].get("preferences", {}) if preference_response.json() else {}
        difficulty_mode = stored_preferences.get("difficulty", "adaptive") if isinstance(stored_preferences, dict) else "adaptive"
        if difficulty_mode not in {"easy", "adaptive", "hard"}:
            difficulty_mode = "adaptive"
        misconception_response = await client.get(
            f"{base}/rest/v1/misconceptions", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "student_id": f"eq.{user.id}", "status": "eq.open", "select": "concept", "order": "confidence.desc", "limit": "3"},
        )
        misconception_response.raise_for_status()
        focus_concept = request.focus_concept.strip() if request.focus_concept else ""
        misconception_rows = misconception_response.json()
        graph_focus_concept = focus_concept or (misconception_rows[0]["concept"] if misconception_rows else "")
        prerequisite_concepts: list[str] = []
        if graph_focus_concept:
            topics_response = await client.get(
                f"{base}/rest/v1/course_topics", headers=headers,
                params={"course_id": f"eq.{course_id_string}", "select": "id,name"},
            )
            topics_response.raise_for_status()
            if topics_response.json():
                prerequisite_response = await client.get(
                    f"{base}/rest/v1/course_topic_prerequisites", headers=headers,
                    params={"course_id": f"eq.{course_id_string}", "select": "topic_id,prerequisite_topic_id"},
                )
                if prerequisite_response.is_success:
                    prerequisite_concepts = _prerequisite_concepts(
                        graph_focus_concept, topics_response.json(), prerequisite_response.json(),
                    )
        weak_concepts = list(dict.fromkeys([
            *prerequisite_concepts,
            *([focus_concept] if focus_concept else []),
            *(row["concept"] for row in misconception_rows),
        ]))[:3]
        embedding_api, embedding_model = configured
        query = (
            f"formative practice for weak concepts: {', '.join(weak_concepts)}"
            if weak_concepts
            else "important concepts, definitions, mechanisms, comparisons, and applications for a formative quiz"
        )
        vector = (await embedding_api.embeddings.create(model=embedding_model, input=query, encoding_format="float")).data[0].embedding
        matches_response = await client.post(
            f"{base}/rest/v1/rpc/match_course_material_chunks", headers=headers,
            json={"query_embedding": vector, "target_course_id": course_id_string, "match_count": 6},
        )
        matches_response.raise_for_status()
        matches = matches_response.json()
        if not matches:
            raise HTTPException(status_code=422, detail="No indexed course material is available for a quiz")
        evidence = [EvidenceChunk(
            chunk_id=row["chunk_id"], document_id=row["material_id"], document_title=row["material_title"],
            page_number=row["page_number"], content=row["content"],
        ) for row in matches]
        provider = AzureOpenAIProvider(
            endpoint=settings.azure_openai_endpoint, api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
            fast_deployment=settings.azure_openai_tier1_deployment,
            reasoning_deployment=settings.azure_openai_tier2_deployment,
        )
        try:
            result = await generate_verified_quiz(
                provider, evidence,
                question_count=request.question_count,
                difficulty_mode=difficulty_mode,
                difficulty_instruction=_difficulty_instruction(difficulty_mode),
                focus_concept=graph_focus_concept or None,
                prerequisite_concepts=prerequisite_concepts,
                priority_concepts=weak_concepts,
            )
        except QuizVerificationError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
        result = shuffle_verified_quiz(result)

        quiz_response = await client.post(
            f"{base}/rest/v1/quizzes", headers=headers,
            json={
                "course_id": course_id_string, "student_id": user.id, "title": result.title,
                "target_concepts": list(dict.fromkeys([*([focus_concept] if focus_concept else []), *(q.concept for q in result.questions)])),
                "created_by": "ai",
            },
        )
        quiz_response.raise_for_status()
        quiz = quiz_response.json()[0]
        questions_response = await client.post(
            f"{base}/rest/v1/quiz_questions", headers=headers,
            json=[{
                "quiz_id": quiz["id"], "position": index, "prompt": question.prompt, "options": question.options,
                "correct_option": question.correct_option, "explanation": question.explanation,
                "concept": question.concept, "difficulty": question.difficulty,
            } for index, question in enumerate(result.questions)],
        )
        questions_response.raise_for_status()
        stored = sorted(questions_response.json(), key=lambda row: row["position"])
        return GeneratedQuiz(
            id=quiz["id"], title=result.title, difficulty_mode=difficulty_mode,
            focus_concept=graph_focus_concept or None, prerequisite_concepts=prerequisite_concepts,
            questions=[GeneratedQuestion(
            id=row["id"], prompt=question.prompt, options=question.options, correct_option=question.correct_option,
            explanation=question.explanation, concept=question.concept, difficulty=question.difficulty,
            citations=[QuizCitation(
                chunk_id=c.chunk_id,
                document_title=c.document_title, page_number=c.page_number,
                source_kind=_source_kind(c.document_title, c.page_number),
            ) for c in question.citations],
        ) for row, question in zip(stored, result.questions, strict=True)])


@router.post("/{course_id}/quizzes/{quiz_id}/submit")
async def submit_quiz(
    course_id: UUID,
    quiz_id: UUID,
    request: SubmitQuizRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    key = settings.supabase_service_role_key
    base = settings.supabase_url.rstrip("/")
    if not base or not key:
        raise HTTPException(status_code=503, detail="Quiz submission is not configured")

    # The database checks ownership, commits grading and evidence together, and
    # returns the stored result when this private quiz is submitted again.
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            result = await client.post(
                f"{base}/rest/v1/rpc/submit_quiz_once",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                json={
                    "p_course_id": str(course_id),
                    "p_quiz_id": str(quiz_id),
                    "p_student_id": user.id,
                    "p_answers": request.answers,
                    "p_confidences": request.confidences,
                },
            )
        except httpx.RequestError as error:
            logger.warning("Quiz submission database request failed (%s)", type(error).__name__)
            raise HTTPException(
                status_code=503, detail="Quiz submission could not be confirmed. Try again.",
            ) from error

    if result.is_success:
        return result.json()

    try:
        error_payload = result.json()
    except ValueError:
        error_payload = {}
    code = error_payload.get("code") if isinstance(error_payload, dict) else None
    status_codes = {"PT400": 400, "PT403": 403, "PT404": 404}
    if code in status_codes:
        raise HTTPException(status_code=status_codes[code], detail=error_payload["message"])

    logger.error("Quiz submission database rejected the request (HTTP %s, code=%r)", result.status_code, code)
    raise HTTPException(status_code=503, detail="Quiz submission is temporarily unavailable. Try again.")
