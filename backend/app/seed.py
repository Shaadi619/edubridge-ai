from sqlmodel import Session, select

from app.database import create_db_and_tables, engine
from app.models import Course, Enrollment, EnrollmentStatus, Student, Teacher, TeacherSpecialization
from app.services import generate_class_code


def seed() -> None:
    create_db_and_tables()
    with Session(engine) as session:
        teacher = session.exec(select(Teacher).where(Teacher.email == "teacher@edubridge.ai")).first()
        if not teacher:
            teacher = Teacher(full_name="Dr. Amina Hassan", email="teacher@edubridge.ai")
            session.add(teacher)
            session.commit()
            session.refresh(teacher)
            session.add(
                TeacherSpecialization(
                    teacher_id=teacher.id or 0,
                    specialization="English",
                )
            )

        student = session.exec(select(Student).where(Student.email == "student@edubridge.ai")).first()
        if not student:
            student = Student(full_name="Sara Ahmed", email="student@edubridge.ai")
            session.add(student)
            session.commit()
            session.refresh(student)

        course = session.exec(select(Course).where(Course.title == "English Writing Foundations")).first()
        if not course:
            course = Course(
                teacher_id=teacher.id or 0,
                title="English Writing Foundations",
                description="Reading comprehension, thesis statements, paragraph structure, and evidence use.",
                subject="English",
                class_code=generate_class_code(session, "English"),
            )
            session.add(course)
            session.commit()
            session.refresh(course)

        enrollment = session.exec(
            select(Enrollment).where(
                Enrollment.student_id == student.id,
                Enrollment.course_id == course.id,
            )
        ).first()
        if not enrollment:
            session.add(
                Enrollment(
                    course_id=course.id or 0,
                    teacher_id=teacher.id or 0,
                    student_id=student.id or 0,
                    status=EnrollmentStatus.approved,
                )
            )
        session.commit()

        print("Seed data ready:")
        print(f"  Teacher: {teacher.email}")
        print(f"  Student: {student.email}")
        print(f"  Course: {course.title} ({course.class_code})")


if __name__ == "__main__":
    seed()
