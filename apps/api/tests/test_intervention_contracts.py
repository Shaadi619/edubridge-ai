import pytest
from pydantic import ValidationError

from app.ai.contracts import TeacherInterventionDraft


def test_intervention_draft_requires_teacher_talking_points() -> None:
    with pytest.raises(ValidationError):
        TeacherInterventionDraft(
            rationale="The evidence shows a specific conceptual gap.",
            recommended_action="Ask the student to compare the two mechanisms.",
            student_message="Let us revisit this concept together.",
            talking_points=["Review the key distinction."],
            success_check="The student applies the distinction to a new example.",
            citations=[{
                "chunk_id": "chunk-1",
                "document_id": "document-1",
                "document_title": "Course notes",
            }],
        )


def test_intervention_draft_requires_grounding() -> None:
    with pytest.raises(ValidationError):
        TeacherInterventionDraft(
            rationale="The evidence shows a specific conceptual gap.",
            recommended_action="Ask the student to compare the two mechanisms.",
            student_message="Let us revisit this concept together.",
            talking_points=["Review the key distinction.", "Apply it to a new example."],
            success_check="The student applies the distinction to a new example.",
            citations=[],
        )
