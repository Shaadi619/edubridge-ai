from app.routers.course_graph import _sample_chunks, _would_create_cycle


def test_sample_chunks_covers_each_document() -> None:
    chunks = [
        {"id": f"a-{index}", "material_id": "a", "chunk_index": index}
        for index in range(20)
    ] + [
        {"id": f"b-{index}", "material_id": "b", "chunk_index": index}
        for index in range(4)
    ]

    sampled = _sample_chunks(chunks, max_chunks=8)

    assert len(sampled) == 8
    assert {row["material_id"] for row in sampled} == {"a", "b"}
    assert {row["id"] for row in sampled if row["material_id"] == "a"} >= {"a-0", "a-19"}


def test_cycle_check_rejects_reverse_path() -> None:
    edges = [("vectors", "embeddings"), ("embeddings", "attention")]

    assert _would_create_cycle(edges, "attention", "vectors") is True
    assert _would_create_cycle(edges, "attention", "transformers") is False
    assert _would_create_cycle(edges, "vectors", "vectors") is True
