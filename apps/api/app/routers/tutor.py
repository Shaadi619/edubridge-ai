import json
import logging
import re
from datetime import UTC, datetime
from math import isfinite
from time import perf_counter
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai.azure_provider import AzureOpenAIProvider
from app.ai.contracts import (
    AITier, Citation, EvidenceChunk, GroundedExplanationDraft, MisconceptionAnalysis,
    TutorAnswer, TutorDraft,
)
from app.ai.embeddings import embedding_client
from app.ai.evidence import normalize_whitespace, quoted_chunks
from app.ai.prompts import ALTERNATIVE_EXPLANATION_SYSTEM_PROMPT, TUTOR_SYSTEM_PROMPT
from app.auth import AuthenticatedUser, current_user
from app.concepts import friendly_concept
from app.config import Settings, get_settings
from app.mastery import change_misconception_evidence
from app.routers.notifications import create_notification

router = APIRouter(prefix="/courses", tags=["tutor"])
logger = logging.getLogger(__name__)

NO_INDEXED_EVIDENCE = (
    "I couldn't find indexed materials for this course yet. "
    "Ask your teacher whether the relevant notes have been uploaded and processed."
)
INSUFFICIENT_EVIDENCE = (
    "I couldn't find enough support in the course materials to answer reliably. "
    "Try naming the specific concept, chapter, or lecture you're working from."
)


def _source_kind(title: str, page_number: int | None) -> str:
    lower_title = title.lower()
    if lower_title.endswith((".ppt", ".pptx")):
        return "slide"
    if lower_title.endswith((".doc", ".docx")):
        return "document"
    if page_number is not None:
        return "page"
    return "document"


def _remove_internal_references(text: str) -> str:
    """Keep retrieval identifiers out of student-facing prose."""
    uuid = r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    cleaned = re.sub(rf"\s*\((?:see\s+)?chunk\s+{uuid}\)", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*\((?:see\s+)?chunk\s+[a-z0-9_-]{6,}\)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(rf"\b(?:see\s+)?chunk\s+(?:{uuid}|[a-z0-9_-]{{6,}})\b", "the course material", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*\[\s*\{.*?\"chunk_id\".*?\}\s*\]", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    return cleaned.strip()


def _select_evidence(matches: list[dict], minimum_similarity: float) -> list[EvidenceChunk]:
    evidence: list[EvidenceChunk] = []
    seen_ids: set[str] = set()
    seen_text: set[str] = set()
    for row in matches:
        similarity = row.get("similarity")
        if not isinstance(similarity, (float, int)) or not isfinite(similarity) or similarity < minimum_similarity:
            continue
        text = normalize_whitespace(row["content"])
        if not text or row["chunk_id"] in seen_ids or text in seen_text:
            continue
        evidence.append(EvidenceChunk(
            chunk_id=row["chunk_id"], document_id=row["material_id"],
            document_title=row["material_title"], page_number=row["page_number"],
            content=row["content"],
        ))
        seen_ids.add(row["chunk_id"])
        seen_text.add(text)
        if len(evidence) == 4:
            break
    return evidence


async def _match_evidence(
    client: httpx.AsyncClient,
    base: str,
    headers: dict,
    course_id: str,
    vector: list[float],
    minimum_similarity: float,
) -> tuple[list[EvidenceChunk], str]:
    response = await client.post(
        f"{base}/rest/v1/rpc/match_course_material_chunks", headers=headers,
        json={"query_embedding": vector, "target_course_id": course_id, "match_count": 8},
    )
    response.raise_for_status()
    matches = response.json()
    return _select_evidence(matches, minimum_similarity), (
        INSUFFICIENT_EVIDENCE if matches else NO_INDEXED_EVIDENCE
    )


def _validated_explanation(
    draft: GroundedExplanationDraft, evidence: dict[str, EvidenceChunk],
) -> tuple[str, list[Citation]] | None:
    if not draft.grounded or not 1 <= len(draft.sections) <= 3:
        return None
    text: list[str] = []
    citations: dict[str, Citation] = {}
    for section in draft.sections:
        paragraph = _remove_internal_references(section.text)
        supports = quoted_chunks(section.sources, evidence)
        if not paragraph or not supports:
            return None
        text.append(paragraph)
        for source in supports:
            if source.chunk_id not in citations:
                citations[source.chunk_id] = Citation(
                    chunk_id=source.chunk_id, document_id=source.document_id,
                    document_title=source.document_title, page_number=source.page_number,
                    source_kind=_source_kind(source.document_title, source.page_number),
                )
            if len(citations) > 3:
                return None
    return "\n\n".join(text), list(citations.values())


def _student_quote_matches(quote: str | None, question: str) -> bool:
    text = normalize_whitespace(quote or "")
    return any(character.isalnum() for character in text) and text in normalize_whitespace(question)


def _tutor_decline(message: str) -> TutorAnswer:
    return TutorAnswer(
        answer=message, citations=[],
        misconception=MisconceptionAnalysis(detected=False, confidence=0), grounded=False,
    )


def _validated_tutor_answer(
    draft: TutorDraft, question: str, chunks: list[EvidenceChunk],
) -> TutorAnswer:
    evidence = {item.chunk_id: item for item in chunks}
    explanation = _validated_explanation(draft, evidence)
    if explanation is None:
        return _tutor_decline(INSUFFICIENT_EVIDENCE)
    answer, citations = explanation
    analysis = draft.misconception
    misconception_supported = (
        analysis.detected and analysis.confidence >= 0.8
        and bool(analysis.explanation)
        and bool(analysis.concept or analysis.label)
        and _student_quote_matches(analysis.evidence_from_student, question)
        and bool(quoted_chunks(draft.misconception_sources, evidence))
    )
    return TutorAnswer(
        answer=answer, citations=citations, grounded=True,
        misconception=analysis if misconception_supported else MisconceptionAnalysis(detected=False, confidence=0),
    )


def _normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip(" \t\n\r\"'.,:;!?-")


def _same_concept(left: str, right: str) -> bool:
    def tokens(value: str) -> set[str]:
        ignored = {"and", "or", "the", "a", "an", "of", "vs", "versus", "processing", "concept"}
        return {token.removesuffix("s") for token in re.findall(r"[a-z0-9]+", value.lower()) if token not in ignored}

    left_tokens, right_tokens = tokens(left), tokens(right)
    if not left_tokens or not right_tokens:
        return _normalized(left) == _normalized(right)
    overlap = len(left_tokens & right_tokens)
    return overlap >= 2 and overlap / min(len(left_tokens), len(right_tokens)) >= 0.6


async def _persist_misconception(
    client: httpx.AsyncClient,
    base: str,
    headers: dict,
    course_id: str,
    student_id: str,
    source_message_id: str,
    question: str,
    answer: TutorAnswer,
) -> None:
    analysis = answer.misconception
    evidence = analysis.evidence_from_student or ""
    evidence_matches = _student_quote_matches(evidence, question)
    concept = friendly_concept(analysis.concept or analysis.label or "")
    label = analysis.label or analysis.concept
    if not (answer.grounded and analysis.detected and analysis.confidence >= 0.8 and concept and label and analysis.explanation and evidence_matches):
        logger.info(
            "Misconception not persisted detected=%s confidence=%.3f evidence_matches=%s concept=%s label=%s",
            analysis.detected, analysis.confidence, evidence_matches, bool(concept), bool(label),
        )
        return
    profile = await client.get(
        f"{base}/rest/v1/profiles", headers=headers,
        params={"id": f"eq.{student_id}", "role": "eq.student", "select": "id"},
    )
    profile.raise_for_status()
    if not profile.json():
        return
    existing = await client.get(
        f"{base}/rest/v1/misconceptions", headers=headers,
        params={"course_id": f"eq.{course_id}", "student_id": f"eq.{student_id}", "status": "neq.dismissed", "select": "id,concept,label,occurrence_count,learning_status"},
    )
    supports_count = existing.is_success
    if not supports_count:
        existing = await client.get(
            f"{base}/rest/v1/misconceptions", headers=headers,
            params={"course_id": f"eq.{course_id}", "student_id": f"eq.{student_id}", "status": "neq.dismissed", "select": "id,concept,label,learning_status"},
        )
    existing.raise_for_status()
    match = next((row for row in existing.json() if _same_concept(row["concept"], concept) or _same_concept(row["label"], label)), None)
    now = datetime.now(UTC).isoformat()
    if match:
        was_verified = match.get("learning_status") == "verified"
        payload = {
            "source_message_id": source_message_id,
            "explanation": analysis.explanation,
            "student_evidence": evidence,
            "confidence": max(0, min(1, analysis.confidence)),
            "recommended_intervention": analysis.recommended_intervention,
            "status": "open",
            "learning_status": "open",
            "verified_at": None,
            **({"occurrence_count": match.get("occurrence_count", 1) + 1, "last_detected_at": now} if supports_count else {}),
        }
        response = await client.patch(f"{base}/rest/v1/misconceptions?id=eq.{match['id']}", headers=headers, json=payload)
        response.raise_for_status()
        if was_verified:
            await change_misconception_evidence(
                client, base, headers,
                course_id=course_id, student_id=student_id, concept=match["concept"], delta=1,
            )
        return
    payload = {
        "course_id": course_id, "student_id": student_id, "source_message_id": source_message_id,
        "concept": concept, "label": label, "explanation": analysis.explanation,
        "student_evidence": evidence, "confidence": analysis.confidence,
        "recommended_intervention": analysis.recommended_intervention,
        **({"occurrence_count": 1, "last_detected_at": now} if supports_count else {}),
    }
    response = await client.post(f"{base}/rest/v1/misconceptions", headers=headers, json=payload)
    response.raise_for_status()
    await change_misconception_evidence(
        client, base, headers,
        course_id=course_id, student_id=student_id, concept=concept, delta=1,
    )
    course = await client.get(
        f"{base}/rest/v1/courses", headers=headers,
        params={"id": f"eq.{course_id}", "select": "teacher_id,name"},
    )
    course.raise_for_status()
    if course.json():
        await create_notification(
            client, base, headers, recipient_id=course.json()[0]["teacher_id"], course_id=course_id,
            notification_type="misconception", title="New misconception detected",
            body=f"A student may need help with {concept} in {course.json()[0]['name']}.",
            metadata={"misconception_id": response.json()[0]["id"], "student_id": student_id},
        )


class TutorQuery(BaseModel):
    question: str = Field(min_length=2, max_length=4000)
    conversation_id: UUID | None = None


class TutorResponse(BaseModel):
    conversation_id: str
    answer: TutorAnswer


ExplanationFormat = Literal["simpler", "analogy", "worked_example", "visual_outline"]


class AlternativeExplanationRequest(BaseModel):
    question: str = Field(min_length=2, max_length=4000)
    format: ExplanationFormat


class FriendlyTutorCitation(BaseModel):
    chunk_id: str
    document_title: str
    page_number: int | None
    source_kind: Literal["page", "slide", "document"]


class AlternativeExplanationResponse(BaseModel):
    format: ExplanationFormat
    answer: str
    citations: list[FriendlyTutorCitation]
    grounded: bool


async def _course_access(client: httpx.AsyncClient, base: str, headers: dict, course_id: str, user_id: str) -> bool:
    courses = await client.get(
        f"{base}/rest/v1/courses", headers=headers,
        params={"id": f"eq.{course_id}", "select": "teacher_id"},
    )
    courses.raise_for_status()
    rows = courses.json()
    if not rows:
        raise HTTPException(status_code=404, detail="Course not found")
    if rows[0]["teacher_id"] == user_id:
        return True
    enrollment = await client.get(
        f"{base}/rest/v1/enrollments", headers=headers,
        params={"course_id": f"eq.{course_id}", "student_id": f"eq.{user_id}", "status": "eq.approved", "select": "id", "limit": "1"},
    )
    enrollment.raise_for_status()
    return bool(enrollment.json())


@router.post("/{course_id}/tutor", response_model=TutorResponse)
async def tutor(
    course_id: UUID,
    request: TutorQuery,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> TutorResponse:
    started = perf_counter()
    configured = embedding_client(settings)
    if not configured:
        raise HTTPException(status_code=503, detail="Semantic retrieval is not configured")
    if not (settings.azure_openai_endpoint and settings.azure_openai_api_key and settings.azure_openai_tier2_deployment):
        raise HTTPException(status_code=503, detail="Tutor model is not configured")
    course_id_string = str(course_id)
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=60) as client:
        if not await _course_access(client, base, headers, course_id_string, user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        conversation_id = str(request.conversation_id) if request.conversation_id else ""
        if conversation_id:
            conversation = await client.get(
                f"{base}/rest/v1/conversations", headers=headers,
                params={"id": f"eq.{conversation_id}", "course_id": f"eq.{course_id_string}", "student_id": f"eq.{user.id}", "select": "id"},
            )
            conversation.raise_for_status()
            if not conversation.json():
                raise HTTPException(status_code=404, detail="Conversation not found")
        embedding_api, embedding_model = configured
        query_vector = (await embedding_api.embeddings.create(
            model=embedding_model, input=request.question, encoding_format="float"
        )).data[0].embedding
        embedded_at = perf_counter()
        evidence, reason = await _match_evidence(
            client, base, headers, course_id_string, query_vector, settings.tutor_min_similarity,
        )
        retrieved_at = perf_counter()
        if evidence:
            provider = AzureOpenAIProvider(
                endpoint=settings.azure_openai_endpoint, api_key=settings.azure_openai_api_key,
                api_version=settings.azure_openai_api_version,
                fast_deployment=settings.azure_openai_tier1_deployment,
                reasoning_deployment=settings.azure_openai_tier2_deployment,
            )
            draft = await provider.generate_structured(
                tier=AITier.REASONING, system_prompt=TUTOR_SYSTEM_PROMPT,
                user_prompt=json.dumps({
                    "student_question": request.question,
                    "course_evidence": [
                        {"chunk_id": item.chunk_id, "content": item.content} for item in evidence
                    ],
                }),
                output_type=TutorDraft,
            )
            answer = _validated_tutor_answer(draft, request.question, evidence)
        else:
            answer = _tutor_decline(reason)
        generated_at = perf_counter()

        if not conversation_id:
            created = await client.post(
                f"{base}/rest/v1/conversations", headers=headers,
                json={"course_id": course_id_string, "student_id": user.id, "title": request.question[:120]},
            )
            created.raise_for_status()
            conversation_id = created.json()[0]["id"]
        student_message = await client.post(
            f"{base}/rest/v1/messages", headers=headers,
            json={"conversation_id": conversation_id, "author_role": "student", "content": request.question},
        )
        student_message.raise_for_status()
        student_message_id = student_message.json()[0]["id"]
        assistant = await client.post(
            f"{base}/rest/v1/messages", headers=headers,
            json={
                "conversation_id": conversation_id, "author_role": "assistant",
                "content": answer.answer, "grounded": answer.grounded,
                "model_tier": "reasoning" if evidence else None,
            },
        )
        assistant.raise_for_status()
        message_id = assistant.json()[0]["id"]
        if answer.citations:
            citations = await client.post(
                f"{base}/rest/v1/message_citations", headers=headers,
                json=[{"message_id": message_id, "chunk_id": citation.chunk_id} for citation in answer.citations],
            )
            citations.raise_for_status()
        if answer.misconception.detected:
            try:
                await _persist_misconception(
                    client, base, headers, course_id_string, user.id, student_message_id, request.question, answer,
                )
            except (httpx.HTTPError, KeyError, TypeError, ValueError):
                logger.exception("Misconception persistence failed for course=%s user=%s", course_id_string, user.id)
        finished = perf_counter()
        logger.info(
            "Tutor latency course=%s user=%s candidates_used=%d grounded=%s embed_ms=%d retrieve_ms=%d generate_ms=%d persist_ms=%d total_ms=%d",
            course_id_string,
            user.id,
            len(evidence),
            answer.grounded,
            round((embedded_at - started) * 1000),
            round((retrieved_at - embedded_at) * 1000),
            round((generated_at - retrieved_at) * 1000),
            round((finished - generated_at) * 1000),
            round((finished - started) * 1000),
        )
        return TutorResponse(conversation_id=conversation_id, answer=answer)


@router.post("/{course_id}/tutor/explain-format", response_model=AlternativeExplanationResponse)
async def alternative_explanation(
    course_id: UUID,
    request: AlternativeExplanationRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> AlternativeExplanationResponse:
    configured = embedding_client(settings)
    if not configured:
        raise HTTPException(status_code=503, detail="Semantic retrieval is not configured")
    deployment = settings.azure_openai_tier1_deployment or settings.azure_openai_tier2_deployment
    if not (settings.azure_openai_endpoint and settings.azure_openai_api_key and deployment):
        raise HTTPException(status_code=503, detail="Adaptive explanations are not configured")

    format_instructions = {
        "simpler": "Use plain language, define unfamiliar terms, and explain the idea in at most four short points.",
        "analogy": "Use one familiar real-world analogy. Map each important part of the analogy to the course concept, then state one limit of the analogy.",
        "worked_example": "Give one small step-by-step worked example supported by the evidence. Explain why each step follows, without completing a live graded task for the student.",
        "visual_outline": "Create a compact text-based visual outline using indentation and arrows. Show the important sequence or relationships, followed by a two-sentence explanation.",
    }
    key = settings.supabase_service_role_key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    base = settings.supabase_url.rstrip("/")
    course_id_string = str(course_id)
    async with httpx.AsyncClient(timeout=60) as client:
        if not await _course_access(client, base, headers, course_id_string, user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        embedding_api, embedding_model = configured
        vector = (await embedding_api.embeddings.create(
            model=embedding_model,
            input=request.question,
            encoding_format="float",
        )).data[0].embedding
        evidence, reason = await _match_evidence(
            client, base, headers, course_id_string, vector, settings.tutor_min_similarity,
        )
        if not evidence:
            return AlternativeExplanationResponse(
                format=request.format, answer=reason, citations=[], grounded=False,
            )
        provider = AzureOpenAIProvider(
            endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
            fast_deployment=settings.azure_openai_tier1_deployment,
            reasoning_deployment=settings.azure_openai_tier2_deployment,
        )
        generated = await provider.generate_structured(
            tier=AITier.FAST if settings.azure_openai_tier1_deployment else AITier.REASONING,
            system_prompt=ALTERNATIVE_EXPLANATION_SYSTEM_PROMPT,
            user_prompt=json.dumps({
                "student_question": request.question,
                "requested_format": request.format,
                "format_instruction": format_instructions[request.format],
                "course_evidence": [
                    {"chunk_id": item.chunk_id, "content": item.content} for item in evidence
                ],
            }),
            output_type=GroundedExplanationDraft,
        )
        explanation = _validated_explanation(generated, {item.chunk_id: item for item in evidence})
        if explanation is None:
            return AlternativeExplanationResponse(
                format=request.format, answer=INSUFFICIENT_EVIDENCE, citations=[], grounded=False,
            )
        answer, citations = explanation
        return AlternativeExplanationResponse(
            format=request.format, answer=answer, grounded=True,
            citations=[FriendlyTutorCitation(
                chunk_id=item.chunk_id, document_title=item.document_title,
                page_number=item.page_number, source_kind=item.source_kind,
            ) for item in citations],
        )
