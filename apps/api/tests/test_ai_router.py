from app.ai.contracts import AITier
from app.ai.router import TaskKind, select_tier


def test_routine_tasks_use_fast_tier() -> None:
    assert select_tier(TaskKind.CLASSIFY) is AITier.FAST
    assert select_tier(TaskKind.ROUTINE_QUIZ) is AITier.FAST


def test_sensitive_tasks_use_reasoning_tier() -> None:
    assert select_tier(TaskKind.MISCONCEPTION) is AITier.REASONING
    assert select_tier(TaskKind.TEACHER_REPORT) is AITier.REASONING


def test_low_confidence_escalates() -> None:
    assert select_tier(TaskKind.CLASSIFY, low_confidence=True) is AITier.REASONING

