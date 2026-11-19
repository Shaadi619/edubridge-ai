from app.routers.tutor import _normalized, _remove_internal_references, _same_concept


def test_visible_answer_removes_internal_citation_json() -> None:
    answer = 'Transformers process tokens in parallel.[{"chunk_id":"04157bf4-2669-427b-bdd7-2f5e86d2d4a7","page_number":73}]'
    assert _remove_internal_references(answer) == "Transformers process tokens in parallel."


def test_repeated_transformer_rnn_wording_is_same_concept() -> None:
    assert _same_concept("Transformer vs RNN processing", "Transformers and RNNs")


def test_evidence_normalization_preserves_exact_claim_match() -> None:
    question = "Transformers read words one at a time like an RNN"
    assert _normalized("Transformers read words one at a time") in _normalized(question)


def test_visible_text_removes_bracketed_chunk_id_lists() -> None:
    text = (
        "RNNs process inputs token-by-token, which can make long-range dependencies hard to capture "
        "[chunk_id: 822e948d-4ddd-4b1d-8365-e60101795d11; chunk_id: 127abc93-30be-49a8-8fff-7748bb76d084]. "
        "Decoding is iterative (chunk_id 99890a2c-91dd-4c0e-aede-4cdd9ea8c7b7)."
    )
    assert _remove_internal_references(text) == (
        "RNNs process inputs token-by-token, which can make long-range dependencies hard to capture. "
        "Decoding is iterative."
    )


def test_visible_text_removes_stray_ids_but_keeps_line_breaks() -> None:
    text = "1) Introduce the goal 65a97f14-96a2-4708-b61a-78b01d5cffd2.\n2) Pair work."
    assert _remove_internal_references(text) == "1) Introduce the goal.\n2) Pair work."
