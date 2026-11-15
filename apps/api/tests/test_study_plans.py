from app.routers.study_plans import concept_key, recommendation_priority


def test_concept_key_is_stable_and_readable() -> None:
    assert concept_key("  Self-Attention & Position!  ") == "self-attention-position"


def test_open_misconception_is_high_priority() -> None:
    assert recommendation_priority(open_misconceptions=1, review_due=False, mastery_score=90) == (
        "high", "misconception",
    )


def test_retention_due_is_high_priority() -> None:
    assert recommendation_priority(open_misconceptions=0, review_due=True, mastery_score=90) == (
        "high", "retention",
    )


def test_low_mastery_is_medium_priority() -> None:
    assert recommendation_priority(open_misconceptions=0, review_due=False, mastery_score=45) == (
        "medium", "mastery",
    )
