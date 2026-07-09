from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models import EnrollmentStatus


class TeacherCreate(BaseModel):
    full_name: str
    email: EmailStr
    course_specializations: list[str] = []


class TeacherRead(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    course_specializations: list[str]
    course_ids: list[int]


class StudentCreate(BaseModel):
    full_name: str
    email: EmailStr


class StudentRead(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    enrolled_course_ids: list[int]


class CourseCreate(BaseModel):
    teacher_id: int
    title: str
    description: str = ""
    subject: str = "English"


class CourseRead(BaseModel):
    id: int
    teacher_id: int
    title: str
    description: str
    subject: str
    class_code: str
    student_ids: list[int]
    pending_student_ids: list[int]


class JoinCourseRequest(BaseModel):
    student_id: int
    class_code: str


class EnrollmentRequestRead(BaseModel):
    id: int
    course_id: int
    teacher_id: int
    student_id: int
    status: EnrollmentStatus
    student_name: str
    student_email: EmailStr
    course_title: str
    requested_at: datetime


class EnrollmentDecision(BaseModel):
    status: EnrollmentStatus


class TopicProgress(BaseModel):
    topic: str
    progress: int


class StudentInsight(BaseModel):
    student_id: int
    student_name: str
    overall_progress: int
    weak_topics: list[str]
    recent_misconceptions: list[str]
    topic_progress: list[TopicProgress]


class ClassInsight(BaseModel):
    course_id: int
    course_title: str
    enrolled_students: int
    average_progress: int
    common_weak_topics: list[str]
    common_misconceptions: list[str]
    teaching_recommendations: list[str]


class TutorAskRequest(BaseModel):
    student_id: int
    course_id: int
    question: str


class TutorAnswer(BaseModel):
    answer: str
    citations: list[str]
    unsupported: bool
    follow_up_question: str | None = None


class MisconceptionCheckRequest(BaseModel):
    student_id: int
    course_id: int
    topic: str
    student_response: str


class MisconceptionResult(BaseModel):
    topic: str
    correct_points: list[str]
    missing_points: list[str]
    misconceptions: list[str]
    recommended_revision: str
    teacher_note: str


class TeacherWorkspace(BaseModel):
    teacher: TeacherRead
    courses: list[CourseRead]
    pending_requests: list[EnrollmentRequestRead]


class StudentWorkspace(BaseModel):
    student: StudentRead
    courses: list[CourseRead]
