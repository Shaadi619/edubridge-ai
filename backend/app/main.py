from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_db_and_tables
from app.routers import accounts, analytics, courses, materials, tutor

app = FastAPI(
    title="EduBridge AI API",
    description="Misconception-aware learning platform backend.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_tables()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "edubridge-api"}


app.include_router(accounts.router)
app.include_router(courses.router)
app.include_router(materials.router)
app.include_router(tutor.router)
app.include_router(analytics.router)
