from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, PrivateAttr


class AITier(StrEnum):
    FAST = "fast"
    REASONING = "reasoning"


class EvidenceChunk(BaseModel):
    chunk_id: str
    document_id: str
    document_title: str
    page_number: int | None = None
    content: str


class Citation(BaseModel):
    chunk_id: str
    document_id: str
    document_title: str
    page_number: int | None = None
    source_kind: Literal["page", "slide", "document"] = "document"


class TutorRequest(BaseModel):
    course_id: str
    student_id: str
    question: str = Field(min_length=1, max_length=8000)
    conversation_summary: str | None = None
    evidence: list[EvidenceChunk] = Field(default_factory=list)


class MisconceptionAnalysis(BaseModel):
    detected: bool
    concept: str | None = None
    label: str | None = None
    explanation: str | None = None
    confidence: float = Field(ge=0, le=1)
    evidence_from_student: str | None = None
    recommended_intervention: str | None = None


class TutorAnswer(BaseModel):
    answer: str
    citations: list[Citation]
    misconception: MisconceptionAnalysis
    grounded: bool
    follow_up_question: str | None = None


class QuizQuestion(BaseModel):
    prompt: str
    options: list[str]
    correct_option: int
    explanation: str
    concept: str
    difficulty: int = Field(ge=1, le=5)
    citations: list[Citation]
    # Verified quote per cited chunk. Private, so it never enters the schema the
    # model is asked to fill; the verifier sets it after matching each quote.
    _evidence_quotes: dict[str, str] = PrivateAttr(default_factory=dict)


class QuizResult(BaseModel):
    title: str
    questions: list[QuizQuestion]


class EvidenceQuote(BaseModel):
    chunk_id: str
    quote: str


class GroundedExplanationSection(BaseModel):
    text: str
    source_refs: list[str]


class GroundedExplanationDraft(BaseModel):
    grounded: bool
    sections: list[GroundedExplanationSection]


class StandaloneQuestion(BaseModel):
    question: str
    search_query: str


class TutorDraft(GroundedExplanationDraft):
    misconception: MisconceptionAnalysis
    misconception_source_refs: list[str]


class QuizItemVerification(BaseModel):
    question_index: int
    supported_option_indices: list[int]
    explanation: str
    sources: list[EvidenceQuote]


class QuizVerificationResult(BaseModel):
    questions: list[QuizItemVerification]


class TeacherInsight(BaseModel):
    title: str
    summary: str
    affected_student_count: int = Field(ge=0)
    misconception_labels: list[str]
    recommended_actions: list[str]
    confidence: float = Field(ge=0, le=1)


class TeachBackQuestion(BaseModel):
    question: str
    citations: list[Citation]


class TeachBackEvaluation(BaseModel):
    verdict: Literal["still_present", "improving", "corrected"]
    feedback: str
    sources: list[EvidenceQuote]
    grounded: bool


class WorkStepFeedback(BaseModel):
    step_number: int = Field(ge=1, le=30)
    observed_reasoning: str
    status: Literal["correct", "needs_revision", "unclear"]
    feedback: str
    # Exact course quotes that back this step's feedback; checked against the chunk text.
    sources: list[EvidenceQuote] = Field(default_factory=list, max_length=3)


class ShowWorkAnalysis(BaseModel):
    observed_work: str
    summary: str
    strengths: list[str]
    steps: list[WorkStepFeedback]
    sources: list[EvidenceQuote] = Field(default_factory=list, max_length=3)
    misconception: MisconceptionAnalysis
    grounded: bool
    next_step: str


class TeacherInterventionDraft(BaseModel):
    rationale: str
    recommended_action: str
    student_message: str
    talking_points: list[str] = Field(min_length=2, max_length=4)
    success_check: str
    citations: list[Citation] = Field(min_length=1, max_length=3)
