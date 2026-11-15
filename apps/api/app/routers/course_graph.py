import json
from collections import defaultdict
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai.azure_provider import AzureOpenAIProvider
from app.ai.contracts import AITier
from app.ai.prompts import COURSE_GRAPH_SYSTEM_PROMPT
from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.routers.study_plans import concept_key
from app.routers.tutor import _source_kind

router = APIRouter(prefix="/courses", tags=["course graph"])


class GraphEvidenceRef(BaseModel):
    chunk_id: str


class SuggestedTopicResult(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=300)
    confidence: float = Field(ge=0, le=1)
    citations: list[GraphEvidenceRef] = Field(min_length=1, max_length=3)


class SuggestedRelationshipResult(BaseModel):
    prerequisite: str = Field(min_length=1, max_length=120)
    topic: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=400)
    confidence: float = Field(ge=0, le=1)
    citations: list[GraphEvidenceRef] = Field(min_length=1, max_length=3)


class CourseGraphResult(BaseModel):
    summary: str = Field(min_length=1, max_length=600)
    topics: list[SuggestedTopicResult] = Field(min_length=2, max_length=20)
    relationships: list[SuggestedRelationshipResult] = Field(default_factory=list, max_length=30)


class FriendlyCitation(BaseModel):
    document_title: str
    page_number: int | None
    source_kind: str


class SuggestedTopic(BaseModel):
    name: str
    description: str
    confidence: float
    citations: list[FriendlyCitation]


class SuggestedRelationship(BaseModel):
    prerequisite: str
    topic: str
    reason: str
    confidence: float
    citations: list[FriendlyCitation]


class CourseGraphSuggestion(BaseModel):
    summary: str
    topics: list[SuggestedTopic]
    relationships: list[SuggestedRelationship]
    documents_analyzed: int
    excerpts_analyzed: int


class ApplyRelationship(BaseModel):
    prerequisite: str = Field(min_length=1, max_length=120)
    topic: str = Field(min_length=1, max_length=120)
    reason: str | None = Field(default=None, max_length=400)
    confidence: float | None = Field(default=None, ge=0, le=1)
    citations: list[FriendlyCitation] = Field(default_factory=list, max_length=3)


class ApplyGraphRequest(BaseModel):
    topics: list[str] = Field(default_factory=list, max_length=25)
    relationships: list[ApplyRelationship] = Field(default_factory=list, max_length=40)


def _sample_chunks(chunks: list[dict], max_chunks: int = 36) -> list[dict]:
    """Sample evenly across every document instead of over-representing its first pages."""
    grouped: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        grouped[str(chunk["material_id"])].append(chunk)
    if not grouped:
        return []
    for rows in grouped.values():
        rows.sort(key=lambda row: row.get("chunk_index", 0))
    per_document = max(1, max_chunks // len(grouped))
    selected: list[dict] = []
    leftovers: list[dict] = []
    for rows in grouped.values():
        take = min(len(rows), per_document)
        if take == len(rows):
            chosen_indexes = set(range(len(rows)))
        elif take == 1:
            chosen_indexes = {0}
        else:
            chosen_indexes = {round(index * (len(rows) - 1) / (take - 1)) for index in range(take)}
        selected.extend(rows[index] for index in sorted(chosen_indexes))
        leftovers.extend(row for index, row in enumerate(rows) if index not in chosen_indexes)
    selected.extend(leftovers[: max(0, max_chunks - len(selected))])
    return selected[:max_chunks]


def _would_create_cycle(edges: list[tuple[str, str]], prerequisite: str, topic: str) -> bool:
    if prerequisite == topic:
        return True
    outgoing: dict[str, set[str]] = defaultdict(set)
    for source, target in edges:
        outgoing[source].add(target)
    stack = [topic]
    visited: set[str] = set()
    while stack:
        current = stack.pop()
        if current == prerequisite:
            return True
        if current in visited:
            continue
        visited.add(current)
        stack.extend(outgoing.get(current, set()))
    return False


async def _teacher_course(
    client: httpx.AsyncClient, base: str, headers: dict, course_id: str, user_id: str,
) -> dict:
    response = await client.get(
        f"{base}/rest/v1/courses", headers=headers,
        params={"id": f"eq.{course_id}", "select": "id,name,subject,teacher_id", "limit": "1"},
    )
    response.raise_for_status()
    rows = response.json()
    if not rows:
        raise HTTPException(status_code=404, detail="Course not found")
    if rows[0]["teacher_id"] != user_id:
        raise HTTPException(status_code=403, detail="Only the course teacher can manage its prerequisite graph")
    return rows[0]


@router.post("/{course_id}/prerequisite-graph/suggest", response_model=CourseGraphSuggestion)
async def suggest_course_graph(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> CourseGraphSuggestion:
    if not (settings.azure_openai_endpoint and settings.azure_openai_api_key and settings.azure_openai_tier1_deployment):
        raise HTTPException(status_code=503, detail="The course graph model is not configured")
    course_id_string = str(course_id)
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=60) as client:
        course = await _teacher_course(client, base, headers, course_id_string, user.id)
        materials_response = await client.get(
            f"{base}/rest/v1/materials", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "status": "eq.ready", "select": "id,title", "order": "created_at.asc"},
        )
        materials_response.raise_for_status()
        materials = materials_response.json()
        if not materials:
            raise HTTPException(status_code=422, detail="Upload and finish processing at least one document before generating suggestions")
        chunks_response = await client.get(
            f"{base}/rest/v1/material_chunks", headers=headers,
            params={
                "course_id": f"eq.{course_id_string}", "select": "id,material_id,page_number,chunk_index,content",
                "order": "material_id.asc,chunk_index.asc", "limit": "300",
            },
        )
        chunks_response.raise_for_status()
        sampled = _sample_chunks(chunks_response.json())
        if not sampled:
            raise HTTPException(status_code=422, detail="No indexed document text is available for graph analysis")
        material_titles = {str(row["id"]): row["title"] for row in materials}
        evidence = [{
            "chunk_id": str(row["id"]),
            "document_title": material_titles.get(str(row["material_id"]), "Course document"),
            "page_number": row.get("page_number"),
            "content": row["content"][:1600],
        } for row in sampled]
        provider = AzureOpenAIProvider(
            endpoint=settings.azure_openai_endpoint, api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
            fast_deployment=settings.azure_openai_tier1_deployment,
            reasoning_deployment=settings.azure_openai_tier2_deployment,
        )
        result = await provider.generate_structured(
            tier=AITier.FAST,
            system_prompt=COURSE_GRAPH_SYSTEM_PROMPT,
            user_prompt=json.dumps({
                "course": {"name": course["name"], "subject": course.get("subject")},
                "course_evidence": evidence,
                "instruction": "Propose a compact prerequisite DAG. Every citation must use a chunk_id supplied in course_evidence.",
            }),
            output_type=CourseGraphResult,
        )

    canonical = {item["chunk_id"]: item for item in evidence}

    def friendly(refs: list[GraphEvidenceRef]) -> list[FriendlyCitation]:
        seen: set[tuple[str, int | None]] = set()
        output: list[FriendlyCitation] = []
        for ref in refs:
            source = canonical.get(ref.chunk_id)
            if not source:
                continue
            location = (source["document_title"], source["page_number"])
            if location in seen:
                continue
            seen.add(location)
            output.append(FriendlyCitation(
                document_title=source["document_title"], page_number=source["page_number"],
                source_kind=_source_kind(source["document_title"], source["page_number"]),
            ))
        return output[:3]

    topic_names: dict[str, str] = {}
    topics: list[SuggestedTopic] = []
    for topic in result.topics:
        citations = friendly(topic.citations)
        key_name = concept_key(topic.name)
        if not key_name or key_name in topic_names or not citations:
            continue
        topic_names[key_name] = topic.name.strip()
        topics.append(SuggestedTopic(
            name=topic.name.strip(), description=topic.description.strip(),
            confidence=topic.confidence, citations=citations,
        ))

    accepted_edges: list[tuple[str, str]] = []
    relationships: list[SuggestedRelationship] = []
    for link in sorted(result.relationships, key=lambda item: item.confidence, reverse=True):
        prerequisite = topic_names.get(concept_key(link.prerequisite))
        topic = topic_names.get(concept_key(link.topic))
        citations = friendly(link.citations)
        if not prerequisite or not topic or not citations:
            continue
        edge = (concept_key(prerequisite), concept_key(topic))
        if edge in accepted_edges or _would_create_cycle(accepted_edges, *edge):
            continue
        accepted_edges.append(edge)
        relationships.append(SuggestedRelationship(
            prerequisite=prerequisite, topic=topic, reason=link.reason.strip(),
            confidence=link.confidence, citations=citations,
        ))
    if len(topics) < 2:
        raise HTTPException(status_code=422, detail="The documents did not contain enough grounded concepts to propose a graph")
    return CourseGraphSuggestion(
        summary=result.summary.strip(), topics=topics, relationships=relationships,
        documents_analyzed=len(materials), excerpts_analyzed=len(evidence),
    )


@router.post("/{course_id}/prerequisite-graph/apply")
async def apply_course_graph(
    course_id: UUID,
    request: ApplyGraphRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    course_id_string = str(course_id)
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
    base = settings.supabase_url.rstrip("/")
    requested_names: dict[str, str] = {}
    for raw_name in [*request.topics, *(link.prerequisite for link in request.relationships), *(link.topic for link in request.relationships)]:
        name = raw_name.strip()
        normalized = concept_key(name)
        if normalized:
            requested_names.setdefault(normalized, name)
    if not requested_names:
        raise HTTPException(status_code=400, detail="Select at least one suggested topic")

    async with httpx.AsyncClient(timeout=30) as client:
        await _teacher_course(client, base, headers, course_id_string, user.id)
        topics_response = await client.get(
            f"{base}/rest/v1/course_topics", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "id,name"},
        )
        topics_response.raise_for_status()
        existing_topics = topics_response.json()
        names_by_key = {concept_key(row["name"]): row["name"] for row in existing_topics}
        topic_ids = {concept_key(row["name"]): row["id"] for row in existing_topics}

        links_response = await client.get(
            f"{base}/rest/v1/course_topic_prerequisites", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "topic_id,prerequisite_topic_id"},
        )
        links_response.raise_for_status()
        key_by_id = {row["id"]: concept_key(row["name"]) for row in existing_topics}
        graph_edges = [
            (key_by_id[row["prerequisite_topic_id"]], key_by_id[row["topic_id"]])
            for row in links_response.json()
            if row["prerequisite_topic_id"] in key_by_id and row["topic_id"] in key_by_id
        ]
        requested_edges: list[tuple[str, str]] = []
        for link in request.relationships:
            edge = (concept_key(link.prerequisite), concept_key(link.topic))
            if edge in graph_edges or edge in requested_edges:
                continue
            if _would_create_cycle([*graph_edges, *requested_edges], *edge):
                raise HTTPException(status_code=422, detail=f"{link.prerequisite} → {link.topic} would create a circular prerequisite")
            requested_edges.append(edge)

        missing = [
            {"course_id": course_id_string, "name": name, "weight": "medium"}
            for normalized, name in requested_names.items() if normalized not in names_by_key
        ]
        if missing:
            create_response = await client.post(f"{base}/rest/v1/course_topics", headers=headers, json=missing)
            create_response.raise_for_status()
            for row in create_response.json():
                normalized = concept_key(row["name"])
                topic_ids[normalized] = row["id"]
                names_by_key[normalized] = row["name"]
        requested_by_edge = {
            (concept_key(link.prerequisite), concept_key(link.topic)): link for link in request.relationships
        }
        new_links = [{
            "course_id": course_id_string,
            "prerequisite_topic_id": topic_ids[prerequisite],
            "topic_id": topic_ids[topic],
            "source": "ai_suggested",
            "reason": requested_by_edge[(prerequisite, topic)].reason,
            "confidence": requested_by_edge[(prerequisite, topic)].confidence,
            "evidence": [citation.model_dump() for citation in requested_by_edge[(prerequisite, topic)].citations],
        } for prerequisite, topic in requested_edges]
        if new_links:
            create_links = await client.post(f"{base}/rest/v1/course_topic_prerequisites", headers=headers, json=new_links)
            if create_links.status_code == 400 and any(column in create_links.text for column in ('"source"', '"reason"', '"confidence"', '"evidence"')):
                basic_links = [{
                    "course_id": row["course_id"],
                    "prerequisite_topic_id": row["prerequisite_topic_id"],
                    "topic_id": row["topic_id"],
                } for row in new_links]
                create_links = await client.post(f"{base}/rest/v1/course_topic_prerequisites", headers=headers, json=basic_links)
            create_links.raise_for_status()
    return {"topics_added": len(missing), "relationships_added": len(new_links)}
