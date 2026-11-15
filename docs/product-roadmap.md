# EduBridge AI product roadmap

## Product identity

EduBridge is a course-grounded learning intelligence platform that observes how
students reason, identifies why understanding breaks down, recommends an
evidence-backed intervention, and verifies that learning lasts.

Its differentiator is the closed loop from misconception to verified mastery,
not a collection of generic AI generation tools.

## Current foundation

- Role-based student, teacher, and administrator portals
- Course creation, enrollment, materials, and announcements
- Private document extraction, chunking, embeddings, and course-scoped retrieval
- Grounded tutoring with page/slide citations and unsupported-answer guardrails
- Explicit adaptive quiz generation with persisted attempts and progress
- Misconception detection, deduplication, teacher analytics, and interventions
- Persistent, real-time teacher notifications
- Multimodal “Show Your Work” analysis with teacher-reviewed misconception suggestions
- Voice teach-back with private, on-demand transcription
- On-demand adaptive explanations: simpler language, analogy, worked example,
  visual outline, and local audio playback
- On-demand course-grounded Concept Lab walkthroughs with cited steps,
  formative checkpoints, transfer challenges, and token-free replay
- Teacher Intervention Copilot with course-grounded drafts, editable actions and
  student messages, explicit teacher approval, and configurable due dates
- Course Digital Twin connecting concepts, prerequisites, indexed materials,
  assessment coverage, learner evidence, and deterministic alignment gaps
- Deterministic curriculum-gap and assessment-quality audit covering missing
  material, unassessed concepts, graph isolation, and common question ambiguity risks
- Clearly labelled simulated learner preview for testing prerequisite routes,
  blocked concepts, material support, and assessment availability without student data

## Planned development phases

### Next adjustment: verify quiz answer keys

- Add deterministic checks for four distinct options, an answer index from 0
  through 3, and at least one citation from the retrieved course material.
- Independently solve each draft item from its course evidence without revealing
  the draft answer key. Check that exactly one option is defensible, the verifier
  agrees with the key, and the explanation supports that answer.
- Regenerate rejected questions once. Publish only verified questions and keep
  rejected questions out of grades and mastery evidence.
- Add teacher-reviewed regression cases for incorrect keys, ambiguous questions,
  unsupported citations, and explanation/key disagreement.

### Phase 1 — Misconception-to-mastery loop

- Course concept and prerequisite graph
- Hybrid learner model using knowledge tracing plus evidence from explanations
- Confidence-gap detection
- Teach-back verification before marking a misconception resolved
- Spaced follow-up checks and a forgetting-risk scheduler
- Teacher intervention cards grounded in exact course pages or slides
- Class misconception network showing root and downstream misunderstandings

### Phase 2 — Multimodal learning

- “Show Your Work” analysis for handwriting, equations, diagrams, code, and drafts
- Voice teach-back and lightweight oral assessment
- Adaptive explanation formats: text, visual, analogy, worked example, and audio

### Phase 3 — Teacher and curriculum intelligence

- Intelligent study-group recommendations with teacher approval

### Phase 4 — Trust, language, and institutional readiness

- Evidence Firewall that verifies claims and citations before delivery
- Arabic–English concept bridge and course-specific terminology glossary
- Arabic voice teach-back and translation-related misconception detection
- Privacy-preserving analytics, retention controls, audit trails, and model evaluation

## Product principles

- Teacher-controlled: AI recommends; educators decide.
- Evidence-backed: high-impact outputs remain traceable to course material.
- Learning-first: optimize retained understanding, not chat volume or token usage.
- Measurable: evaluate misconception precision, learning gains, retention, fairness,
  latency, and cost.
- Cost-aware: use deterministic logic and smaller models for routine decisions;
  reserve stronger models for nuanced teaching and analysis.

## Features intentionally deprioritized

- Generic summarizers and lesson-plan generators
- Large collections of disconnected AI tools
- AI avatars and model-selection interfaces
- Unreliable AI-written-text detection
- Automatic generation that consumes tokens without an explicit learning need
