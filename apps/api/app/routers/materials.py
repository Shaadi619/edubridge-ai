from io import BytesIO
import logging
from pathlib import PurePosixPath
from uuid import UUID
from zipfile import BadZipFile, ZipFile

import httpx
from docx import Document
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pptx import Presentation
from pypdf import PdfReader

from app.auth import AuthenticatedUser, current_user
from app.ai.embeddings import embedding_client
from app.config import Settings, get_settings

router = APIRouter(prefix="/materials", tags=["materials"])
logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_EXPANDED_ARCHIVE_BYTES = 150 * 1024 * 1024
MAX_PAGES = 500
MAX_EXTRACTED_CHARACTERS = 5_000_000
MAX_CHUNKS = 4_000


def _headers(settings: Settings) -> dict[str, str]:
    key = settings.supabase_service_role_key
    if not settings.supabase_url or not key:
        raise HTTPException(status_code=503, detail="Document processing is not configured")
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _extract_pages(content: bytes, mime_type: str, storage_path: str) -> list[str]:
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("The document exceeds the 50 MB processing limit")
    suffix = PurePosixPath(storage_path).suffix.lower()
    if suffix in {".pptx", ".docx"}:
        try:
            with ZipFile(BytesIO(content)) as archive:
                expanded_size = sum(item.file_size for item in archive.infolist())
                if expanded_size > MAX_EXPANDED_ARCHIVE_BYTES:
                    raise ValueError("The expanded document is too large to process safely")
        except BadZipFile as error:
            raise ValueError("The Office document is invalid or corrupted") from error
    if mime_type == "application/pdf" or suffix == ".pdf":
        reader = PdfReader(BytesIO(content))
        if len(reader.pages) > MAX_PAGES:
            raise ValueError(f"Documents are limited to {MAX_PAGES} pages")
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
    if "presentationml" in mime_type or suffix == ".pptx":
        presentation = Presentation(BytesIO(content))
        if len(presentation.slides) > MAX_PAGES:
            raise ValueError(f"Presentations are limited to {MAX_PAGES} slides")
        pages = ["\n".join(shape.text for shape in slide.shapes if hasattr(shape, "text")).strip() for slide in presentation.slides]
    if "wordprocessingml" in mime_type or suffix == ".docx":
        document = Document(BytesIO(content))
        pages = ["\n".join(paragraph.text for paragraph in document.paragraphs).strip()]
    elif not (mime_type == "application/pdf" or suffix in {".pdf", ".pptx"} or "presentationml" in mime_type):
        raise ValueError("Unsupported document type")
    if sum(len(page) for page in pages) > MAX_EXTRACTED_CHARACTERS:
        raise ValueError("The document contains too much text to process safely")
    return pages


def _chunks(pages: list[str], size: int = 1800, overlap: int = 200) -> list[dict]:
    result: list[dict] = []
    for page_number, text in enumerate(pages, start=1):
        start = 0
        while start < len(text):
            content = text[start : start + size].strip()
            if content:
                result.append({"page_number": page_number, "content": content})
                if len(result) > MAX_CHUNKS:
                    raise ValueError("The document produces too many searchable chunks")
            start += size - overlap
    return result


async def _embed_chunks(chunks: list[dict], settings: Settings) -> list[list[float]] | None:
    configured = embedding_client(settings)
    if not configured:
        return None
    client, model = configured
    vectors: list[list[float]] = []
    for start in range(0, len(chunks), 100):
        batch = chunks[start : start + 100]
        response = await client.embeddings.create(
            model=model,
            input=[chunk["content"] for chunk in batch],
            encoding_format="float",
        )
        vectors.extend(item.embedding for item in sorted(response.data, key=lambda item: item.index))
    if any(len(vector) != 1536 for vector in vectors):
        raise ValueError("The configured embedding model must produce 1536 dimensions")
    return vectors


@router.post("/{material_id}/process")
async def process_material(
    material_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, int | str]:
    material_id_string = str(material_id)
    base = settings.supabase_url.rstrip("/")
    headers = _headers(settings)
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(
            f"{base}/rest/v1/materials",
            headers=headers,
            params={"id": f"eq.{material_id_string}", "select": "id,course_id,storage_path,mime_type,status"},
        )
        response.raise_for_status()
        rows = response.json()
        if not rows:
            raise HTTPException(status_code=404, detail="Material not found")
        material = rows[0]
        if material["status"] == "processing":
            raise HTTPException(status_code=409, detail="This material is already processing")
        if material["status"] == "ready":
            raise HTTPException(status_code=409, detail="This material has already been processed")
        course_response = await client.get(
            f"{base}/rest/v1/courses",
            headers=headers,
            params={"id": f"eq.{material['course_id']}", "select": "teacher_id"},
        )
        course_response.raise_for_status()
        courses = course_response.json()
        if not courses or courses[0]["teacher_id"] != user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the course teacher can process this material")
        await client.patch(
            f"{base}/rest/v1/materials?id=eq.{material_id_string}", headers=headers, json={"status": "processing", "processing_error": None}
        )
        try:
            file_response = await client.get(
                f"{base}/storage/v1/object/course-materials/{material['storage_path']}", headers=headers
            )
            file_response.raise_for_status()
            pages = await run_in_threadpool(_extract_pages, file_response.content, material["mime_type"], material["storage_path"])
            chunks = _chunks(pages)
            if not chunks:
                raise ValueError("No extractable text was found in this document")
            embeddings = await _embed_chunks(chunks, settings)
            await client.delete(f"{base}/rest/v1/material_chunks?material_id=eq.{material_id_string}", headers=headers)
            payload = [
                {
                    "material_id": material_id_string,
                    "course_id": material["course_id"],
                    "chunk_index": index,
                    "page_number": chunk["page_number"],
                    "content": chunk["content"],
                    "token_count": max(1, len(chunk["content"]) // 4),
                    **({"embedding": embeddings[index]} if embeddings else {}),
                }
                for index, chunk in enumerate(chunks)
            ]
            chunk_response = await client.post(f"{base}/rest/v1/material_chunks", headers=headers, json=payload)
            chunk_response.raise_for_status()
            ready_response = await client.patch(
                f"{base}/rest/v1/materials?id=eq.{material_id_string}",
                headers=headers,
                json={"status": "ready", "page_count": len(pages), "processing_error": None},
            )
            ready_response.raise_for_status()
            return {"status": "ready", "pages": len(pages), "chunks": len(chunks)}
        except Exception as error:
            safe_error = str(error) if isinstance(error, ValueError) else "An internal processing step failed"
            logger.exception("Material processing failed for %s", material_id_string)
            await client.patch(
                f"{base}/rest/v1/materials?id=eq.{material_id_string}",
                headers=headers,
                json={"status": "failed", "processing_error": safe_error[:1000]},
            )
            raise HTTPException(status_code=422, detail=f"Document processing failed: {safe_error}") from error
