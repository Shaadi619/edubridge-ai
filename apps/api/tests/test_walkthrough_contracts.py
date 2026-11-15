import pytest
from pydantic import ValidationError

from app.ai.contracts import WalkthroughCheckpoint, WalkthroughResult


def test_walkthrough_requires_at_least_three_steps() -> None:
    with pytest.raises(ValidationError):
        WalkthroughResult(
            title="Self-attention",
            learning_goal="Explain how tokens exchange context.",
            steps=[],
            closing_challenge="Apply the idea to a new sentence.",
        )


def test_checkpoint_rejects_an_out_of_range_answer_index() -> None:
    with pytest.raises(ValidationError):
        WalkthroughCheckpoint(
            question="Which option is correct?",
            options=["A", "B", "C", "D"],
            correct_option=4,
            correct_feedback="Correct.",
            revision_feedback="Try again.",
        )
