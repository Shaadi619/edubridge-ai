# EduBridge AI Backend

FastAPI backend for EduBridge AI, a misconception-aware learning platform for teachers and students.

## Local Setup

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Optional demo data:

```bash
python -m app.seed
```

## Current API Surface

- `GET /health`
- `GET /accounts/teachers`
- `POST /accounts/teachers`
- `GET /accounts/teachers/{teacher_id}`
- `GET /accounts/teachers/{teacher_id}/workspace`
- `GET /accounts/students`
- `POST /accounts/students`
- `GET /accounts/students/{student_id}`
- `GET /accounts/students/{student_id}/workspace`
- `GET /courses/`
- `POST /courses/`
- `GET /courses/{course_id}`
- `GET /courses/{course_id}/students`
- `GET /courses/{course_id}/pending-students`
- `GET /courses/{course_id}/teacher`
- `POST /courses/join`
- `GET /courses/{course_id}/enrollment-requests`
- `PATCH /courses/enrollment-requests/{request_id}`
- `GET /materials/courses/{course_id}`
- `POST /materials/courses/{course_id}`
- `GET /materials/{material_id}/chunks`
- `POST /tutor/ask`
- `POST /tutor/misconceptions/check`
- `GET /analytics/courses/{course_id}`
- `GET /analytics/students/{student_id}`

## Development Notes

The current database is SQLite and is created automatically at `backend/data/edubridge.db`.
Uploaded files are stored under `backend/storage/uploads`.

Uploaded PDFs are parsed with `pypdf` and split into text chunks for the future retrieval layer. Plain text files are also supported for lightweight testing. DOCX, PPTX, scanned PDFs, and OCR are planned future additions.

The tutor and misconception endpoints are intentionally structured placeholders. Their response contracts are stable so the frontend can integrate early, while the internal logic can later be upgraded to a RAG pipeline and local/open-source LLM.
