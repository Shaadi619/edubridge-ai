from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


CHUNK_SIZE = 1200
CHUNK_OVERLAP = 150


@dataclass
class ExtractedChunk:
    text: str
    source_page: int | None = None


@dataclass
class ExtractionResult:
    status: str
    preview: str
    chunks: list[ExtractedChunk]


def extract_material(path: Path, content_type: str) -> ExtractionResult:
    suffix = path.suffix.lower()
    if content_type == "application/pdf" or suffix == ".pdf":
        return extract_pdf(path)
    if content_type.startswith("text/") or suffix in {".txt", ".md"}:
        text = path.read_text(encoding="utf-8", errors="ignore")
        chunks = chunk_text(text)
        return ExtractionResult(
            status="ready" if chunks else "uploaded",
            preview=preview_text(text) if chunks else "No text could be extracted from this file yet.",
            chunks=chunks,
        )

    return ExtractionResult(
        status="uploaded",
        preview="Text extraction is not enabled for this file type yet.",
        chunks=[],
    )


def extract_pdf(path: Path) -> ExtractionResult:
    reader = PdfReader(str(path))
    chunks: list[ExtractedChunk] = []
    page_texts: list[str] = []

    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = normalize_text(text)
        if not text:
            continue
        page_texts.append(text)
        chunks.extend(chunk_text(text, source_page=page_number))

    full_text = "\n\n".join(page_texts)
    if not chunks:
        return ExtractionResult(
            status="uploaded",
            preview="No selectable text found. OCR will be needed for this document.",
            chunks=[],
        )

    return ExtractionResult(
        status="ready",
        preview=preview_text(full_text),
        chunks=chunks,
    )


def chunk_text(text: str, source_page: int | None = None) -> list[ExtractedChunk]:
    normalized = normalize_text(text)
    if not normalized:
        return []

    chunks: list[ExtractedChunk] = []
    start = 0
    while start < len(normalized):
        end = min(start + CHUNK_SIZE, len(normalized))
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(ExtractedChunk(text=chunk, source_page=source_page))
        if end == len(normalized):
            break
        start = max(0, end - CHUNK_OVERLAP)
    return chunks


def normalize_text(text: str) -> str:
    return " ".join(text.split())


def preview_text(text: str, limit: int = 500) -> str:
    normalized = normalize_text(text)
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rsplit(" ", 1)[0] + "..."
