import re
from collections import defaultdict
from statistics import median
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends

from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.routers.course_graph import _teacher_course
from app.routers.study_plans import concept_key
from app.routers.tutor import _source_kind

router = APIRouter(prefix="/courses/teacher", tags=["course digital twin"])

_STOPWORDS = {
    "and", "for", "from", "into", "model", "models", "of", "on", "or",
    "the", "to", "versus", "with", "vs",
}


def topic_tokens(value: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) >= 3 and token not in _STOPWORDS
    }


def chunk_supports_topic(topic: str, content: str) -> bool:
    normalized_topic = " ".join(re.findall(r"[a-z0-9]+", topic.lower()))
    normalized_content = " ".join(re.findall(r"[a-z0-9]+", content.lower()))
    if normalized_topic and f" {normalized_topic} " in f" {normalized_content} ":
        return True
    expected = topic_tokens(topic)
    if not expected:
        return False
    observed = topic_tokens(content)
    required = 1 if len(expected) == 1 else min(2, len(expected))
    return len(expected & observed) >= required


def assessment_issues(
    question: dict,
    known_topic_keys: set[str],
    supported_topic_keys: set[str],
) -> list[dict]:
    """Find reviewable assessment risks without making a semantic correctness claim."""
    issues: list[dict] = []
    prompt = str(question.get("prompt") or "").strip()
    options = [str(option).strip() for option in (question.get("options") or [])]
    correct_option = int(question.get("correct_option") or 0)
    concept = str(question.get("concept") or "").strip()
    topic_key = concept_key(concept)

    def add(code: str, severity: str, label: str, detail: str, recommendation: str) -> None:
        issues.append({
            "code": code, "severity": severity, "label": label,
            "detail": detail, "recommendation": recommendation,
        })

    normalized_options = [" ".join(re.findall(r"[a-z0-9]+", option.lower())) for option in options]
    if not options or correct_option >= len(options):
        add(
            "invalid_answer", "high", "Invalid answer key",
            "The recorded correct option does not point to an available answer.",
            "Correct the answer key before students receive this question.",
        )
    if len(set(normalized_options)) != len(normalized_options):
        add(
            "duplicate_options", "high", "Duplicate answer options",
            "Two or more answer choices are identical after punctuation and case are ignored.",
            "Replace the duplicate choices with distinct, plausible alternatives.",
        )
    prompt_words = re.findall(r"[a-z0-9]+", prompt.lower())
    if len(prompt_words) < 5:
        add(
            "short_prompt", "medium", "Very short question stem",
            "The prompt may not provide enough context for a single clear interpretation.",
            "Add the specific situation, relationship, or task the student should evaluate.",
        )
    if re.search(r"\b(?:not|except|least)\b", prompt, flags=re.IGNORECASE):
        add(
            "negative_stem", "low", "Negative question wording",
            "Negative stems can be misread and may measure attention more than understanding.",
            "Prefer positive wording, or make the negative term visually explicit.",
        )
    if topic_key not in known_topic_keys:
        add(
            "unmapped_concept", "high", "Concept is outside the course map",
            f"The question is labelled “{concept or 'Unspecified'}”, which does not match an approved course topic.",
            "Map the question to an existing topic or add the missing topic to the course graph.",
        )
    elif topic_key not in supported_topic_keys:
        add(
            "unsupported_concept", "high", "No mapped teaching material",
            "The question targets a topic that has no clearly matched section in indexed course material.",
            "Identify the supporting page or add material before using this assessment.",
        )
    if len(options) >= 3:
        lengths = [len(option) for option in options if option]
        if lengths and max(lengths) >= max(40, median(lengths) * 3):
            add(
                "length_cue", "low", "Answer-length cue",
                "One option is substantially longer than the others and may reveal the intended answer.",
                "Make answer choices similar in specificity and grammatical structure.",
            )
    option_token_sets = [set(re.findall(r"[a-z0-9]+", option.lower())) for option in options]
    for left_index, left in enumerate(option_token_sets):
        for right in option_token_sets[left_index + 1:]:
            union = left | right
            if min(len(left), len(right)) >= 3 and union and len(left & right) / len(union) >= 0.8:
                add(
                    "overlapping_options", "medium", "Highly overlapping answer options",
                    "Two answer choices use nearly the same meaning or wording.",
                    "Clarify the distinction so only one option is defensibly correct.",
                )
                return issues
    return issues


def simulated_learner_profiles(topic_rows: list[dict]) -> list[dict]:
    """Build transparent course-path scenarios without using or predicting student data."""
    if not topic_rows:
        return []

    by_name = {row["name"]: row for row in topic_rows}
    weight_rank = {"high": 0, "medium": 1, "low": 2}

    def ordered(rows: list[dict]) -> list[dict]:
        return sorted(
            rows,
            key=lambda row: (
                weight_rank.get(row.get("weight", "medium"), 1),
                row.get("readiness", 0),
                row["name"].lower(),
            ),
        )

    def path_from(initial_mastery: set[str]) -> list[str]:
        mastered = set(initial_mastery)
        path: list[str] = []
        while len(mastered) < len(topic_rows):
            available = ordered([
                row for row in topic_rows
                if row["name"] not in mastered
                and set(row.get("prerequisites", [])) <= mastered
            ])
            if not available:
                break
            selected = available[0]
            mastered.add(selected["name"])
            path.append(selected["name"])
        return path

    def blocked_from(mastered: set[str]) -> list[dict]:
        return [
            {
                "topic": row["name"],
                "missing_prerequisites": sorted(set(row.get("prerequisites", [])) - mastered),
            }
            for row in topic_rows
            if row["name"] not in mastered
            and set(row.get("prerequisites", [])) - mastered
        ]

    def descendants(start: str) -> list[str]:
        found: list[str] = []
        pending = list(by_name[start].get("unlocks", []))
        while pending:
            name = pending.pop(0)
            if name in found or name not in by_name:
                continue
            found.append(name)
            pending.extend(by_name[name].get("unlocks", []))
        return found

    def learning_step(name: str) -> dict:
        row = by_name[name]
        has_material = bool(row.get("material_sources"))
        questions = int(row.get("assessment_questions") or 0)
        if has_material and questions:
            experience = "Grounded study material and a focused assessment are available."
        elif has_material:
            experience = "Grounded study material is available, but no aligned assessment checks it yet."
        else:
            experience = "Grounded support is limited until teaching material is mapped to this concept."
        return {
            "topic": name,
            "has_material": has_material,
            "assessment_questions": questions,
            "experience": experience,
        }

    roots = ordered([row for row in topic_rows if not row.get("prerequisites")])
    fresh_path = path_from(set())
    dependency_candidates = sorted(
        topic_rows,
        key=lambda row: (-len(descendants(row["name"])), weight_rank.get(row.get("weight", "medium"), 1)),
    )
    weak_topic = dependency_candidates[0]
    weak_name = weak_topic["name"]
    weak_mastered = {row["name"] for row in roots if row["name"] != weak_name}
    weak_path = [weak_name] + [name for name in path_from(weak_mastered | {weak_name}) if name != weak_name]

    ready_mastered: set[str] = set()
    for name in path_from(set()):
        row = by_name[name]
        if row.get("readiness", 0) >= 75 and set(row.get("prerequisites", [])) <= ready_mastered:
            ready_mastered.add(name)
    ready_path = path_from(ready_mastered)

    scenarios = [
        {
            "id": "starting-fresh",
            "label": "Starting fresh",
            "summary": "Assumes no prior course concepts are mastered.",
            "assumed_mastered": [],
            "recommended_path": fresh_path,
            "at_risk_topics": [],
            "blocked": blocked_from(set()),
        },
        {
            "id": "missing-prerequisite",
            "label": "Missing a prerequisite",
            "summary": f"Assumes the learner needs support with {weak_name}, the concept with the widest downstream effect.",
            "assumed_mastered": sorted(weak_mastered),
            "recommended_path": weak_path,
            "at_risk_topics": descendants(weak_name),
            "blocked": blocked_from(weak_mastered),
        },
        {
            "id": "ready-to-progress",
            "label": "Ready to progress",
            "summary": "Assumes well-supported prerequisite concepts are already mastered.",
            "assumed_mastered": sorted(ready_mastered),
            "recommended_path": ready_path,
            "at_risk_topics": [],
            "blocked": blocked_from(ready_mastered),
        },
    ]
    for scenario in scenarios:
        scenario["next_steps"] = [learning_step(name) for name in scenario.pop("recommended_path")[:4]]
        focus = scenario["next_steps"][0] if scenario["next_steps"] else None
        checks: list[str] = []
        if focus:
            checks.append(f"Ask the learner to explain {focus['topic']} before moving downstream.")
            if not focus["has_material"]:
                checks.append("Add mapped teaching material before relying on grounded tutoring.")
            if not focus["assessment_questions"]:
                checks.append("Add or generate a focused question to verify this step.")
        else:
            checks.append("Use a transfer question or spaced review to confirm retained understanding.")
        scenario["teacher_checks"] = checks
    return scenarios


@router.get("/{course_id}/digital-twin")
async def course_digital_twin(
    course_id: UUID,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    course_id_string = str(course_id)
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=40) as client:
        course = await _teacher_course(client, base, headers, course_id_string, user.id)
        topics_response = await client.get(
            f"{base}/rest/v1/course_topics", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "id,name,weight", "order": "created_at.asc"},
        )
        materials_response = await client.get(
            f"{base}/rest/v1/materials", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "id,title,page_count,status", "order": "created_at.asc"},
        )
        chunks_response = await client.get(
            f"{base}/rest/v1/material_chunks", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "material_id,page_number,content", "limit": "2000"},
        )
        links_response = await client.get(
            f"{base}/rest/v1/course_topic_prerequisites", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "topic_id,prerequisite_topic_id"},
        )
        quizzes_response = await client.get(
            f"{base}/rest/v1/quizzes", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "id,title", "limit": "1000"},
        )
        mastery_response = await client.get(
            f"{base}/rest/v1/student_concept_mastery", headers=headers,
            params={"course_id": f"eq.{course_id_string}", "select": "concept,mastery_score,total_answers,completed_teach_backs"},
        )
        for response in (
            topics_response, materials_response, chunks_response, links_response,
            quizzes_response, mastery_response,
        ):
            response.raise_for_status()

        topics = topics_response.json()
        materials = materials_response.json()
        chunks = chunks_response.json()
        links = links_response.json()
        quiz_ids = [row["id"] for row in quizzes_response.json()]
        questions: list[dict] = []
        attempts: list[dict] = []
        if quiz_ids:
            ids = ",".join(quiz_ids)
            questions_response = await client.get(
                f"{base}/rest/v1/quiz_questions", headers=headers,
                params={"quiz_id": f"in.({ids})", "select": "id,quiz_id,prompt,options,correct_option,concept,difficulty", "limit": "5000"},
            )
            attempts_response = await client.get(
                f"{base}/rest/v1/quiz_attempts", headers=headers,
                params={"quiz_id": f"in.({ids})", "completed_at": "not.is.null", "select": "id", "limit": "5000"},
            )
            questions_response.raise_for_status()
            attempts_response.raise_for_status()
            questions = questions_response.json()
            attempts = attempts_response.json()

    material_by_id = {row["id"]: row for row in materials}
    question_counts: dict[str, int] = defaultdict(int)
    for question in questions:
        question_counts[concept_key(question["concept"])] += 1
    mastery_rows: dict[str, list[dict]] = defaultdict(list)
    for row in mastery_response.json():
        mastery_rows[concept_key(row["concept"])].append(row)
    incoming: dict[str, list[str]] = defaultdict(list)
    outgoing: dict[str, list[str]] = defaultdict(list)
    topic_name_by_id = {row["id"]: row["name"] for row in topics}
    for link in links:
        topic_name = topic_name_by_id.get(link["topic_id"])
        prerequisite_name = topic_name_by_id.get(link["prerequisite_topic_id"])
        if not topic_name or not prerequisite_name:
            continue
        incoming[link["topic_id"]].append(prerequisite_name)
        outgoing[link["prerequisite_topic_id"]].append(topic_name)

    topic_rows: list[dict] = []
    gaps: list[dict] = []
    matched_topics_by_material: dict[str, set[str]] = defaultdict(set)
    for topic in topics:
        matches: list[dict] = []
        seen_locations: set[tuple[str, int | None]] = set()
        mention_count = 0
        for chunk in chunks:
            if not chunk_supports_topic(topic["name"], chunk["content"]):
                continue
            mention_count += 1
            material = material_by_id.get(chunk["material_id"])
            if not material:
                continue
            matched_topics_by_material[material["id"]].add(topic["name"])
            location = (material["id"], chunk.get("page_number"))
            if location in seen_locations or len(matches) >= 3:
                continue
            seen_locations.add(location)
            matches.append({
                "document_title": material["title"],
                "page_number": chunk.get("page_number"),
                "source_kind": _source_kind(material["title"], chunk.get("page_number")),
            })
        assessment_count = question_counts.get(concept_key(topic["name"]), 0)
        evidence = mastery_rows.get(concept_key(topic["name"]), [])
        evidence_students = sum(
            int(row.get("total_answers") or 0) > 0 or int(row.get("completed_teach_backs") or 0) > 0
            for row in evidence
        )
        average_mastery = (
            round(sum(float(row["mastery_score"]) for row in evidence) / len(evidence))
            if evidence else None
        )
        prerequisite_names = incoming.get(topic["id"], [])
        unlocks = outgoing.get(topic["id"], [])
        connected = bool(prerequisite_names or unlocks) or len(topics) <= 1
        readiness = (40 if matches else 0) + (35 if assessment_count else 0) + (25 if connected else 0)
        if not matches:
            gaps.append({
                "topic": topic["name"], "severity": "high", "kind": "material",
                "message": "No indexed material section clearly covers this course topic.",
                "recommendation": "Upload or identify a course section that teaches this concept.",
            })
        if assessment_count == 0:
            gaps.append({
                "topic": topic["name"], "severity": "medium", "kind": "assessment",
                "message": "No generated or teacher-created quiz question currently assesses this topic.",
                "recommendation": "Generate a focused quiz or add an assessment item for this concept.",
            })
        if not connected:
            gaps.append({
                "topic": topic["name"], "severity": "low", "kind": "prerequisite",
                "message": "This topic is isolated from the prerequisite graph.",
                "recommendation": "Review whether it requires or unlocks another course concept.",
            })
        topic_rows.append({
            "id": topic["id"], "name": topic["name"], "weight": topic["weight"],
            "readiness": readiness, "material_mentions": mention_count,
            "material_sources": matches, "assessment_questions": assessment_count,
            "prerequisites": prerequisite_names, "unlocks": unlocks,
            "students_with_evidence": evidence_students, "average_mastery": average_mastery,
        })

    if not topics:
        gaps.append({
            "topic": None, "severity": "high", "kind": "structure",
            "message": "The course has no defined concept map.",
            "recommendation": "Create course topics or use AI-assisted graph suggestions in Settings.",
        })
    material_rows = [{
        "id": material["id"], "title": material["title"], "status": material["status"],
        "page_count": material.get("page_count"),
        "matched_topics": sorted(matched_topics_by_material.get(material["id"], set())),
    } for material in materials]
    total_topics = len(topic_rows)
    covered_topics = sum(bool(row["material_sources"]) for row in topic_rows)
    assessed_topics = sum(row["assessment_questions"] > 0 for row in topic_rows)
    connected_topics = sum(bool(row["prerequisites"] or row["unlocks"]) or total_topics <= 1 for row in topic_rows)
    readiness = round(sum(row["readiness"] for row in topic_rows) / total_topics) if total_topics else 0
    known_topic_keys = {concept_key(row["name"]) for row in topic_rows}
    supported_topic_keys = {
        concept_key(row["name"]) for row in topic_rows if row["material_sources"]
    }
    quiz_titles = {row["id"]: row["title"] for row in quizzes_response.json()}
    question_audit: list[dict] = []
    issue_counts: dict[str, int] = defaultdict(int)
    for question in questions:
        issues = assessment_issues(question, known_topic_keys, supported_topic_keys)
        if not issues:
            continue
        for issue in issues:
            issue_counts[issue["code"]] += 1
        question_audit.append({
            "question_id": question["id"],
            "quiz_title": quiz_titles.get(question["quiz_id"], "Course quiz"),
            "concept": question["concept"],
            "prompt": question["prompt"],
            "difficulty": question["difficulty"],
            "highest_severity": min(
                (issue["severity"] for issue in issues),
                key={"high": 0, "medium": 1, "low": 2}.get,
            ),
            "issues": issues,
        })
    question_audit.sort(key=lambda row: ({"high": 0, "medium": 1, "low": 2}[row["highest_severity"]], row["quiz_title"]))
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    gaps.sort(key=lambda row: (severity_rank[row["severity"]], row.get("topic") or ""))
    return {
        "course": {"id": course["id"], "name": course["name"], "subject": course.get("subject")},
        "summary": {
            "readiness": readiness,
            "topics": total_topics,
            "material_coverage": round(covered_topics * 100 / total_topics) if total_topics else 0,
            "assessment_coverage": round(assessed_topics * 100 / total_topics) if total_topics else 0,
            "prerequisite_coverage": round(connected_topics * 100 / total_topics) if total_topics else 0,
            "materials": len(materials),
            "assessment_questions": len(questions),
            "completed_attempts": len(attempts),
        },
        "topics": topic_rows,
        "materials": material_rows,
        "gaps": gaps,
        "assessment_audit": {
            "total_questions": len(questions),
            "flagged_questions": len(question_audit),
            "high_priority": sum(row["highest_severity"] == "high" for row in question_audit),
            "issue_counts": dict(issue_counts),
            "questions": question_audit,
        },
        "simulated_learners": simulated_learner_profiles(topic_rows),
        "generated_with_ai": False,
    }
