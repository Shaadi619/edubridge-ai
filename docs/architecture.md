# EduBridge AI architecture

## Model tiers

Tier 1 handles high-volume, lower-risk work: intent classification, topic
extraction, document metadata, and routine formative question generation. It may
use a self-hosted model through vLLM's OpenAI-compatible endpoint.

Tier 2 handles nuanced or high-impact work: grounded tutoring, misconception
analysis, low-confidence escalation, and teacher insight reports. The initial
implementation uses a strong hosted model.

Before promoting an open-source model to either tier, evaluate it against a
versioned, teacher-reviewed dataset. Minimum gates are:

- citation precision and whether every cited passage supports the claim;
- unsupported-claim and refusal behavior when materials lack the answer;
- misconception precision, recall, and false-positive rate;
- quiz correctness, distractor quality, and source support;
- structured-output validity, latency, and cost per completed task;
- fairness checks across writing proficiency and language background.

Model outputs are suggestions. The application stores supporting student text,
retrieved source chunks, confidence, model tier, and teacher review state so the
system remains auditable.

## Data boundaries

The browser uses a Supabase user token. PostgreSQL row-level security restricts
normal user reads. AI generation and material ingestion run through FastAPI using
the service role only after the API validates course membership. Provider API keys
never reach the browser.

Course documents are parsed into page-aware chunks. Retrieval selects chunks from
the active course only. Citations reference stored chunk and document IDs rather
than model-generated filenames.

