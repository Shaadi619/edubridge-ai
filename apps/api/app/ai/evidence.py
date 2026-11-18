from collections.abc import Mapping

from app.ai.contracts import EvidenceChunk, EvidenceQuote


def normalize_whitespace(text: str) -> str:
    return " ".join(text.split())


def course_source_index(chunks: list[EvidenceChunk]) -> dict[str, EvidenceChunk]:
    """Assign request-local references; stored chunk IDs stay on the server."""
    return {f"S{number}": chunk for number, chunk in enumerate(chunks, start=1)}


def course_source_payload(sources: Mapping[str, EvidenceChunk]) -> list[dict]:
    return [
        {"source_ref": ref, "page": chunk.page_number, "content": chunk.content}
        for ref, chunk in sources.items()
    ]


def referenced_chunks(references: list[str], evidence: Mapping[str, EvidenceChunk]) -> list[EvidenceChunk]:
    found: dict[str, EvidenceChunk] = {}
    for reference in references:
        source = evidence.get(reference.strip().upper())
        if source is not None:
            found.setdefault(source.chunk_id, source)
    return list(found.values())


def quoted_chunks(
    references: list[EvidenceQuote],
    evidence: Mapping[str, EvidenceChunk],
) -> list[EvidenceChunk]:
    """Return distinct supplied chunks with a matching continuous quote."""
    matched: dict[str, EvidenceChunk] = {}
    for reference in references:
        source = evidence.get(reference.chunk_id)
        quote = normalize_whitespace(reference.quote)
        if (
            source is not None
            and source.chunk_id not in matched
            and quote
            and quote in normalize_whitespace(source.content)
        ):
            matched[source.chunk_id] = source
    return list(matched.values())
