import json
from collections import Counter

from pydantic import ValidationError

from app.ai.contracts import (
    AITier,
    Citation,
    EvidenceChunk,
    QuizQuestion,
    QuizResult,
    QuizVerificationResult,
)
from app.ai.evidence import normalize_whitespace, quoted_chunks
from app.ai.prompts import QUIZ_SYSTEM_PROMPT, QUIZ_VERIFICATION_SYSTEM_PROMPT
from app.ai.provider import AIProvider


class QuizVerificationError(ValueError):
    """The model did not supply enough verified items within the retry budget."""


async def generate_verified_quiz(
    provider: AIProvider,
    evidence: list[EvidenceChunk],
    *,
    question_count: int,
    difficulty_mode: str,
    difficulty_instruction: str,
    focus_concept: str | None,
    prerequisite_concepts: list[str],
    priority_concepts: list[str],
) -> QuizResult:
    sources = {item.chunk_id: item for item in evidence}
    course_evidence = [item.model_dump() for item in evidence]
    accepted: dict[int, QuizQuestion] = {}
    title = "Course practice quiz"
    for attempt in range(2):
        missing = [index for index in range(question_count) if index not in accepted]
        try:
            draft = await provider.generate_structured(
                tier=AITier.REASONING,
                system_prompt=QUIZ_SYSTEM_PROMPT,
                user_prompt=json.dumps({
                    "question_count": len(missing),
                    "question_positions": [index + 1 for index in missing],
                    "difficulty_mode": difficulty_mode,
                    "focus_concept": focus_concept,
                    "prerequisite_concepts": prerequisite_concepts,
                    "priority_concepts": priority_concepts,
                    "course_evidence": course_evidence,
                    "accepted_question_prompts": [question.prompt for question in accepted.values()],
                    "instruction": (
                        "Generate exactly question_count questions in the specified position order. "
                        f"{difficulty_instruction} "
                        "When prerequisites are present, use position 1 for the earliest prerequisite "
                        "and keep most remaining positions focused on the target concept. Otherwise, "
                        "target the priority concepts where the evidence supports them. Do not repeat "
                        "accepted questions. Use chunk IDs only in structured citations."
                    ),
                }),
                output_type=QuizResult,
            )
        except (ValidationError, json.JSONDecodeError):
            continue
        if attempt == 0 and draft.title.strip():
            title = draft.title.strip()

        candidates: dict[int, QuizQuestion] = {}
        seen_prompts = {normalize_whitespace(question.prompt).casefold() for question in accepted.values()}
        for index, question in zip(missing, draft.questions):
            prompt_key = normalize_whitespace(question.prompt).casefold()
            options = {normalize_whitespace(option).casefold() for option in question.options}
            if (
                not prompt_key
                or prompt_key in seen_prompts
                or len(question.options) != 4
                or len(options) != 4
                or "" in options
                or not 0 <= question.correct_option < 4
                or not any(citation.chunk_id in sources for citation in question.citations)
            ):
                continue
            candidates[index] = question
            seen_prompts.add(prompt_key)
        if not candidates:
            continue

        try:
            verification = await provider.generate_structured(
                tier=AITier.REASONING,
                system_prompt=QUIZ_VERIFICATION_SYSTEM_PROMPT,
                user_prompt=json.dumps({
                    "course_evidence": course_evidence,
                    "questions": [
                        {"question_index": index, "prompt": question.prompt, "options": question.options}
                        for index, question in candidates.items()
                    ],
                }),
                output_type=QuizVerificationResult,
            )
        except (ValidationError, json.JSONDecodeError):
            continue

        verdict_counts = Counter(verdict.question_index for verdict in verification.questions)
        for verdict in verification.questions:
            index = verdict.question_index
            question = candidates.get(index)
            if (
                question is None
                or verdict_counts[index] != 1
                or verdict.supported_option_indices != [question.correct_option]
                or not verdict.explanation.strip()
            ):
                continue
            citations = [
                Citation(
                    chunk_id=source.chunk_id,
                    document_id=source.document_id,
                    document_title=source.document_title,
                    page_number=source.page_number,
                )
                for source in quoted_chunks(verdict.sources, sources)[:2]
            ]
            if citations:
                accepted[index] = question.model_copy(update={
                    "explanation": verdict.explanation.strip(),
                    "citations": citations,
                })
        if len(accepted) == question_count:
            return QuizResult(title=title, questions=[accepted[index] for index in range(question_count)])

    raise QuizVerificationError("The quiz could not be verified against your course materials. Try again.")
