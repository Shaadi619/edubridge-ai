from app.routers.digital_twin import (
    match_topic,
    topic_evidence,
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
    assert "quiz question" in ready["teacher_checks"][1]


def test_simulated_learners_require_a_course_map() -> None:
    assert simulated_learner_profiles([]) == []


def test_quiz_concepts_match_course_topics_by_shared_words() -> None:
    topics = [
        "Self-Attention (Q, K, V and scaled dot-product)",
        "Multi-Head Attention",
        "Recurrent Neural Network (RNN) — sequential processing",
        "Transformer (High-Level Overview)",
    ]
    assert match_topic("Q/K/V roles in self-attention", topics) == topics[0]
    assert match_topic("Sequential vs. parallel processing in sequence models", topics) == topics[2]
    assert match_topic("multi-head attention", topics) == topics[1]
    assert match_topic("Transformers overview", topics) == topics[3]
    # One shared generic word is not enough.
    assert match_topic("Attention span in classrooms", topics) is None
    assert match_topic("Photosynthesis", topics) is None


def test_topic_evidence_counts_each_student_once() -> None:
    rows = [
        {"student_id": "a", "mastery_score": 80, "total_answers": 3, "completed_teach_backs": 0},
        {"student_id": "a", "mastery_score": 40, "total_answers": 2, "completed_teach_backs": 0},
        {"student_id": "b", "mastery_score": 90, "total_answers": 0, "completed_teach_backs": 1},
        {"student_id": "c", "mastery_score": 10, "total_answers": 0, "completed_teach_backs": 0},
    ]
    assert topic_evidence(rows) == (2, 75)
    assert topic_evidence([]) == (0, None)
