from collections.abc import Mapping

from app.ai.contracts import EvidenceChunk, EvidenceQuote


def normalize_whitespace(text: str) -> str:
    return " ".join(text.split())


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
