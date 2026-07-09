from datetime import UTC, datetime
from enum import Enum

from sqlmodel import Field, SQLModel


class EnrollmentStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class Teacher(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    full_name: str
    email: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class TeacherSpecialization(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    teacher_id: int = Field(foreign_key="teacher.id", index=True)
    specialization: str


class Student(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    full_name: str
    email: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Course(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    teacher_id: int = Field(foreign_key="teacher.id", index=True)
    title: str
    description: str = ""
    subject: str = "English"
    class_code: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Enrollment(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    course_id: int = Field(foreign_key="course.id", index=True)
    teacher_id: int = Field(foreign_key="teacher.id", index=True)
    student_id: int = Field(foreign_key="student.id", index=True)
    status: EnrollmentStatus = Field(default=EnrollmentStatus.pending, index=True)
    requested_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    decided_at: datetime | None = None


class Material(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    course_id: int = Field(foreign_key="course.id", index=True)
    filename: str
    content_type: str
    storage_path: str
    status: str = "uploaded"
    extracted_text_preview: str = ""
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Misconception(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    student_id: int = Field(foreign_key="student.id", index=True)
    course_id: int = Field(foreign_key="course.id", index=True)
    topic: str
    misconception: str
    teacher_note: str
    recommended_revision: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
