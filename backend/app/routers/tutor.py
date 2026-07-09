from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.database import get_session
from app.models import Misconception
from app.schemas import (
    MisconceptionCheckRequest,
    MisconceptionResult,
    TutorAnswer,
    TutorAskRequest,
)
from app.services import require_course, require_student

router = APIRouter(prefix="/tutor", tags=["tutor"])


@router.post("/ask", response_model=TutorAnswer)
def ask_tutor(payload: TutorAskRequest, session: Session = Depends(get_session)) -> TutorAnswer:
    require_student(session, payload.student_id)
    course = require_course(session, payload.course_id)
    return TutorAnswer(
        answer=(
            "This is the current placeholder tutor response. In the next AI phase, "
            f"EduBridge AI will retrieve relevant material from {course.title} and answer only "
            "from those course sources with citations."
        ),
        citations=[],
        unsupported=True,
        follow_up_question="Would you like me to explain this using an example from your uploaded notes?",
    )


@router.post("/misconceptions/check", response_model=MisconceptionResult)
def check_misconception(
    payload: MisconceptionCheckRequest,
    session: Session = Depends(get_session),
) -> MisconceptionResult:
    require_student(session, payload.student_id)
    require_course(session, payload.course_id)

    response_lower = payload.student_response.lower()
    misconceptions: list[str] = []
    missing_points: list[str] = []

    if "thesis" in response_lower and "paragraph" in response_lower:
        misconceptions.append("May be confusing the essay thesis with paragraph-level topic sentences.")
        missing_points.append("A thesis controls the whole essay; a topic sentence controls one paragraph.")
    elif "evidence" in response_lower and "quote" in response_lower:
        misconceptions.append("May think evidence is enough without analysis.")
        missing_points.append("Evidence needs explanation that connects it back to the claim.")
    else:
        missing_points.append("Needs a clearer explanation of the concept using course terminology.")

    result = MisconceptionResult(
        topic=payload.topic,
        correct_points=["The response attempts to explain the concept in the student's own words."],
        missing_points=missing_points,
        misconceptions=misconceptions or ["No specific misconception category detected yet."],
        recommended_revision=(
            "Rewrite the answer using one clear definition, one example, and one sentence explaining "
            "why the example supports the concept."
        ),
        teacher_note=(
            f"Review {payload.topic} with this student and ask them to compare two short examples."
        ),
    )

    session.add(
        Misconception(
            student_id=payload.student_id,
            course_id=payload.course_id,
            topic=payload.topic,
            misconception=result.misconceptions[0],
            teacher_note=result.teacher_note,
            recommended_revision=result.recommended_revision,
        )
    )
    session.commit()
    return result
