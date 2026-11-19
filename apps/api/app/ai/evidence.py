import unicodedata
from collections.abc import Mapping

from app.ai.contracts import EvidenceChunk, EvidenceQuote


def normalize_whitespace(text: str) -> str:
    return " ".join(text.split())


# Characters a model types differently from how PDFs store them.
_SYMBOLS = str.maketrans({
    "\u2212": "-", "\u2013": "-", "\u2014": "-", "\u2010": "-", "\u2011": "-",
    "\u22c5": "*", "\u00b7": "*", "\u2219": "*", "\u00d7": "*",
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
})
# A quote shorter than this (ignoring spaces) could match almost any page.
MIN_QUOTE_CHARS = 12


def _folded(text: str) -> tuple[str, list[int]]:
    """Text reduced to comparable characters, with each one's position in the original.

    Unicode compatibility folding turns PDF maths letters into plain ones
    (the italic and bold x in a formula become "x"), symbols like the minus
    sign become ASCII, case is ignored and whitespace is dropped.
    """
    characters: list[str] = []
    positions: list[int] = []
    for index, character in enumerate(text):
        for piece in unicodedata.normalize("NFKC", character).translate(_SYMBOLS).casefold():
            if not piece.isspace():
                characters.append(piece)
                positions.append(index)
    return "".join(characters), positions


def find_quote(quote: str, content: str) -> str | None:
    """The passage of content that quote reproduces, in the content's own characters.

    Returns None unless the whole quote appears as one continuous passage.
    """
    target, _ = _folded(quote)
    if len(target) < MIN_QUOTE_CHARS:
        return None
    folded, positions = _folded(content)
    start = folded.find(target)
    if start < 0:
        return None
    first, last = positions[start], positions[start + len(target) - 1]
    return normalize_whitespace(content[first:last + 1])


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
        if (
            source is not None
            and source.chunk_id not in matched
            and find_quote(reference.quote, source.content) is not None
        ):
            matched[source.chunk_id] = source
    return list(matched.values())
