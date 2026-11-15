from app.ai.contracts import AITier


class TaskKind:
    CLASSIFY = "classify"
    EXTRACT_TOPIC = "extract_topic"
    ROUTINE_QUIZ = "routine_quiz"
    TUTOR = "tutor"
    MISCONCEPTION = "misconception"
    TEACHER_REPORT = "teacher_report"


def select_tier(task: str, *, low_confidence: bool = False) -> AITier:
    """Route high-impact or ambiguous work to the stronger model tier."""
    if low_confidence or task in {
        TaskKind.TUTOR,
        TaskKind.MISCONCEPTION,
        TaskKind.TEACHER_REPORT,
    }:
        return AITier.REASONING
    return AITier.FAST

