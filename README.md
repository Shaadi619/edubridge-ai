# EduBridge AI

Misconception-aware learning platform for course-grounded tutoring, adaptive
quizzing, and teacher insights.

## Repository layout

- `apps/web` — React/Vite frontend exported from the Figma design
- `apps/api` — FastAPI backend
- `supabase/migrations` — PostgreSQL schema and row-level security policies

## Local development

Copy `.env.example` to `.env`, then supply the required credentials.

### Web

```bash
cd apps/web
npm install
npm run dev
```

### API

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000`; its health endpoint is
`GET /api/v1/health`.

