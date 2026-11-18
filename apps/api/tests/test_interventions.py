from datetime import UTC, datetime, timedelta

from app.routers.quizzes import _class_misconception_network, _confidence_gap_records, _intervention_queue, _prerequisite_concepts, _prerequisite_gap_records


def test_repeated_misconception_is_high_priority() -> None:
    now = datetime.now(UTC)
    queue = _intervention_queue(
        [{
            "id": "mis-1", "student_id": "student-1", "concept": "Self-attention",
            "status": "open", "occurrence_count": 2, "retention_status": "not_scheduled",
            "created_at": now.isoformat(), "last_detected_at": now.isoformat(),
        }],
        [],
        {"student-1": "Sam Student"},
        now,
    )

    assert queue[0]["priority"] == "high"
    assert queue[0]["source"] == "misconception"
    assert queue[0]["student"] == "Sam Student"


def test_misconception_items_carry_the_students_words_and_id() -> None:
    now = datetime.now(UTC)
    queue = _intervention_queue(
        [{
            "id": "mis-1", "student_id": "student-1", "concept": "Transformers",
            "student_evidence": "the same as the one from the movie",
            "status": "open", "occurrence_count": 1, "retention_status": "not_scheduled",
            "created_at": now.isoformat(), "last_detected_at": now.isoformat(),
        }],
        [],
        {"student-1": "Sam Student"},
        now,
        {"mis-1": [{"document_title": "Transformers.pdf", "page_number": 11, "source_kind": "page", "chunk_id": "chunk-11"}]},
    )

    assert queue[0]["misconception_id"] == "mis-1"
    assert queue[0]["student_evidence"] == "the same as the one from the movie"
    assert queue[0]["citations"][0]["chunk_id"] == "chunk-11"


def test_teacher_assignment_is_persistently_reported() -> None:
    now = datetime.now(UTC)
    queue = _intervention_queue(
        [{
            "id": "mis-1", "student_id": "student-1", "concept": "Transformers",
            "status": "open", "occurrence_count": 1, "retention_status": "not_scheduled",
            "created_at": now.isoformat(), "last_detected_at": now.isoformat(),
        }],
        [{
            "id": "plan-1", "student_id": "student-1", "concept": "Transformers",
            "action": "Teacher assigned: complete a targeted quiz.", "status": "pending",
            "due_at": (now + timedelta(days=3)).isoformat(),
        }],
        {"student-1": "Sam Student"},
        now,
    )

    assert queue[0]["practice_assigned"] is True


def test_class_network_counts_shared_student_concepts() -> None:
    rows = [
        {"id": "1", "student_id": "a", "concept": "Self-attention", "status": "open", "occurrence_count": 2},
        {"id": "2", "student_id": "a", "concept": "Positional encoding", "status": "open", "occurrence_count": 1},
        {"id": "3", "student_id": "b", "concept": "Self-attention", "status": "open", "occurrence_count": 1},
        {"id": "4", "student_id": "b", "concept": "Positional encoding", "status": "open", "occurrence_count": 1},
    ]

    network = _class_misconception_network(rows)

    assert len(network["nodes"]) == 2
    assert network["edges"][0]["shared_students"] == 2
    assert network["hub_concept"] is not None


def test_confident_wrong_answer_creates_gap_record() -> None:
    gaps = _confidence_gap_records(
        [{"attempt_id": "attempt-1", "question_id": "question-1", "is_correct": False, "confidence": 3}],
        {"attempt-1": "student-1"},
        {"question-1": "Self-attention"},
    )

    assert gaps == [{"student_id": "student-1", "concept": "Self Attention", "count": 1, "last_detected_at": None}]


def test_prerequisites_are_ordered_from_root_to_focus() -> None:
    topics = [{"id": "a", "name": "Vectors"}, {"id": "b", "name": "Embeddings"}, {"id": "c", "name": "Self-attention"}]
    links = [
        {"topic_id": "c", "prerequisite_topic_id": "b"},
        {"topic_id": "b", "prerequisite_topic_id": "a"},
    ]

    assert _prerequisite_concepts("Self attention", topics, links) == ["Vectors", "Embeddings"]


def test_prerequisites_match_a_more_specific_learning_signal() -> None:
    topics = [{"id": "a", "name": "Sequence models"}, {"id": "b", "name": "Self-attention"}]
    links = [{"topic_id": "b", "prerequisite_topic_id": "a"}]

    assert _prerequisite_concepts("Self-attention mechanism", topics, links) == ["Sequence models"]


def test_prerequisite_gap_requires_real_weakness_evidence() -> None:
    topics = [{"id": "a", "name": "Embeddings"}, {"id": "b", "name": "Transformers"}]
    links = [{
        "topic_id": "b", "prerequisite_topic_id": "a",
        "evidence": [{"document_title": "Transformers.pdf", "page_number": 12, "source_kind": "page"}],
    }]
    signal = [{"student_id": "student-1", "concept": "Transformers", "detected_at": None, "citations": []}]

    no_evidence = _prerequisite_gap_records(signal, {"student-1": []}, topics, links)
    weak_evidence = _prerequisite_gap_records(signal, {"student-1": [{
        "concept": "Embeddings", "mastery_score": 40, "total_answers": 3,
        "completed_teach_backs": 0, "open_misconceptions": 0,
    }]}, topics, links)

    assert no_evidence == []
    assert weak_evidence[0]["prerequisite_concept"] == "Embeddings"
    assert weak_evidence[0]["citations"][0]["page_number"] == 12


def test_prerequisite_gap_is_prioritized_in_teacher_queue() -> None:
    now = datetime.now(UTC)
    queue = _intervention_queue([], [], {"student-1": "Sam Student"}, now, prerequisite_gaps=[{
        "student_id": "student-1", "prerequisite_concept": "Embeddings",
        "downstream_concept": "Transformers", "mastery_score": 35,
        "evidence_count": 4, "open_misconceptions": 0, "detected_at": now.isoformat(), "citations": [],
    }])

    assert queue[0]["source"] == "prerequisite_gap"
    assert queue[0]["concept"] == "Embeddings"
    assert "Transformers" in queue[0]["reason"]


def test_students_words_win_over_an_overdue_task_on_the_same_concept() -> None:
    now = datetime.now(UTC)
    queue = _intervention_queue(
        [{
            "id": "mis-1", "student_id": "student-1", "concept": "Transformers",
            "student_evidence": "the same as the one from the movie",
            "status": "open", "occurrence_count": 1, "retention_status": "not_scheduled",
            "created_at": now.isoformat(), "last_detected_at": now.isoformat(),
        }],
        [{
            "id": "plan-1", "student_id": "student-1", "concept": "Transformers",
            "action": "Review transformers", "status": "pending",
            "due_at": (now - timedelta(days=30)).isoformat(),
        }],
        {"student-1": "Sam Student"},
        now,
    )

    assert len(queue) == 1
    assert queue[0]["source"] == "misconception"
    assert queue[0]["student_evidence"] == "the same as the one from the movie"
    assert queue[0]["overdue_task"] is True


def test_overdue_tasks_do_not_push_flags_with_student_words_out_of_the_queue() -> None:
    now = datetime.now(UTC)
    plans = [{
        "id": f"plan-{index}", "student_id": "student-1", "concept": f"Topic {index}",
        "action": "Practice", "status": "pending", "due_at": (now - timedelta(days=60 - index)).isoformat(),
    } for index in range(30)]
    queue = _intervention_queue(
        [{
            "id": "mis-1", "student_id": "student-1", "concept": "Transformers",
            "student_evidence": "the same as the one from the movie",
            "status": "open", "occurrence_count": 1, "retention_status": "not_scheduled",
            "created_at": now.isoformat(), "last_detected_at": now.isoformat(),
        }],
        plans,
        {"student-1": "Sam Student"},
        now,
    )

    assert any(item["source"] == "misconception" for item in queue)
