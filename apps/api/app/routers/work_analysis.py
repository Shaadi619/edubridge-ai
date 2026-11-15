import base64
import binascii
import json
import logging
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePath
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pypdf import PdfReader

from app.ai.azure_provider import AzureOpenAIProvider
from app.ai.contracts import AITier, Citation, EvidenceChunk, ShowWorkAnalysis
from app.ai.embeddings import embedding_client
from app.ai.prompts import SHOW_WORK_SYSTEM_PROMPT
from app.auth import AuthenticatedUser, current_user
from app.concepts import friendly_concept
from app.config import Settings, get_settings
from app.routers.tutor import _course_access, _source_kind

router = APIRouter(prefix="/courses", tags=["show your work"])
logger = logging.getLogger(__name__)

MAX_WORK_BYTES = 8 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}


class WorkSubmissionRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=180)
    mime_type: str
    data_base64: str
    context: str = Field(min_length=3, max_length=2000)


class WorkReviewRequest(BaseModel):
    decision: str = Field(pattern="^(approved|dismissed)$")


def _decode_work(payload: WorkSubmissionRequest) -> bytes:
    if payload.mime_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, WebP, or PDF file")
    try:
        content = base64.b64decode(payload.data_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="The uploaded file data is invalid") from error
    if not content or len(content) > MAX_WORK_BYTES:
        raise HTTPException(status_code=413, detail="Show Your Work files must be between 1 byte and 8 MB")
    valid_magic = {
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
        "application/pdf": content.startswith(b"%PDF"),
    }
    if not valid_magic[payload.mime_type]:
        raise HTTPException(status_code=400, detail="The file contents do not match the selected file type")
    return content


def _pdf_text(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
        text = "\n\n".join((page.extract_text() or "").strip() for page in reader.pages[:20]).strip()
    except Exception as error:
        raise HTTPException(status_code=422, detail="The PDF is invalid or could not be read") from error
    if not text:
        raise HTTPException(status_code=422, detail="This PDF has no extractable text. Export handwritten pages as JPG or PNG for visual analysis.")
    return text[:24000]


def _provider(settings: Settings) -> AzureOpenAIProvider:
    if not (settings.azure_openai_endpoint and settings.azure_openai_api_key and settings.azure_openai_tier2_deployment):
        raise HTTPException(status_code=503, detail="Show Your Work analysis is not configured")
    return AzureOpenAIProvider(
        endpoint=settings.azure_openai_endpoint, api_key=settings.azure_openai_api_key,
        api_version=settings.azure_openai_api_version,
        fast_deployment=settings.azure_openai_tier1_deployment,
        reasoning_deployment=settings.azure_openai_tier2_deployment,
    )


def _friendly_analysis(analysis: ShowWorkAnalysis, evidence: list[EvidenceChunk]) -> dict:
    canonical = {item.chunk_id: item for item in evidence}

    def citations(items: list[Citation]) -> list[dict]:
        output: list[dict] = []
        seen: set[tuple[str, int | None]] = set()
        for citation in items:
            source = canonical.get(citation.chunk_id)
            if not source:
                continue
            location = (source.document_title, source.page_number)
            if location in seen:
                continue
            seen.add(location)
            output.append({
                "document_title": source.document_title, "page_number": source.page_number,
                "source_kind": _source_kind(source.document_title, source.page_number),
            })
            if len(output) == 3:
                break
        return output

    steps = [{
        "step_number": step.step_number, "observed_reasoning": step.observed_reasoning,
        "status": step.status, "feedback": step.feedback, "citations": citations(step.citations),
    } for step in analysis.steps[:12]]
    grounded = analysis.grounded and bool(citations(analysis.citations) or any(step["citations"] for step in steps))
    return {
        "observed_work": analysis.observed_work, "summary": analysis.summary,
        "strengths": analysis.strengths[:5], "steps": steps,
        "citations": citations(analysis.citations), "misconception": analysis.misconception.model_dump(),
        "grounded": grounded, "next_step": analysis.next_step,
    }


async def _teacher_course(client: httpx.AsyncClient, base: str, headers: dict, course_id: str, user_id: str) -> None:
    response = await client.get(
        f"{base}/rest/v1/courses", headers=headers,
        params={"id": f"eq.{course_id}", "teacher_id": f"eq.{user_id}", "select": "id", "limit": "1"},
    )
    response.raise_for_status()
    if not response.json():
        raise HTTPException(status_code=403, detail="Only the course teacher can review submitted work")


@router.post("/{course_id}/work-submissions/analyze")
async def analyze_work(
    course_id: UUID,
    request: WorkSubmissionRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    configured = embedding_client(settings)
    if not configured:
        raise HTTPException(status_code=503, detail="Course evidence retrieval is not configured")
    content = _decode_work(request)
    pdf_text = _pdf_text(content) if request.mime_type == "application/pdf" else ""
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
    base = settings.supabase_url.rstrip("/")
    course_id_string = str(course_id)
    safe_name = PurePath(request.filename).name[:180]
    storage_path = f"{course_id_string}/{user.id}/{uuid4()}{ALLOWED_TYPES[request.mime_type]}"
    async with httpx.AsyncClient(timeout=60) as client:
        if not await _course_access(client, base, headers, course_id_string, user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        profile = await client.get(
            f"{base}/rest/v1/profiles", headers=headers,
            params={"id": f"eq.{user.id}", "role": "eq.student", "select": "id", "limit": "1"},
        )
        profile.raise_for_status()
        if not profile.json():
            raise HTTPException(status_code=403, detail="Show Your Work is available to students")
        upload_headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": request.mime_type, "x-upsert": "false"}
        upload = await client.post(f"{base}/storage/v1/object/student-work/{storage_path}", headers=upload_headers, content=content)
        upload.raise_for_status()
        created = await client.post(f"{base}/rest/v1/work_submissions", headers=headers, json={
            "course_id": course_id_string, "student_id": user.id, "filename": safe_name,
            "storage_path": storage_path, "mime_type": request.mime_type, "byte_size": len(content),
            "context": request.context.strip(), "status": "analyzing",
        })
        if not created.is_success:
            await client.delete(f"{base}/storage/v1/object/student-work/{storage_path}", headers=upload_headers)
        created.raise_for_status()
        submission = created.json()[0]
        try:
            embedding_api, embedding_model = configured
            retrieval_query = f"{request.context.strip()}\n{pdf_text[:4000]}".strip()
            vector = (await embedding_api.embeddings.create(model=embedding_model, input=retrieval_query, encoding_format="float")).data[0].embedding
            matches_response = await client.post(
                f"{base}/rest/v1/rpc/match_course_material_chunks", headers=headers,
                json={"query_embedding": vector, "target_course_id": course_id_string, "match_count": 8},
            )
            matches_response.raise_for_status()
            matches = matches_response.json()
            if not matches:
                raise HTTPException(status_code=422, detail="No indexed course evidence matches this work")
            evidence = [EvidenceChunk(
                chunk_id=row["chunk_id"], document_id=row["material_id"], document_title=row["material_title"],
                page_number=row["page_number"], content=row["content"],
            ) for row in matches]
            prompt = json.dumps({
                "student_context": request.context.strip(),
                "submitted_pdf_text": pdf_text or None,
                "course_evidence": [item.model_dump() for item in evidence],
                "instruction": "Analyze the student's reasoning step by step. Use chunk IDs only in structured citations. If the work is an image, inspect it directly. Do not infer illegible content.",
            })
            provider = _provider(settings)
            if request.mime_type.startswith("image/"):
                data_url = f"data:{request.mime_type};base64,{request.data_base64}"
                analysis = await provider.generate_structured_with_images(
                    tier=AITier.REASONING, system_prompt=SHOW_WORK_SYSTEM_PROMPT,
                    user_prompt=prompt, image_data_urls=[data_url], output_type=ShowWorkAnalysis,
                )
            else:
                analysis = await provider.generate_structured(
                    tier=AITier.REASONING, system_prompt=SHOW_WORK_SYSTEM_PROMPT,
                    user_prompt=prompt, output_type=ShowWorkAnalysis,
                )
            friendly = _friendly_analysis(analysis, evidence)
            review_status = "pending" if friendly["misconception"].get("detected") and float(friendly["misconception"].get("confidence") or 0) >= 0.8 else "not_required"
            updated = await client.patch(
                f"{base}/rest/v1/work_submissions?id=eq.{submission['id']}", headers=headers,
                json={"status": "analyzed", "analysis": friendly, "review_status": review_status},
            )
            updated.raise_for_status()
            return updated.json()[0]
        except HTTPException as error:
            await client.patch(
                f"{base}/rest/v1/work_submissions?id=eq.{submission['id']}", headers=headers,
                json={"status": "failed", "processing_error": error.detail},
            )
            raise
        except Exception as error:
            logger.exception("Show Your Work analysis failed for %s", submission["id"])
            message = "The configured Azure model could not analyze this submission. Confirm that the deployment supports image input." if request.mime_type.startswith("image/") else "The submitted work could not be analyzed."
            await client.patch(
                f"{base}/rest/v1/work_submissions?id=eq.{submission['id']}", headers=headers,
                json={"status": "failed", "processing_error": message},
            )
            raise HTTPException(status_code=422, detail=message) from error


@router.get("/{course_id}/work-submissions")
async def student_work_submissions(
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
        response = await client.get(
            f"{base}/rest/v1/work_submissions", headers=headers,
            params={"course_id": f"eq.{course_id}", "student_id": f"eq.{user.id}", "select": "id,filename,mime_type,context,status,analysis,processing_error,review_status,created_at", "order": "created_at.desc", "limit": "10"},
        )
        response.raise_for_status()
        return response.json()


@router.get("/teacher/{course_id}/work-submissions")
async def teacher_work_submissions(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> list[dict]:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        await _teacher_course(client, base, headers, str(course_id), user.id)
        response = await client.get(
            f"{base}/rest/v1/work_submissions", headers=headers,
            params={"course_id": f"eq.{course_id}", "review_status": "eq.pending", "select": "id,student_id,filename,context,analysis,created_at", "order": "created_at.asc", "limit": "20"},
        )
        response.raise_for_status()
        rows = response.json()
        if not rows:
            return []
        profiles = await client.get(
            f"{base}/rest/v1/profiles", headers=headers,
            params={"id": f"in.({','.join(row['student_id'] for row in rows)})", "select": "id,display_name"},
        )
        profiles.raise_for_status()
        names = {row["id"]: row["display_name"] for row in profiles.json()}
        return [{**row, "student": names.get(row["student_id"], "Student")} for row in rows]


@router.patch("/teacher/{course_id}/work-submissions/{submission_id}/review")
async def review_work_submission(
    course_id: UUID,
    submission_id: UUID,
    request: WorkReviewRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=20) as client:
        await _teacher_course(client, base, headers, str(course_id), user.id)
        response = await client.get(
            f"{base}/rest/v1/work_submissions", headers=headers,
            params={"id": f"eq.{submission_id}", "course_id": f"eq.{course_id}", "review_status": "eq.pending", "select": "id,student_id,analysis", "limit": "1"},
        )
        response.raise_for_status()
        if not response.json():
            raise HTTPException(status_code=404, detail="Pending work submission not found")
        submission = response.json()[0]
        misconception_id = None
        if request.decision == "approved":
            analysis = submission.get("analysis") or {}
            misconception = analysis.get("misconception") or {}
            if not misconception.get("detected") or float(misconception.get("confidence") or 0) < 0.8:
                raise HTTPException(status_code=422, detail="This submission does not contain a high-confidence misconception suggestion")
            concept = friendly_concept(misconception.get("concept") or misconception.get("label") or "")
            if not concept:
                raise HTTPException(status_code=422, detail="The misconception suggestion has no usable concept")
            created = await client.post(f"{base}/rest/v1/misconceptions", headers=headers, json={
                "course_id": str(course_id), "student_id": submission["student_id"],
                "concept": concept, "label": misconception.get("label") or concept,
                "explanation": misconception.get("explanation") or analysis.get("summary") or "Misconception observed in submitted work.",
                "student_evidence": misconception.get("evidence_from_student") or analysis.get("observed_work") or "Submitted work",
                "confidence": misconception.get("confidence"),
                "recommended_intervention": misconception.get("recommended_intervention") or analysis.get("next_step"),
                "reviewed_by": user.id, "reviewed_at": datetime.now(UTC).isoformat(),
            })
            created.raise_for_status()
            misconception_id = created.json()[0]["id"]
        updated = await client.patch(
            f"{base}/rest/v1/work_submissions?id=eq.{submission_id}", headers=headers,
            json={"review_status": request.decision, "reviewed_by": user.id, "reviewed_at": datetime.now(UTC).isoformat(), "misconception_id": misconception_id},
        )
        updated.raise_for_status()
        return {"id": str(submission_id), "review_status": request.decision, "misconception_id": misconception_id}
