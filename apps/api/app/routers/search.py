from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai.embeddings import embedding_client
from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings

router = APIRouter(prefix="/courses", tags=["retrieval"])


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    limit: int = Field(default=6, ge=1, le=12)


class SearchResult(BaseModel):
    chunk_id: str
    material_id: str
    material_title: str
    page_number: int | None
    content: str
    similarity: float


@router.post("/{course_id}/search", response_model=list[SearchResult])
async def search_course_materials(
    course_id: UUID,
    request: SearchRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> list[SearchResult]:
    configured = embedding_client(settings)
    if not configured:
        raise HTTPException(status_code=503, detail="Semantic search is not configured")
    embedding_api, embedding_model = configured
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    course_id_string = str(course_id)
    async with httpx.AsyncClient(timeout=30) as client:
        course_response = await client.get(
            f"{base}/rest/v1/courses",
            headers=headers,
            params={"id": f"eq.{course_id_string}", "select": "teacher_id"},
        )
        course_response.raise_for_status()
        courses = course_response.json()
        if not courses:
            raise HTTPException(status_code=404, detail="Course not found")
        is_teacher = courses[0]["teacher_id"] == user.id
        enrollment_response = await client.get(
            f"{base}/rest/v1/enrollments",
            headers=headers,
            params={
                "course_id": f"eq.{course_id_string}",
                "student_id": f"eq.{user.id}",
                "status": "eq.approved",
                "select": "id",
                "limit": "1",
            },
        )
        enrollment_response.raise_for_status()
        if not is_teacher and not enrollment_response.json():
            raise HTTPException(status_code=403, detail="You are not a member of this course")

        embedding_response = await embedding_api.embeddings.create(
            model=embedding_model,
            input=request.query,
            encoding_format="float",
        )
        embedding = embedding_response.data[0].embedding
        if len(embedding) != 1536:
            raise HTTPException(status_code=500, detail="Embedding model dimension mismatch")
        rpc_response = await client.post(
            f"{base}/rest/v1/rpc/match_course_material_chunks",
            headers=headers,
            json={
                "query_embedding": embedding,
                "target_course_id": course_id_string,
                "match_count": request.limit,
            },
        )
        rpc_response.raise_for_status()
        return [SearchResult.model_validate(row) for row in rpc_response.json()]
