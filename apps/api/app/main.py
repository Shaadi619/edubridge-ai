from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import announcements, course_graph, digital_twin, enrollments, health, interventions, materials, me, notifications, quizzes, search, study_plans, teachback, tutor, voice, work_analysis

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list({
        settings.web_origin.rstrip("/"),
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
app.include_router(materials.router, prefix="/api/v1")
app.include_router(search.router, prefix="/api/v1")
app.include_router(tutor.router, prefix="/api/v1")
app.include_router(enrollments.router, prefix="/api/v1")
app.include_router(quizzes.router, prefix="/api/v1")
app.include_router(announcements.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(teachback.router, prefix="/api/v1")
app.include_router(study_plans.router, prefix="/api/v1")
app.include_router(course_graph.router, prefix="/api/v1")
app.include_router(work_analysis.router, prefix="/api/v1")
app.include_router(voice.router, prefix="/api/v1")
app.include_router(interventions.router, prefix="/api/v1")
app.include_router(digital_twin.router, prefix="/api/v1")
