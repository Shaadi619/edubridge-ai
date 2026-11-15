import re


def _key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")[:160]


def _match_score(left: str, right: str) -> tuple[int, float]:
    left_key, right_key = _key(left), _key(right)
    if left_key == right_key:
        return (3, 1.0)
    if left_key and right_key and (left_key in right_key or right_key in left_key):
        return (2, min(len(left_key), len(right_key)) / max(len(left_key), len(right_key)))
    left_tokens, right_tokens = set(left_key.split("-")), set(right_key.split("-"))
    overlap = len(left_tokens & right_tokens) / max(len(left_tokens | right_tokens), 1)
    return (1 if overlap >= 0.5 else 0, overlap)


def ordered_prerequisite_concepts(focus_concept: str, topics: list[dict], links: list[dict]) -> list[str]:
    topic_by_id = {str(topic["id"]): topic["name"] for topic in topics}
    ranked = sorted(topics, key=lambda topic: _match_score(topic["name"], focus_concept), reverse=True)
    if not ranked or _match_score(ranked[0]["name"], focus_concept)[0] == 0:
        return []
    focus_id = str(ranked[0]["id"])
    prerequisites_by_topic: dict[str, list[str]] = {}
    for link in links:
        prerequisites_by_topic.setdefault(str(link["topic_id"]), []).append(str(link["prerequisite_topic_id"]))
    ordered: list[str] = []
    visited: set[str] = set()

    def visit(topic_id: str) -> None:
        for prerequisite_id in prerequisites_by_topic.get(topic_id, []):
            if prerequisite_id in visited:
                continue
            visited.add(prerequisite_id)
            visit(prerequisite_id)
            if prerequisite_id in topic_by_id:
                ordered.append(topic_by_id[prerequisite_id])

    visit(focus_id)
    return ordered


def find_prerequisite_gap(
    focus_concept: str, topics: list[dict], links: list[dict], mastery_rows: list[dict], threshold: float = 70,
) -> dict | None:
    """Return the earliest evidenced weak prerequisite; absence of evidence is not labeled a gap."""
    for prerequisite in ordered_prerequisite_concepts(focus_concept, topics, links):
        ranked = sorted(mastery_rows, key=lambda row: _match_score(row.get("concept", ""), prerequisite), reverse=True)
        if not ranked or _match_score(ranked[0].get("concept", ""), prerequisite)[0] == 0:
            continue
        row = ranked[0]
        evidence_count = int(row.get("total_answers") or 0) + int(row.get("completed_teach_backs") or 0) * 2
        open_misconceptions = int(row.get("open_misconceptions") or 0)
        score = float(row.get("mastery_score") or 0)
        if (evidence_count > 0 and score < threshold) or open_misconceptions > 0:
            return {
                "prerequisite_concept": prerequisite,
                "downstream_concept": focus_concept,
                "mastery_score": round(score),
                "evidence_count": evidence_count,
                "open_misconceptions": open_misconceptions,
            }
    return None
