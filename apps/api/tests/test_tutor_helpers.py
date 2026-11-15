from app.routers.tutor import _normalized, _remove_internal_references, _same_concept


def test_visible_answer_removes_internal_citation_json() -> None:
    answer = 'Transformers process tokens in parallel.[{"chunk_id":"04157bf4-2669-427b-bdd7-2f5e86d2d4a7","page_number":73}]'
    assert _remove_internal_references(answer) == "Transformers process tokens in parallel."


def test_repeated_transformer_rnn_wording_is_same_concept() -> None:
    assert _same_concept("Transformer vs RNN processing", "Transformers and RNNs")


def test_evidence_normalization_preserves_exact_claim_match() -> None:
    question = "Transformers read words one at a time like an RNN"
    assert _normalized("Transformers read words one at a time") in _normalized(question)
