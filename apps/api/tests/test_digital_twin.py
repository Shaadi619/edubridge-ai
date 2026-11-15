from app.routers.digital_twin import (
    assessment_issues,
    chunk_supports_topic,
    simulated_learner_profiles,
    topic_tokens,
)


def test_topic_tokens_remove_generic_course_words() -> None:
    assert topic_tokens("Sequential vs. parallel processing in models") == {
        "sequential", "parallel", "processing",
    }


def test_chunk_supports_exact_topic_phrase() -> None:
    assert chunk_supports_topic(
        "self-attention",
        "The transformer uses self attention to connect tokens across the sequence.",
    )


def test_multiword_topic_requires_more_than_one_signal() -> None:
    assert not chunk_supports_topic(
        "self attention",
        "Attention can be useful in many architectures.",
    )


def test_assessment_audit_flags_duplicate_options_and_unmapped_concept() -> None:
    issues = assessment_issues(
        {
            "prompt": "Which mechanism connects tokens across a sequence?",
            "options": ["Self attention", "Recurrence", "self-attention"],
            "correct_option": 0,
            "concept": "Transformer internals",
        },
        known_topic_keys={"self-attention"},
        supported_topic_keys={"self-attention"},
    )
    assert {issue["code"] for issue in issues} == {"duplicate_options", "unmapped_concept"}


def test_assessment_audit_marks_negative_stem_as_low_priority_review() -> None:
    issues = assessment_issues(
        {
            "prompt": "Which statement is NOT supported by the course material?",
            "options": ["First", "Second", "Third"],
            "correct_option": 1,
            "concept": "Self Attention",
        },
        known_topic_keys={"self-attention"},
        supported_topic_keys={"self-attention"},
    )
    assert [(issue["code"], issue["severity"]) for issue in issues] == [("negative_stem", "low")]


def test_simulated_learners_follow_prerequisites_without_real_student_data() -> None:
    profiles = simulated_learner_profiles([
        {
            "name": "Foundations", "weight": "high", "readiness": 100,
            "prerequisites": [], "unlocks": ["Application"],
            "material_sources": [{"document_title": "Course.pdf"}],
            "assessment_questions": 2,
        },
        {
            "name": "Application", "weight": "medium", "readiness": 40,
            "prerequisites": ["Foundations"], "unlocks": [],
            "material_sources": [{"document_title": "Course.pdf"}],
            "assessment_questions": 0,
        },
    ])

    fresh = next(profile for profile in profiles if profile["id"] == "starting-fresh")
    missing = next(profile for profile in profiles if profile["id"] == "missing-prerequisite")
    ready = next(profile for profile in profiles if profile["id"] == "ready-to-progress")

    assert fresh["next_steps"][0]["topic"] == "Foundations"
    assert fresh["blocked"] == [{
        "topic": "Application", "missing_prerequisites": ["Foundations"],
    }]
    assert missing["next_steps"][0]["topic"] == "Foundations"
    assert missing["at_risk_topics"] == ["Application"]
    assert ready["assumed_mastered"] == ["Foundations"]
    assert ready["next_steps"][0]["topic"] == "Application"
    assert "focused question" in ready["teacher_checks"][1]


def test_simulated_learners_require_a_course_map() -> None:
    assert simulated_learner_profiles([]) == []
