import json
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai.azure_provider import AzureOpenAIProvider
from app.ai.contracts import AITier, EvidenceChunk, TeacherInterventionDraft
from app.ai.embeddings import embedding_client
from app.ai.prompts import TEACHER_INTERVENTION_SYSTEM_PROMPT
from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.routers.tutor import _remove_internal_references, _source_kind

router = APIRouter(prefix="/courses/teacher", tags=["teacher interventions"])


class InterventionDraftRequest(BaseModel):
    concept: str = Field(min_length=1, max_length=160)
    reason: str = Field(min_length=1, max_length=1000)
    source: Literal["misconception", "retention", "study_plan", "confidence_gap", "prerequisite_gap"]
    downstream_concept: str | None = Field(default=None, max_length=160)


class FriendlyCitation(BaseModel):
    document_title: str
    page_number: int | None
    source_kind: Literal["page", "slide", "document"]


class InterventionDraftResponse(BaseModel):
    rationale: str
    recommended_action: str
    student_message: str
    talking_points: list[str]
    success_check: str
    citations: list[FriendlyCitation]


@router.post("/{course_id}/interventions/{student_id}/draft", response_model=InterventionDraftResponse)
async def draft_intervention(
    course_id: UUID,
    student_id: UUID,
    request: InterventionDraftRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> InterventionDraftResponse:
    configured = embedding_client(settings)
    if not configured:
        raise HTTPException(status_code=503, detail="Course evidence retrieval is not configured")
    if not (
        settings.azure_openai_endpoint
        and settings.azure_openai_api_key
        and settings.azure_openai_tier2_deployment
    ):
        raise HTTPException(status_code=503, detail="Intervention drafting is not configured")

    key = settings.supabase_service_role_key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    base = settings.supabase_url.rstrip("/")
    course_id_string = str(course_id)
    async with httpx.AsyncClient(timeout=75) as client:
        course_response = await client.get(
            f"{base}/rest/v1/courses",
            headers=headers,
            params={
                "id": f"eq.{course_id_string}",
                "teacher_id": f"eq.{user.id}",
                "select": "id,name",
                "limit": "1",
            },
        )
        course_response.raise_for_status()
        if not course_response.json():
            raise HTTPException(status_code=403, detail="Only the course teacher can draft interventions")
        enrollment_response = await client.get(
            f"{base}/rest/v1/enrollments",
            headers=headers,
            params={
                "course_id": f"eq.{course_id_string}",
                "student_id": f"eq.{student_id}",
                "status": "eq.approved",
                "select": "id",
                "limit": "1",
            },
        )
        enrollment_response.raise_for_status()
        if not enrollment_response.json():
            raise HTTPException(status_code=404, detail="This student is not enrolled in the course")

        search_text = " ".join(filter(None, [
            request.concept.strip(),
            request.downstream_concept.strip() if request.downstream_concept else None,
            request.reason.strip(),
        ]))
        embedding_api, embedding_model = configured
        vector = (await embedding_api.embeddings.create(
            model=embedding_model,
            input=search_text,
            encoding_format="float",
        )).data[0].embedding
        matches_response = await client.post(
            f"{base}/rest/v1/rpc/match_course_material_chunks",
            headers=headers,
            json={"query_embedding": vector, "target_course_id": course_id_string, "match_count": 8},
        )
        matches_response.raise_for_status()
        matches = matches_response.json()
        if not matches:
            raise HTTPException(status_code=422, detail="No indexed course evidence matches this learning need")
        evidence = [EvidenceChunk(
            chunk_id=row["chunk_id"],
            document_id=row["material_id"],
            document_title=row["material_title"],
            page_number=row["page_number"],
            content=row["content"],
        ) for row in matches]
        provider = AzureOpenAIProvider(
            endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
            fast_deployment=settings.azure_openai_tier1_deployment,
            reasoning_deployment=settings.azure_openai_tier2_deployment,
        )
        generated = await provider.generate_structured(
            tier=AITier.REASONING,
            system_prompt=TEACHER_INTERVENTION_SYSTEM_PROMPT,
            user_prompt=json.dumps({
                "course": course_response.json()[0]["name"],
                "learning_need": {
                    "concept": request.concept.strip(),
                    "reason": request.reason.strip(),
                    "source": request.source,
                    "downstream_concept": request.downstream_concept,
                },
                "course_evidence": [item.model_dump() for item in evidence],
            }),
            output_type=TeacherInterventionDraft,
        )

        canonical = {item.chunk_id: item for item in evidence}
        citations: list[FriendlyCitation] = []
        seen: set[tuple[str, int | None]] = set()
        for citation in generated.citations:
            source = canonical.get(citation.chunk_id)
            if not source:
                continue
            location = (source.document_id, source.page_number)
            if location in seen:
                continue
            seen.add(location)
            citations.append(FriendlyCitation(
                document_title=source.document_title,
                page_number=source.page_number,
                source_kind=_source_kind(source.document_title, source.page_number),
            ))
        if not citations:
            raise HTTPException(status_code=422, detail="The intervention could not be grounded well enough")
        return InterventionDraftResponse(
            rationale=_remove_internal_references(generated.rationale),
            recommended_action=_remove_internal_references(generated.recommended_action),
            student_message=_remove_internal_references(generated.student_message),
            talking_points=[_remove_internal_references(item) for item in generated.talking_points],
            success_check=_remove_internal_references(generated.success_check),
            citations=citations,
        )
