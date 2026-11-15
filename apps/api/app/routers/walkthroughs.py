import json
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai.azure_provider import AzureOpenAIProvider
from app.ai.contracts import AITier, EvidenceChunk, WalkthroughResult
from app.ai.embeddings import embedding_client
from app.ai.prompts import WALKTHROUGH_SYSTEM_PROMPT
from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.routers.tutor import _course_access, _remove_internal_references, _source_kind

router = APIRouter(prefix="/courses", tags=["concept lab"])


class WalkthroughRequest(BaseModel):
    focus: str = Field(min_length=2, max_length=240)


class FriendlyWalkthroughCitation(BaseModel):
    document_title: str
    page_number: int | None
    source_kind: Literal["page", "slide", "document"]


class FriendlyCheckpoint(BaseModel):
    question: str
    options: list[str]
    correct_option: int
    correct_feedback: str
    revision_feedback: str


class FriendlyWalkthroughStep(BaseModel):
    title: str
    explanation: str
    scenario: str
    checkpoint: FriendlyCheckpoint
    citations: list[FriendlyWalkthroughCitation]


class WalkthroughResponse(BaseModel):
    title: str
    learning_goal: str
    steps: list[FriendlyWalkthroughStep]
    closing_challenge: str


@router.post("/{course_id}/walkthroughs/generate", response_model=WalkthroughResponse)
async def generate_walkthrough(
    course_id: UUID,
    request: WalkthroughRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> WalkthroughResponse:
    configured = embedding_client(settings)
    if not configured:
        raise HTTPException(status_code=503, detail="Course evidence retrieval is not configured")
    if not (
        settings.azure_openai_endpoint
        and settings.azure_openai_api_key
        and settings.azure_openai_tier2_deployment
    ):
        raise HTTPException(status_code=503, detail="Concept Lab generation is not configured")

    key = settings.supabase_service_role_key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    base = settings.supabase_url.rstrip("/")
    course_id_string = str(course_id)
    async with httpx.AsyncClient(timeout=75) as client:
        if not await _course_access(client, base, headers, course_id_string, user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        profile = await client.get(
            f"{base}/rest/v1/profiles",
            headers=headers,
            params={"id": f"eq.{user.id}", "role": "eq.student", "select": "id", "limit": "1"},
        )
        profile.raise_for_status()
        if not profile.json():
            raise HTTPException(status_code=403, detail="Concept Lab is available to students")

        embedding_api, embedding_model = configured
        vector = (await embedding_api.embeddings.create(
            model=embedding_model,
            input=request.focus.strip(),
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
            raise HTTPException(status_code=422, detail="No indexed course evidence matches this concept")
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
            system_prompt=WALKTHROUGH_SYSTEM_PROMPT,
            user_prompt=json.dumps({
                "student_focus": request.focus.strip(),
                "course_evidence": [item.model_dump() for item in evidence],
                "instruction": "Create 3-5 ordered interactive steps. Use supplied chunk_id values only in citation fields.",
            }),
            output_type=WalkthroughResult,
        )

        canonical = {item.chunk_id: item for item in evidence}
        friendly_steps: list[FriendlyWalkthroughStep] = []
        for step in generated.steps:
            if step.checkpoint.correct_option >= len(step.checkpoint.options):
                continue
            citations: list[FriendlyWalkthroughCitation] = []
            seen: set[tuple[str, int | None]] = set()
            for citation in step.citations:
                source = canonical.get(citation.chunk_id)
                if not source:
                    continue
                location = (source.document_id, source.page_number)
                if location in seen:
                    continue
                seen.add(location)
                citations.append(FriendlyWalkthroughCitation(
                    document_title=source.document_title,
                    page_number=source.page_number,
                    source_kind=_source_kind(source.document_title, source.page_number),
                ))
                if len(citations) == 3:
                    break
            if not citations:
                continue
            checkpoint = step.checkpoint
            friendly_steps.append(FriendlyWalkthroughStep(
                title=_remove_internal_references(step.title),
                explanation=_remove_internal_references(step.explanation),
                scenario=_remove_internal_references(step.scenario),
                checkpoint=FriendlyCheckpoint(
                    question=_remove_internal_references(checkpoint.question),
                    options=[_remove_internal_references(option) for option in checkpoint.options],
                    correct_option=checkpoint.correct_option,
                    correct_feedback=_remove_internal_references(checkpoint.correct_feedback),
                    revision_feedback=_remove_internal_references(checkpoint.revision_feedback),
                ),
                citations=citations,
            ))
        if len(friendly_steps) < 3:
            raise HTTPException(status_code=422, detail="The walkthrough could not be grounded well enough. Try a more specific concept.")
        return WalkthroughResponse(
            title=_remove_internal_references(generated.title),
            learning_goal=_remove_internal_references(generated.learning_goal),
            steps=friendly_steps[:5],
            closing_challenge=_remove_internal_references(generated.closing_challenge),
        )
