const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      message = body.detail ?? message;
    } catch {
      // Keep the generic message when the response is not JSON.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      message = body.detail ?? message;
    } catch {
      // Keep the generic message when the response is not JSON.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export type EnrollmentStatus = "pending" | "approved" | "rejected";

export type ApiTeacher = {
  id: number;
  full_name: string;
  email: string;
  course_specializations: string[];
  course_ids: number[];
};

export type ApiStudent = {
  id: number;
  full_name: string;
  email: string;
  enrolled_course_ids: number[];
};

export type ApiCourse = {
  id: number;
  teacher_id: number;
  title: string;
  description: string;
  subject: string;
  class_code: string;
  student_ids: number[];
  pending_student_ids: number[];
};

export type ApiEnrollmentRequest = {
  id: number;
  course_id: number;
  teacher_id: number;
  student_id: number;
  status: EnrollmentStatus;
  student_name: string;
  student_email: string;
  course_title: string;
  requested_at: string;
};

export type ApiTeacherWorkspace = {
  teacher: ApiTeacher;
  courses: ApiCourse[];
  pending_requests: ApiEnrollmentRequest[];
};

export type ApiStudentWorkspace = {
  student: ApiStudent;
  courses: ApiCourse[];
};

export type ApiTutorAnswer = {
  answer: string;
  citations: string[];
  unsupported: boolean;
  follow_up_question: string | null;
};

export type ApiMaterial = {
  id: number;
  course_id: number;
  filename: string;
  content_type: string;
  storage_path: string;
  status: string;
  extracted_text_preview: string;
  uploaded_at: string;
};

export const api = {
  listTeachers: () => request<ApiTeacher[]>("/accounts/teachers"),
  createTeacher: (payload: { full_name: string; email: string; course_specializations: string[] }) =>
    request<ApiTeacher>("/accounts/teachers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getTeacherWorkspace: (teacherId: number) =>
    request<ApiTeacherWorkspace>(`/accounts/teachers/${teacherId}/workspace`),

  listStudents: () => request<ApiStudent[]>("/accounts/students"),
  createStudent: (payload: { full_name: string; email: string }) =>
    request<ApiStudent>("/accounts/students", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getStudentWorkspace: (studentId: number) =>
    request<ApiStudentWorkspace>(`/accounts/students/${studentId}/workspace`),

  createCourse: (payload: { teacher_id: number; title: string; description: string; subject: string }) =>
    request<ApiCourse>("/courses/", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getCourseByCode: (classCode: string) =>
    request<ApiCourse>(`/courses/by-code/${encodeURIComponent(classCode)}`),
  joinCourse: (payload: { student_id: number; class_code: string }) =>
    request<ApiEnrollmentRequest>("/courses/join", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  decideEnrollment: (requestId: number, status: "approved" | "rejected") =>
    request<ApiEnrollmentRequest>(`/courses/enrollment-requests/${requestId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  askTutor: (payload: { student_id: number; course_id: number; question: string }) =>
    request<ApiTutorAnswer>("/tutor/ask", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listMaterials: (courseId: number) =>
    request<ApiMaterial[]>(`/materials/courses/${courseId}`),
  uploadMaterial: (courseId: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return upload<ApiMaterial>(`/materials/courses/${courseId}`, formData);
  },
};
