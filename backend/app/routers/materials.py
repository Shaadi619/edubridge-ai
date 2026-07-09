from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlmodel import Session, select

from app.database import BASE_DIR, get_session
from app.document_processing import extract_material
from app.models import Material, MaterialChunk
from app.services import require_course

router = APIRouter(prefix="/materials", tags=["materials"])

UPLOAD_DIR = BASE_DIR / "storage" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/courses/{course_id}", response_model=list[Material])
def list_course_materials(
    course_id: int,
    session: Session = Depends(get_session),
) -> list[Material]:
    require_course(session, course_id)
    return session.exec(
        select(Material).where(Material.course_id == course_id).order_by(Material.uploaded_at.desc())
    ).all()


@router.get("/{material_id}/chunks", response_model=list[MaterialChunk])
def list_material_chunks(
    material_id: int,
    session: Session = Depends(get_session),
) -> list[MaterialChunk]:
    material = session.get(Material, material_id)
    if not material:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")
    return session.exec(
        select(MaterialChunk)
        .where(MaterialChunk.material_id == material_id)
        .order_by(MaterialChunk.chunk_index)
    ).all()


@router.post("/courses/{course_id}", response_model=Material, status_code=status.HTTP_201_CREATED)
def upload_course_material(
    course_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> Material:
    require_course(session, course_id)
    course_dir = UPLOAD_DIR / str(course_id)
    course_dir.mkdir(parents=True, exist_ok=True)

    safe_name = Path(file.filename or "uploaded-material").name
    storage_path = course_dir / safe_name
    storage_path.write_bytes(file.file.read())

    material = Material(
        course_id=course_id,
        filename=safe_name,
        content_type=file.content_type or "application/octet-stream",
        storage_path=str(storage_path),
        status="processing",
        extracted_text_preview="Extracting text for future AI retrieval.",
    )
    session.add(material)
    session.commit()
    session.refresh(material)

    try:
        extraction = extract_material(storage_path, material.content_type)
        material.status = extraction.status
        material.extracted_text_preview = extraction.preview
        session.add(material)
        session.commit()
        session.refresh(material)

        for index, chunk in enumerate(extraction.chunks):
            session.add(
                MaterialChunk(
                    material_id=material.id or 0,
                    course_id=course_id,
                    chunk_index=index,
                    text=chunk.text,
                    source_page=chunk.source_page,
                )
            )
        session.commit()
        session.refresh(material)
    except Exception as exc:
        material.status = "error"
        material.extracted_text_preview = f"Text extraction failed: {exc}"
        session.add(material)
        session.commit()
        session.refresh(material)

    return material
