from app.routers.notifications import _notification_allowed
from app.routers.quizzes import _difficulty_instruction
from app.routers.quizzes import GenerateQuizRequest


def test_notifications_default_to_enabled() -> None:
    assert _notification_allowed({}, "enroll") is True
    assert _notification_allowed({}, "misconception") is True
    assert _notification_allowed({}, "announcement") is True


def test_teacher_notification_preferences_are_enforced() -> None:
    assert _notification_allowed({"enrollments": False}, "enroll") is False
    assert _notification_allowed({"flags": False}, "flag") is False
    assert _notification_allowed({"misconceptions": False}, "misconception") is False
    assert _notification_allowed({"quizActivity": False}, "quiz") is False


def test_student_misconception_preference_takes_priority() -> None:
    assert _notification_allowed({"misconceptions": True, "misconceptionAlerts": False}, "misconception") is False


def test_quiz_difficulty_instructions_are_distinct() -> None:
    assert "1-2" in _difficulty_instruction("easy")
    assert "2-4" in _difficulty_instruction("adaptive")
    assert "4-5" in _difficulty_instruction("hard")
    assert _difficulty_instruction("unknown") == _difficulty_instruction("adaptive")


def test_targeted_quiz_request_accepts_a_focus_concept() -> None:
    request = GenerateQuizRequest(question_count=4, focus_concept="  Self-attention  ")
    assert request.focus_concept == "  Self-attention  "
