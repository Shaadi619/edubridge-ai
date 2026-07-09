# EduBridge AI

EduBridge AI is a misconception-aware academic learning platform for students and teachers.

The platform gives students a course-aware AI tutor while giving teachers visibility into each student's weaknesses, misconceptions, progress trends, and recommended teaching actions.

## Project Structure

```text
EduBridge/
  frontend/   Figma Make exported React + Vite app
  backend/    FastAPI + SQLite API
  docs/       Architecture notes, roadmap, and presentation material
  storage/    Local development storage
```

## Tech Stack

Frontend:

- React
- TypeScript
- Vite
- Tailwind CSS v4
- Motion
- Recharts
- Sonner
- Lucide React

Backend:

- Python
- FastAPI
- SQLModel
- SQLite for development
- REST API
- CORS for frontend/backend communication

Planned AI layer:

- Custom lightweight RAG pipeline
- Local/open-source LLM through Ollama or a similar local serving option
- Embeddings and vector search
- Course-grounded answers with citations
- Misconception classification

## Local Development

Run the frontend:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Run the backend:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Current Status

Implemented:

- Figma-based frontend foundation
- FastAPI backend scaffold
- SQLite persistence setup
- Teacher and student account endpoints
- Course creation and class-code generation
- Student join request flow
- Teacher approval/rejection endpoints
- Workspace response models
- Material upload endpoint
- Tutor and misconception placeholder endpoints
- Analytics placeholder endpoints
- Typed frontend API client
- Frontend account creation/login connected to backend demo accounts
- Teacher workspace, course creation, enrollment decisions, student join, and tutor ask connected to backend endpoints
- Teacher materials list and upload UI connected to backend storage
- PDF/text extraction for uploaded materials
- Material chunks stored in SQLite for the future RAG retrieval layer

Next:

- Replace remaining static dashboard analytics with API state
- Add proper authentication
- Add vector embeddings and semantic retrieval for extracted chunks
- Add RAG retrieval and source-grounded AI answers
- Add real misconception detection
- Add adaptive quizzes and richer analytics
