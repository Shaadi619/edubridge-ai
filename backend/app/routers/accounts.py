from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.database import get_session
from app.models import Course, Enrollment, EnrollmentStatus, Student, Teacher, TeacherSpecialization
from app.schemas import (
    StudentCreate,
    StudentRead,
    StudentWorkspace,
    TeacherCreate,
    TeacherRead,
    TeacherWorkspace,
)
from app.services import (
    course_to_read,
    enrollment_to_read,
    require_student,
    require_teacher,
    student_to_read,
    teacher_to_read,
)

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("/teachers", response_model=list[TeacherRead])
def list_teachers(session: Session = Depends(get_session)) -> list[TeacherRead]:
    teachers = session.exec(select(Teacher).order_by(Teacher.created_at.desc())).all()
    return [teacher_to_read(session, teacher) for teacher in teachers]


@router.post("/teachers", response_model=TeacherRead, status_code=status.HTTP_201_CREATED)
def create_teacher(payload: TeacherCreate, session: Session = Depends(get_session)) -> TeacherRead:
    existing = session.exec(select(Teacher).where(Teacher.email == payload.email)).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "A teacher with this email already exists")

    teacher = Teacher(full_name=payload.full_name, email=payload.email)
    session.add(teacher)
    session.commit()
    session.refresh(teacher)

    for specialization in payload.course_specializations:
        clean_value = specialization.strip()
        if clean_value:
            session.add(
                TeacherSpecialization(
                    teacher_id=teacher.id or 0,
                    specialization=clean_value,
                )
            )
    session.commit()
    return teacher_to_read(session, teacher)


@router.get("/teachers/{teacher_id}", response_model=TeacherRead)
def get_teacher(teacher_id: int, session: Session = Depends(get_session)) -> TeacherRead:
    return teacher_to_read(session, require_teacher(session, teacher_id))


@router.get("/teachers/{teacher_id}/workspace", response_model=TeacherWorkspace)
def get_teacher_workspace(
    teacher_id: int,
    session: Session = Depends(get_session),
) -> TeacherWorkspace:
    teacher = require_teacher(session, teacher_id)
    courses = session.exec(select(Course).where(Course.teacher_id == teacher_id)).all()
    pending = session.exec(
        select(Enrollment).where(
            Enrollment.teacher_id == teacher_id,
            Enrollment.status == EnrollmentStatus.pending,
        )
    ).all()
    return TeacherWorkspace(
        teacher=teacher_to_read(session, teacher),
        courses=[course_to_read(session, course) for course in courses],
        pending_requests=[enrollment_to_read(session, item) for item in pending],
    )


@router.get("/students", response_model=list[StudentRead])
def list_students(session: Session = Depends(get_session)) -> list[StudentRead]:
    students = session.exec(select(Student).order_by(Student.created_at.desc())).all()
    return [student_to_read(session, student) for student in students]


@router.post("/students", response_model=StudentRead, status_code=status.HTTP_201_CREATED)
def create_student(payload: StudentCreate, session: Session = Depends(get_session)) -> StudentRead:
    existing = session.exec(select(Student).where(Student.email == payload.email)).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "A student with this email already exists")

    student = Student(full_name=payload.full_name, email=payload.email)
    session.add(student)
    session.commit()
    session.refresh(student)
    return student_to_read(session, student)


@router.get("/students/{student_id}", response_model=StudentRead)
def get_student(student_id: int, session: Session = Depends(get_session)) -> StudentRead:
    return student_to_read(session, require_student(session, student_id))


@router.get("/students/{student_id}/workspace", response_model=StudentWorkspace)
def get_student_workspace(
    student_id: int,
    session: Session = Depends(get_session),
) -> StudentWorkspace:
    student = require_student(session, student_id)
    enrollments = session.exec(
        select(Enrollment).where(
            Enrollment.student_id == student_id,
            Enrollment.status == EnrollmentStatus.approved,
        )
    ).all()
    courses = [session.get(Course, item.course_id) for item in enrollments]
    return StudentWorkspace(
        student=student_to_read(session, student),
        courses=[course_to_read(session, course) for course in courses if course],
    )
