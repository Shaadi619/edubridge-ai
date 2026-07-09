from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlmodel import Session, select

from app.database import BASE_DIR, get_session
from app.models import Material
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
        status="uploaded",
        extracted_text_preview="Text extraction will be added in the document-processing phase.",
    )
    session.add(material)
    session.commit()
    session.refresh(material)
    return material
