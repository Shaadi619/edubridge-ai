from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.database import get_session
from app.models import Course, Enrollment, EnrollmentStatus, Student, Teacher
from app.schemas import (
    CourseCreate,
    CourseRead,
    EnrollmentDecision,
    EnrollmentRequestRead,
    JoinCourseRequest,
    TeacherRead,
)
from app.services import (
    course_to_read,
    enrollment_to_read,
    generate_class_code,
    require_course,
    require_student,
    require_teacher,
    teacher_to_read,
)

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("/", response_model=list[CourseRead])
def list_courses(session: Session = Depends(get_session)) -> list[CourseRead]:
    courses = session.exec(select(Course).order_by(Course.created_at.desc())).all()
    return [course_to_read(session, course) for course in courses]


@router.post("/", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
def create_course(payload: CourseCreate, session: Session = Depends(get_session)) -> CourseRead:
    require_teacher(session, payload.teacher_id)
    course = Course(
        teacher_id=payload.teacher_id,
        title=payload.title,
        description=payload.description,
        subject=payload.subject,
        class_code=generate_class_code(session, payload.subject),
    )
    session.add(course)
    session.commit()
    session.refresh(course)
    return course_to_read(session, course)


@router.get("/by-code/{class_code}", response_model=CourseRead)
def get_course_by_code(class_code: str, session: Session = Depends(get_session)) -> CourseRead:
    course = session.exec(select(Course).where(Course.class_code == class_code.upper())).first()
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Class code not found")
    return course_to_read(session, course)


@router.get("/{course_id}", response_model=CourseRead)
def get_course(course_id: int, session: Session = Depends(get_session)) -> CourseRead:
    return course_to_read(session, require_course(session, course_id))


@router.get("/{course_id}/students", response_model=list[Student])
def get_course_students(course_id: int, session: Session = Depends(get_session)) -> list[Student]:
    require_course(session, course_id)
    enrollments = session.exec(
        select(Enrollment).where(
            Enrollment.course_id == course_id,
            Enrollment.status == EnrollmentStatus.approved,
        )
    ).all()
    students = [session.get(Student, item.student_id) for item in enrollments]
    return [student for student in students if student]


@router.get("/{course_id}/pending-students", response_model=list[Student])
def get_pending_students(course_id: int, session: Session = Depends(get_session)) -> list[Student]:
    require_course(session, course_id)
    enrollments = session.exec(
        select(Enrollment).where(
            Enrollment.course_id == course_id,
            Enrollment.status == EnrollmentStatus.pending,
        )
    ).all()
    students = [session.get(Student, item.student_id) for item in enrollments]
    return [student for student in students if student]


@router.get("/{course_id}/teacher", response_model=TeacherRead)
def get_course_teacher(course_id: int, session: Session = Depends(get_session)) -> TeacherRead:
    course = require_course(session, course_id)
    teacher = session.get(Teacher, course.teacher_id)
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found")
    return teacher_to_read(session, teacher)


@router.post("/join", response_model=EnrollmentRequestRead, status_code=status.HTTP_201_CREATED)
def join_course(
    payload: JoinCourseRequest,
    session: Session = Depends(get_session),
) -> EnrollmentRequestRead:
    student = require_student(session, payload.student_id)
    course = session.exec(select(Course).where(Course.class_code == payload.class_code)).first()
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Class code not found")

    existing = session.exec(
        select(Enrollment).where(
            Enrollment.student_id == student.id,
            Enrollment.course_id == course.id,
        )
    ).first()
    if existing:
        return enrollment_to_read(session, existing)

    enrollment = Enrollment(
        course_id=course.id or 0,
        teacher_id=course.teacher_id,
        student_id=student.id or 0,
        status=EnrollmentStatus.pending,
    )
    session.add(enrollment)
    session.commit()
    session.refresh(enrollment)
    return enrollment_to_read(session, enrollment)


@router.get("/{course_id}/enrollment-requests", response_model=list[EnrollmentRequestRead])
def list_enrollment_requests(
    course_id: int,
    session: Session = Depends(get_session),
) -> list[EnrollmentRequestRead]:
    require_course(session, course_id)
    enrollments = session.exec(
        select(Enrollment).where(Enrollment.course_id == course_id).order_by(Enrollment.requested_at.desc())
    ).all()
    return [enrollment_to_read(session, item) for item in enrollments]


@router.patch("/enrollment-requests/{request_id}", response_model=EnrollmentRequestRead)
def decide_enrollment_request(
    request_id: int,
    payload: EnrollmentDecision,
    session: Session = Depends(get_session),
) -> EnrollmentRequestRead:
    if payload.status == EnrollmentStatus.pending:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Decision must be approved or rejected")

    enrollment = session.get(Enrollment, request_id)
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment request not found")

    enrollment.status = payload.status
    enrollment.decided_at = datetime.now(UTC)
    session.add(enrollment)
    session.commit()
    session.refresh(enrollment)
    return enrollment_to_read(session, enrollment)
