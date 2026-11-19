import re


_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "concept", "does", "for", "in", "is", "it",
    "like", "misconception", "of", "on", "or", "processing", "same", "the", "to", "vs", "versus",
}
_ACRONYMS = {"ai": "AI", "gpt": "GPT", "llm": "LLM", "nlp": "NLP", "qkv": "QKV", "rnn": "RNN"}


def friendly_concept(value: str) -> str:
    """Turn model identifiers into short user-facing concept titles."""
    cleaned = re.sub(r"[_-]+", " ", value).strip()
    if not cleaned:
        return "Course concept"
    words = cleaned.split()
    if "_" in value or ("-" in value and " " not in value):
        words = [_ACRONYMS.get(word.lower(), word.capitalize()) for word in words]
        return " ".join(words)
    titled = re.sub(r"\brnns?\b", "RNNs", cleaned, flags=re.IGNORECASE)
    # "sequential processing misconception" is a mistake about sequential processing.
    trimmed = re.sub(r"\s+(misconceptions?|misunderstandings?|errors?)$", "", titled, flags=re.IGNORECASE).strip()
    titled = trimmed or titled
    return titled[:1].upper() + titled[1:]


def concept_terms(*values: str | None) -> set[str]:
    terms: set[str] = set()
    for value in values:
        for token in re.findall(r"[a-z0-9]+", value.lower() if value else ""):
            if token in _STOP_WORDS:
                continue
            if token == "rnns":
                token = "rnn"
            elif token.endswith("s") and len(token) > 4:
                token = token[:-1]
            terms.add(token)
    return terms


def related_concepts(left: dict, right: dict) -> bool:
    left_terms = concept_terms(left.get("concept"), left.get("label"), left.get("student_evidence"))
    right_terms = concept_terms(right.get("concept"), right.get("label"), right.get("student_evidence"))
    if not left_terms or not right_terms:
        return False
    overlap = left_terms & right_terms
    return len(overlap) >= 3 and len(overlap) / min(len(left_terms), len(right_terms)) >= 0.35


def group_concept_records(rows: list[dict]) -> list[list[dict]]:
    """Group only strongly overlapping records for the same student, newest first."""
    groups: list[list[dict]] = []
    for row in rows:
        match = next((group for group in groups if group[0].get("student_id") == row.get("student_id") and any(related_concepts(row, item) for item in group)), None)
        if match is None:
            groups.append([row])
        else:
            match.append(row)
    return groups
