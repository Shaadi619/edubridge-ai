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


## Checks

CI (`.github/workflows/ci.yml`) runs these on every push to `main` and on pull
requests. Run them locally before committing:

```bash
# From apps/api, inside its virtual environment
python -m pytest -q

# From apps/web
npm run typecheck && npm run build
```

The tests use placeholder settings and mocked AI providers, so they need no
real credentials. The SQL regression in `apps/api/tests/sql/` is not in CI yet:
run it manually against a disposable database with all migrations applied.
