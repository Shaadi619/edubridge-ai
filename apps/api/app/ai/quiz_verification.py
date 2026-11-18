import json
import logging
import random
import re
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

logger = logging.getLogger(__name__)
_POSITION_DEPENDENT = re.compile(
    r"\b(?:all|none|both|any|neither|some)\s+of\s+(?:the\s+)?(?:above|below|preceding|following)\b"
    r"|\b(?:both\s+)?[A-D]\s*(?:and|or|&|/)\s*[A-D](?:\s+only)?[.)]?\s*$",
    re.IGNORECASE,
)
_POSITION_LABEL = r"\b(?:option|choice|answer)\s*(?:number\s*)?[:#]?\s+(?:\(?[A-D\d]\)?)(?!\w)"
_LEADING_CHOICE_LABEL = re.compile(r"^\s*(?:[A-D][.)]|\([A-D]\))\s+", re.IGNORECASE)
_POSITION_TAIL = re.compile(
    r"\s*,?\s*(?:which\s+)?(?:matches|corresponds to)\s+(?:the\s+)?"
    + _POSITION_LABEL + r"\s*(?=[.!?]?\s*$)",
    re.IGNORECASE,
)


class QuizVerificationError(ValueError):
    """The model did not supply enough verified items within the retry budget."""


def shuffle_verified_quiz(quiz: QuizResult) -> QuizResult:
    """Reorder verified choices once, before the quiz's official key is stored."""
    rng = random.SystemRandom()
    positions: Counter[int] = Counter()
    # Guarantee variety without giving away a fixed A/B/C/D distribution.
    per_position_limit = (len(quiz.questions) + 1) // 2
    questions = []
    for question in quiz.questions:
        correct = question.options[question.correct_option]
        options = [option for index, option in enumerate(question.options) if index != question.correct_option]
        rng.shuffle(options)
        position = rng.choice([
            index for index in range(len(question.options)) if positions[index] < per_position_limit
        ])
        options.insert(position, correct)
        positions[position] += 1

        explanation = _POSITION_TAIL.sub("", question.explanation).strip()
        if not explanation or re.search(_POSITION_LABEL, explanation, re.IGNORECASE):
            explanation = f"The course material supports this answer: {correct}"
        questions.append(question.model_copy(update={
            "options": options, "correct_option": position, "explanation": explanation,
        }))
    return quiz.model_copy(update={"questions": questions})


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
        rejected: Counter[str] = Counter()
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
            logger.warning("Quiz draft schema rejected on pass %d", attempt + 1)
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
                or _POSITION_DEPENDENT.search(question.prompt)
                or any(
                    _POSITION_DEPENDENT.search(option) or _LEADING_CHOICE_LABEL.search(option)
                    for option in question.options
                )
                or not 0 <= question.correct_option < 4
                or not any(citation.chunk_id in sources for citation in question.citations)
            ):
                rejected["invalid_draft"] += 1
                continue
            candidates[index] = question
            seen_prompts.add(prompt_key)
        if not candidates:
            logger.info("Quiz pass %d had no eligible drafts (requested=%d returned=%d)",
                        attempt + 1, len(missing), len(draft.questions))
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
            logger.warning("Quiz verifier schema rejected on pass %d", attempt + 1)
            continue

        verdict_counts = Counter(verdict.question_index for verdict in verification.questions)
        for verdict in verification.questions:
            index = verdict.question_index
            question = candidates.get(index)
            if (
                question is None
                or verdict_counts[index] != 1
            ):
                rejected["invalid_verdict_index"] += 1
                continue
            if verdict.supported_option_indices != [question.correct_option]:
                rejected["unconfirmed_key"] += 1
                continue
            if not verdict.explanation.strip():
                rejected["missing_explanation"] += 1
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
                cited = {citation.chunk_id for citation in citations}
                quotes: dict[str, str] = {}
                for reference in verdict.sources:
                    quote = normalize_whitespace(reference.quote)
                    if reference.chunk_id in cited and reference.chunk_id not in quotes and quote:
                        quotes[reference.chunk_id] = quote
                verified = question.model_copy(update={
                    "explanation": verdict.explanation.strip(),
                    "citations": citations,
                })
                verified._evidence_quotes = quotes
                accepted[index] = verified
            else:
                rejected["quote_mismatch"] += 1
        logger.info("Quiz pass %d verified %d/%d total (drafts=%d candidates=%d verdicts=%d rejected=%s)",
                    attempt + 1, len(accepted), question_count, len(draft.questions),
                    len(candidates), len(verification.questions), dict(rejected))
        if len(accepted) == question_count:
            return QuizResult(title=title, questions=[accepted[index] for index in range(question_count)])

    if len(accepted) >= 3:
        return QuizResult(title=title, questions=[accepted[index] for index in sorted(accepted)])
    logger.warning("Quiz generation ended with %d verified questions out of %d requested",
                   len(accepted), question_count)
    raise QuizVerificationError(
        "The quiz could not be verified against your course materials. "
        "Try again or choose a specific topic from My Progress."
    )
