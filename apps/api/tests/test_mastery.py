from app.concepts import friendly_concept, group_concept_records, related_concepts
from app.mastery import _score, evidence_count


def test_mastery_requires_real_evidence() -> None:
    assert _score(0, 0, 1) == 0
    assert evidence_count(0, 1) == 2


def test_single_answer_is_smoothed_instead_of_showing_one_hundred_percent() -> None:
    assert _score(1, 1, 0) == 66.67


def test_verified_teach_back_is_positive_evidence() -> None:
    assert _score(0, 0, 0, completed_teach_backs=1, verified_teach_backs=1) == 75


def test_open_misconception_caps_mastery() -> None:
    assert _score(6, 6, 1) == 49


def test_internal_concept_identifier_becomes_readable() -> None:
    assert friendly_concept("model_architecture_equivalence") == "Model Architecture Equivalence"
    assert friendly_concept("sequential-processing misconception") == "Sequential processing"
    assert friendly_concept("rnn vs transformers") == "RNNs vs transformers"


def test_related_transformer_rnn_records_are_grouped() -> None:
    older = {
        "student_id": "student",
        "concept": "Sequential vs. parallel processing in sequence models",
        "label": "sequential-processing-misconception",
        "student_evidence": "Transformers read words one at a time like an RNN",
    }
    newer = {
        "student_id": "student",
        "concept": "model_architecture_equivalence",
        "label": "equivalence_of_transformers_and_RNNs",
        "student_evidence": "are transformers same as rnns",
    }
    assert related_concepts(older, newer)
    assert len(group_concept_records([newer, older])) == 1
