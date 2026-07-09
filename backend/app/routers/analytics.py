from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.database import get_session
from app.schemas import ClassInsight, StudentInsight
from app.services import build_class_insight, build_student_insight

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/courses/{course_id}", response_model=ClassInsight)
def get_course_analytics(
    course_id: int,
    session: Session = Depends(get_session),
) -> ClassInsight:
    return build_class_insight(session, course_id)


@router.get("/students/{student_id}", response_model=StudentInsight)
def get_student_analytics(
    student_id: int,
    session: Session = Depends(get_session),
) -> StudentInsight:
    return build_student_insight(session, student_id)
