import random
import string
from collections import Counter

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.models import (
    Course,
    Enrollment,
    EnrollmentStatus,
    Misconception,
    Student,
    Teacher,
    TeacherSpecialization,
)
from app.schemas import (
    ClassInsight,
    CourseRead,
    EnrollmentRequestRead,
    StudentInsight,
    StudentRead,
    TeacherRead,
    TopicProgress,
)


def require_teacher(session: Session, teacher_id: int) -> Teacher:
    teacher = session.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found")
    return teacher


def require_student(session: Session, student_id: int) -> Student:
    student = session.get(Student, student_id)
    if not student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found")
    return student


def require_course(session: Session, course_id: int) -> Course:
    course = session.get(Course, course_id)
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    return course


def generate_class_code(session: Session, subject: str) -> str:
    prefix = "".join(ch for ch in subject.upper() if ch.isalnum())[:3] or "EDU"
    while True:
        suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
        class_code = f"{prefix}-{suffix}"
        existing = session.exec(select(Course).where(Course.class_code == class_code)).first()
        if not existing:
            return class_code


def teacher_to_read(session: Session, teacher: Teacher) -> TeacherRead:
    specializations = session.exec(
        select(TeacherSpecialization).where(TeacherSpecialization.teacher_id == teacher.id)
    ).all()
    courses = session.exec(select(Course).where(Course.teacher_id == teacher.id)).all()
    return TeacherRead(
        id=teacher.id or 0,
        full_name=teacher.full_name,
        email=teacher.email,
        course_specializations=[item.specialization for item in specializations],
        course_ids=[course.id or 0 for course in courses],
    )


def student_to_read(session: Session, student: Student) -> StudentRead:
    enrollments = session.exec(
        select(Enrollment).where(
            Enrollment.student_id == student.id,
            Enrollment.status == EnrollmentStatus.approved,
        )
    ).all()
    return StudentRead(
        id=student.id or 0,
        full_name=student.full_name,
        email=student.email,
        enrolled_course_ids=[enrollment.course_id for enrollment in enrollments],
    )


def course_to_read(session: Session, course: Course) -> CourseRead:
    approved = session.exec(
        select(Enrollment).where(
            Enrollment.course_id == course.id,
            Enrollment.status == EnrollmentStatus.approved,
        )
    ).all()
    pending = session.exec(
        select(Enrollment).where(
            Enrollment.course_id == course.id,
            Enrollment.status == EnrollmentStatus.pending,
        )
    ).all()
    return CourseRead(
        id=course.id or 0,
        teacher_id=course.teacher_id,
        title=course.title,
        description=course.description,
        subject=course.subject,
        class_code=course.class_code,
        student_ids=[enrollment.student_id for enrollment in approved],
        pending_student_ids=[enrollment.student_id for enrollment in pending],
    )


def enrollment_to_read(session: Session, enrollment: Enrollment) -> EnrollmentRequestRead:
    student = require_student(session, enrollment.student_id)
    course = require_course(session, enrollment.course_id)
    return EnrollmentRequestRead(
        id=enrollment.id or 0,
        course_id=enrollment.course_id,
        teacher_id=enrollment.teacher_id,
        student_id=enrollment.student_id,
        status=enrollment.status,
        student_name=student.full_name,
        student_email=student.email,
        course_title=course.title,
        requested_at=enrollment.requested_at,
    )


def build_student_insight(session: Session, student_id: int) -> StudentInsight:
    student = require_student(session, student_id)
    misconceptions = session.exec(
        select(Misconception).where(Misconception.student_id == student_id)
    ).all()
    weak_topics = [item.topic for item in misconceptions] or ["Thesis statements", "Evidence use"]
    recent = [item.misconception for item in misconceptions[-3:]]
    return StudentInsight(
        student_id=student.id or 0,
        student_name=student.full_name,
        overall_progress=68 if misconceptions else 75,
        weak_topics=list(dict.fromkeys(weak_topics)),
        recent_misconceptions=recent,
        topic_progress=[
            TopicProgress(topic="Reading comprehension", progress=78),
            TopicProgress(topic="Thesis statements", progress=62),
            TopicProgress(topic="Topic sentences", progress=70),
            TopicProgress(topic="Evidence use", progress=58),
            TopicProgress(topic="Essay coherence", progress=66),
        ],
    )


def build_class_insight(session: Session, course_id: int) -> ClassInsight:
    course = require_course(session, course_id)
    enrollments = session.exec(
        select(Enrollment).where(
            Enrollment.course_id == course_id,
            Enrollment.status == EnrollmentStatus.approved,
        )
    ).all()
    misconceptions = session.exec(
        select(Misconception).where(Misconception.course_id == course_id)
    ).all()
    topic_counts = Counter(item.topic for item in misconceptions)
    misconception_texts = [item.misconception for item in misconceptions]
    return ClassInsight(
        course_id=course.id or 0,
        course_title=course.title,
        enrolled_students=len(enrollments),
        average_progress=72 if enrollments else 0,
        common_weak_topics=[topic for topic, _ in topic_counts.most_common(5)]
        or ["Thesis statements", "Paragraph structure", "Evidence use"],
        common_misconceptions=misconception_texts[-5:]
        or [
            "Confuses thesis statements with topic sentences.",
            "Uses evidence without explaining how it supports the claim.",
        ],
        teaching_recommendations=[
            "Review thesis vs. topic sentence using paired examples.",
            "Model how to connect quoted evidence back to the paragraph claim.",
            "Use a short diagnostic writing task before the next lesson.",
        ],
    )
