const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

export type ApiHealth = {
  status: "ok";
  service: string;
  environment: string;
};

export type QuizReceipt = {
  attempt_id: string; score: number; correct: number; total: number;
  assignment_completed: boolean; confidence_gaps: number;
  outcomes?: Array<{ question_id: string; is_correct: boolean; confidence: number | null }> | null;
};

export type CourseGraphCitation = {
  document_title: string;
  page_number: number | null;
  source_kind: "page" | "slide" | "document";
};

export type SourceCitation = CourseGraphCitation & { chunk_id?: string; quote?: string | null };

export type CourseGraphSuggestion = {
  summary: string;
  documents_analyzed: number;
  excerpts_analyzed: number;
  topics: Array<{
    name: string;
    description: string;
    confidence: number;
    citations: CourseGraphCitation[];
  }>;
  relationships: Array<{
    prerequisite: string;
    topic: string;
    reason: string;
    confidence: number;
    citations: CourseGraphCitation[];
  }>;
};

export type GeneratedQuiz = {
  id: string;
  title: string;
  difficulty_mode: "easy" | "adaptive" | "hard";
  focus_concept: string | null;
  prerequisite_concepts: string[];
  questions: Array<{
    id: string;
    prompt: string;
    options: string[];
    correct_option: number;
    explanation: string;
    concept: string;
    difficulty: number;
    citations: SourceCitation[];
  }>;
};

export type WorkAnalysis = {
  observed_work: string;
  summary: string;
  strengths: string[];
  steps: Array<{
    step_number: number;
    observed_reasoning: string;
    status: "correct" | "needs_revision" | "unclear";
    feedback: string;
    citations: SourceCitation[];
    /** False when a correction couldn't be matched to course text. Missing on older feedback. */
    grounded?: boolean;
  }>;
  citations: SourceCitation[];
  misconception: {
    detected: boolean;
    concept: string | null;
    label: string | null;
    explanation: string | null;
    confidence: number;
    evidence_from_student: string | null;
    recommended_intervention: string | null;
  };
  grounded: boolean;
  next_step: string;
};

export type WorkSubmission = {
  id: string;
  filename: string;
  mime_type: string;
  context: string;
  status: "analyzing" | "analyzed" | "failed";
  analysis: WorkAnalysis | null;
  processing_error: string | null;
  review_status: "not_required" | "pending" | "approved" | "dismissed";
  created_at: string;
};

export type ExplanationFormat = "simpler" | "analogy" | "worked_example" | "visual_outline";

export type TeacherInterventionDraft = {
  rationale: string;
  recommended_action: string;
  student_message: string;
  talking_points: string[];
  success_check: string;
  citations: CourseGraphCitation[];
};

export type CourseDigitalTwin = {
  course: { id: string; name: string; subject: string };
  summary: {
    readiness: number;
    topics: number;
    material_coverage: number;
    assessment_coverage: number;
    prerequisite_coverage: number;
    materials: number;
    assessment_questions: number;
    completed_attempts: number;
  };
  topics: Array<{
    id: string;
    name: string;
    weight: "high" | "medium" | "low";
    readiness: number;
    material_mentions: number;
    material_sources: CourseGraphCitation[];
    assessment_questions: number;
    prerequisites: string[];
    unlocks: string[];
    students_with_evidence: number;
    average_mastery: number | null;
  }>;
  materials: Array<{
    id: string;
    title: string;
    status: "uploaded" | "processing" | "ready" | "failed";
    page_count: number | null;
    matched_topics: string[];
  }>;
  gaps: Array<{
    topic: string | null;
    severity: "high" | "medium" | "low";
    kind: "material" | "assessment" | "prerequisite" | "structure";
    message: string;
    recommendation: string;
  }>;
  assessment_audit: {
    total_questions: number;
    flagged_questions: number;
    high_priority: number;
    issue_counts: Record<string, number>;
    questions: Array<{
      question_id: string;
      quiz_title: string;
      concept: string;
      prompt: string;
      difficulty: number;
      highest_severity: "high" | "medium" | "low";
      issues: Array<{
        code: string;
        severity: "high" | "medium" | "low";
        label: string;
        detail: string;
        recommendation: string;
      }>;
    }>;
  };
  simulated_learners: Array<{
    id: "starting-fresh" | "missing-prerequisite" | "ready-to-progress";
    label: string;
    summary: string;
    assumed_mastered: string[];
    next_steps: Array<{
      topic: string;
      has_material: boolean;
      assessment_questions: number;
      experience: string;
    }>;
    at_risk_topics: string[];
    blocked: Array<{ topic: string; missing_prerequisites: string[] }>;
    teacher_checks: string[];
  }>;
  generated_with_ai: false;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError("EduBridge could not reach the server. Please try again in a moment.", 0);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new ApiError(payload?.detail ?? `API request failed: ${response.statusText}`, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<ApiHealth>("/health"),
  me: (accessToken: string) => request<{ id: string; email: string | null; role: string }>("/me", undefined, accessToken),
  processMaterial: (materialId: string, accessToken: string) =>
    request<{ status: "ready"; pages: number; chunks: number }>(
      `/materials/${materialId}/process`,
      { method: "POST" },
      accessToken,
    ),
  analyzeWork: (
    courseId: string,
    input: { filename: string; mime_type: string; data_base64: string; context: string },
    accessToken: string,
  ) => request<WorkSubmission>(
    `/courses/${courseId}/work-submissions/analyze`,
    { method: "POST", body: JSON.stringify(input) },
    accessToken,
  ),
  workSubmissions: (courseId: string, accessToken: string) =>
    request<WorkSubmission[]>(`/courses/${courseId}/work-submissions`, undefined, accessToken),
  teacherTutorFlags: (courseId: string, token: string, signal: AbortSignal) =>
    request<Array<{source_message_id: string; student: string; concept: string; explanation: string; message: string}>>(
      `/courses/teacher/${courseId}/tutor-flags`, {signal}, token),
  reviewTutorFlag: (courseId: string, messageId: string, decision: "confirmed" | "dismissed", token: string, signal: AbortSignal) =>
    request<{decision: "confirmed" | "dismissed"}>(`/courses/teacher/${courseId}/tutor-flags/${messageId}/review`,
      {method: "PATCH", body: JSON.stringify({decision}), signal}, token),
  teacherWorkSubmissions: (courseId: string, accessToken: string) =>
    request<Array<WorkSubmission & { student_id: string; student: string }>>(
      `/courses/teacher/${courseId}/work-submissions`, undefined, accessToken,
    ),
  reviewWorkSubmission: (courseId: string, submissionId: string, decision: "approved" | "dismissed", accessToken: string) =>
    request<{ id: string; review_status: "approved" | "dismissed"; misconception_id: string | null }>(
      `/courses/teacher/${courseId}/work-submissions/${submissionId}/review`,
      { method: "PATCH", body: JSON.stringify({ decision }) },
      accessToken,
    ),
  suggestCourseGraph: (courseId: string, accessToken: string) =>
    request<CourseGraphSuggestion>(`/courses/${courseId}/prerequisite-graph/suggest`, { method: "POST" }, accessToken),
  applyCourseGraph: (
    courseId: string,
    topics: string[],
    relationships: Array<{
      prerequisite: string;
      topic: string;
      reason?: string;
      confidence?: number;
      citations?: CourseGraphCitation[];
    }>,
    accessToken: string,
  ) => request<{ topics_added: number; relationships_added: number }>(
    `/courses/${courseId}/prerequisite-graph/apply`,
    { method: "POST", body: JSON.stringify({ topics, relationships }) },
    accessToken,
  ),
  tutorHistory: (courseId: string, accessToken: string, signal?: AbortSignal) =>
    request<{
      conversation_id: string | null;
      messages: Array<{
        author_role: "student" | "assistant";
        content: string;
        grounded: boolean;
        citations: SourceCitation[];
      }>;
    }>(
      "/courses/" + courseId + "/tutor/history", { signal, cache: "no-store" }, accessToken,
    ),
  tutor: (courseId: string, question: string, accessToken: string, conversationId?: string, signal?: AbortSignal) =>
    request<{
      conversation_id: string;
      answer: {
        answer: string;
        grounded: boolean;
        citations: SourceCitation[];
        misconception: { detected: boolean; explanation: string | null };
      };
    }>(
      `/courses/${courseId}/tutor`,
      { method: "POST", signal, body: JSON.stringify({ question, conversation_id: conversationId ?? null }) },
      accessToken,
    ),
  explainInFormat: (courseId: string, question: string, format: ExplanationFormat, accessToken: string, signal?: AbortSignal) =>
    request<{
      format: ExplanationFormat;
      answer: string;
      grounded: boolean;
      citations: SourceCitation[];
    }>(
      `/courses/${courseId}/tutor/explain-format`,
      { method: "POST", signal, body: JSON.stringify({ question, format }) },
      accessToken,
    ),
  generateQuiz: (courseId: string, accessToken: string, focusConcept?: string) =>
    request<GeneratedQuiz>(`/courses/${courseId}/quizzes/generate`, { method: "POST", body: JSON.stringify({ question_count: 4, focus_concept: focusConcept ?? null }) }, accessToken),
  /** Make sure one quiz is being written ahead of time for this course. */
  prepareQuiz: (courseId: string, accessToken: string) =>
    request<{ state: "waiting" | "preparing" | "unavailable" }>(`/courses/${courseId}/quizzes/prepare`, { method: "POST" }, accessToken),
  /** Take the quiz written ahead of time; "preparing" means ask again shortly. */
  takeWaitingQuiz: (courseId: string, accessToken: string) =>
    request<{ state: "ready"; quiz: GeneratedQuiz } | { state: "preparing" | "unavailable" }>(
      `/courses/${courseId}/quizzes/take-waiting`, { method: "POST" }, accessToken,
    ),
  submitQuiz: (courseId: string, quizId: string, answers: Array<number | null>, confidences: Array<number | null>, accessToken: string) =>
    request<QuizReceipt>(
      `/courses/${courseId}/quizzes/${quizId}/submit`,
      { method: "POST", body: JSON.stringify({ answers, confidences }) },
      accessToken,
    ),
  courseProgress: (courseId: string, accessToken: string) =>
    request<{
      quiz_count: number;
      average_score: number;
      best_score: number;
      weak_topics: string[];
      topic_scores: Array<{ topic: string; score: number }>;
      attempts: Array<{ id: string; title: string; score: number; correct: number; total: number; completed_at: string }>;
    }>(`/courses/${courseId}/progress`, undefined, accessToken),
  conceptMastery: (courseId: string, accessToken: string) =>
    request<Array<{
      concept: string;
      mastery_score: number | null;
      confidence: number;
      correct_answers: number;
      total_answers: number;
      open_misconceptions: number;
      completed_teach_backs: number;
      verified_teach_backs: number;
      evidence_count: number;
      evidence_sufficient: boolean;
      last_practiced_at: string | null;
      review_due_at: string | null;
      review_due: boolean;
      status: "not_started" | "needs_review" | "verified_once" | "developing" | "strong";
    }>>(`/courses/${courseId}/concept-mastery`, undefined, accessToken),
  studyPlan: (courseId: string, accessToken: string) =>
    request<Array<{
      id: string;
      concept: string;
      action: string;
      priority: "high" | "medium" | "low";
      source: "misconception" | "retention" | "mastery";
      status: "pending" | "completed";
      due_at: string;
      completed_at: string | null;
      updated_at: string;
    }>>(`/courses/${courseId}/study-plan`, undefined, accessToken),
  updateStudyPlanItem: (courseId: string, itemId: string, completed: boolean, accessToken: string) =>
    request<{ id: string; status: "pending" | "completed"; completed_at: string | null }>(
      `/courses/${courseId}/study-plan/${itemId}`,
      { method: "PATCH", body: JSON.stringify({ completed }) },
      accessToken,
    ),
  myMisconceptions: (courseId: string, accessToken: string) =>
    request<Array<{
      id: string;
      concept: string;
      explanation: string;
      learning_status: "open" | "improving" | "verified";
      created_at: string;
      verified_at: string | null;
      related_records: number;
      retention_status: "not_scheduled" | "scheduled" | "due" | "retained" | "needs_review";
      retention_due_at: string | null;
      retained_at: string | null;
    }>>(`/courses/${courseId}/my-misconceptions`, undefined, accessToken),
  startTeachBack: (courseId: string, misconceptionId: string, accessToken: string) =>
    request<{
      verification_id: string;
      question: string;
      citations: Array<{ document_title: string; page_number: number | null; source_kind: "page" | "slide" | "document"; chunk_id?: string | null; quote?: string | null }>;
    }>(`/courses/${courseId}/misconceptions/${misconceptionId}/teach-back`, { method: "POST" }, accessToken),
  submitTeachBack: (courseId: string, verificationId: string, response: string, accessToken: string) =>
    request<{
      verdict: "still_present" | "improving" | "corrected";
      feedback: string;
      citations: Array<{ document_title: string; page_number: number | null; source_kind: "page" | "slide" | "document"; chunk_id?: string | null; quote?: string | null }>;
    }>(`/courses/${courseId}/teach-back/${verificationId}/submit`, { method: "POST", body: JSON.stringify({ response }) }, accessToken),
  transcribeTeachBack: (
    courseId: string,
    input: { filename: string; mime_type: string; data_base64: string },
    accessToken: string,
  ) => request<{ transcript: string }>(
    `/courses/${courseId}/teach-back/transcribe`,
    { method: "POST", body: JSON.stringify(input) },
    accessToken,
  ),
  startRetentionCheck: (courseId: string, misconceptionId: string, accessToken: string) =>
    request<{
      verification_id: string;
      question: string;
      citations: Array<{ document_title: string; page_number: number | null; source_kind: "page" | "slide" | "document"; chunk_id?: string | null; quote?: string | null }>;
    }>(`/courses/${courseId}/misconceptions/${misconceptionId}/retention-check`, { method: "POST" }, accessToken),
  submitRetentionCheck: (courseId: string, checkId: string, response: string, accessToken: string) =>
    request<{
      verdict: "still_present" | "improving" | "corrected";
      feedback: string;
      citations: Array<{ document_title: string; page_number: number | null; source_kind: "page" | "slide" | "document"; chunk_id?: string | null; quote?: string | null }>;
    }>(`/courses/${courseId}/retention-check/${checkId}/submit`, { method: "POST", body: JSON.stringify({ response }) }, accessToken),
  teacherCourseAnalytics: (courseId: string, accessToken: string, signal?: AbortSignal) =>
    request<{
      active_students: number;
      average_score: number;
      open_flags: number;
      overdue_study_tasks: number;
      quizzes_today: number;
      document_count: number;
      students: Array<{ id: string; name: string; progress: number; quizzes: number; weak: string[]; status: "active" | "struggling" | "excelling"; overdue_tasks: number }>;
      attention: Array<{ id: string; student_id: string; student: string; concept: string; issue: string; status: "open" | "addressed"; created_at: string }>;
      intervention_queue: Array<{
        id: string;
        student_id: string;
        student: string;
        concept: string;
        priority: "high" | "medium" | "low";
        source: "misconception" | "retention" | "study_plan" | "confidence_gap" | "prerequisite_gap";
        downstream_concept?: string;
        reason: string;
        recommended_action: string;
        due_at: string | null;
        practice_assigned: boolean;
        misconception_id?: string;
        student_evidence?: string | null;
        overdue_task?: boolean;
        citations: Array<{ document_title: string; page_number: number | null; source_kind: "page" | "slide" | "document"; chunk_id?: string }>;
      }>;
      misconception_network: {
        nodes: Array<{ id: string; concept: string; affected_students: number; occurrences: number; connection_strength: number }>;
        edges: Array<{ source: string; target: string; shared_students: number }>;
        hub_concept: string | null;
      };
      topic_scores: Array<{ topic: string; score: number }>;
      misconceptions: Array<{ id: string; student_id: string; student: string; concept: string; explanation: string; status: "open" | "addressed"; created_at: string }>;
    }>(`/courses/teacher/${courseId}/analytics`, { signal }, accessToken),
  teacherCourseDigitalTwin: (courseId: string, accessToken: string, signal?: AbortSignal) =>
    request<CourseDigitalTwin>(`/courses/teacher/${courseId}/digital-twin`, { signal }, accessToken),
  teacherMasteryJourneys: (courseId: string, accessToken: string, signal?: AbortSignal) =>
    request<{
      summary: { detected: number; improving: number; verified: number; retained: number; verification_rate: number };
      journeys: Array<{
        id: string;
        student_id: string;
        student: string;
        concept: string;
        explanation: string;
        learning_status: "open" | "improving" | "verified";
        created_at: string;
        verified_at: string | null;
        mastery_score: number | null;
        confidence: number;
        correct_answers: number;
        total_answers: number;
        evidence_count: number;
        evidence_sufficient: boolean;
        teach_back_attempts: number;
        related_records: number;
        latest_verdict: "still_present" | "improving" | "corrected" | null;
        latest_feedback: string | null;
        last_attempt_at: string | null;
        retention_status: "not_scheduled" | "scheduled" | "due" | "retained" | "needs_review";
        retention_due_at: string | null;
        retained_at: string | null;
        retention_checks: number;
      }>;
    }>(`/courses/teacher/${courseId}/mastery-journeys`, { signal }, accessToken),
  addressMisconception: (courseId: string, misconceptionId: string, accessToken: string) =>
    request<{ id: string; status: "addressed" }>(`/courses/teacher/${courseId}/misconceptions/${misconceptionId}`, { method: "PATCH" }, accessToken),
  draftTeacherIntervention: (
    courseId: string,
    studentId: string,
    input: {
      concept: string;
      reason: string;
      source: "misconception" | "retention" | "study_plan" | "confidence_gap" | "prerequisite_gap";
      downstream_concept?: string;
    },
    accessToken: string,
  ) => request<TeacherInterventionDraft>(
    `/courses/teacher/${courseId}/interventions/${studentId}/draft`,
    { method: "POST", body: JSON.stringify(input) },
    accessToken,
  ),
  assignTargetedPractice: (
    courseId: string,
    studentId: string,
    concept: string,
    accessToken: string,
    options?: { action?: string; student_message?: string; due_days?: number },
  ) =>
    request<{ assigned: boolean; study_plan_item_id: string; concept: string; due_at: string }>(
      `/courses/teacher/${courseId}/interventions/${studentId}/assign-practice`,
      { method: "POST", body: JSON.stringify({ concept, ...options }) },
      accessToken,
    ),
  announcements: (courseId: string, accessToken: string, signal?: AbortSignal) =>
    request<Array<{ id: string; title: string; body: string; pinned: boolean; created_at: string }>>(`/courses/${courseId}/announcements`, { signal }, accessToken),
  createAnnouncement: (courseId: string, title: string, body: string, pinned: boolean, accessToken: string) =>
    request<{ id: string; title: string; body: string; pinned: boolean; created_at: string }>(
      `/courses/${courseId}/announcements`, { method: "POST", body: JSON.stringify({ title, body, pinned }) }, accessToken,
    ),
  deleteAnnouncement: (courseId: string, announcementId: string, accessToken: string) =>
    request<{ deleted: boolean }>(`/courses/${courseId}/announcements/${announcementId}`, { method: "DELETE" }, accessToken),
  notifications: (accessToken: string) =>
    request<Array<{
      id: string;
      course_id: string | null;
      type: "enroll" | "flag" | "quiz" | "misconception" | "announcement";
      title: string;
      body: string;
      read_at: string | null;
      created_at: string;
      metadata: Record<string, unknown>;
    }>>("/notifications", undefined, accessToken),
  markNotificationRead: (notificationId: string, accessToken: string) =>
    request<{ id: string; read_at: string }>(`/notifications/${notificationId}/read`, { method: "PATCH" }, accessToken),
  markAllNotificationsRead: (accessToken: string) =>
    request<{ updated: boolean }>("/notifications/read-all", { method: "PATCH" }, accessToken),
  dismissNotification: (notificationId: string, accessToken: string) =>
    request<{ dismissed: boolean }>(`/notifications/${notificationId}`, { method: "DELETE" }, accessToken),
  teacherStudentProgress: (courseId: string, studentId: string, accessToken: string, signal?: AbortSignal) =>
    request<{
      student_id: string;
      name: string;
      average_score: number;
      quiz_count: number;
      weak_topics: string[];
      topic_scores: Array<{ topic: string; score: number }>;
      attempts: Array<{ id: string; title: string; score: number; correct: number; total: number; completed_at: string }>;
      misconceptions: Array<{ id: string; concept: string; explanation: string; status: "open" | "addressed"; created_at: string }>;
    }>(`/courses/teacher/${courseId}/students/${studentId}/progress`, { signal }, accessToken),
  lookupCourse: (code: string, accessToken: string) =>
    request<{ id: string; name: string; subject: string; teacher: string; enrollment_code: string; students: number; documents: number }>(
      `/courses/lookup?code=${encodeURIComponent(code)}`, undefined, accessToken,
    ),
  requestEnrollment: (courseId: string, accessToken: string) =>
    request<{ id: string; status: "pending" }>(`/courses/${courseId}/enrollment`, { method: "POST" }, accessToken),
  teacherEnrollments: (accessToken: string) =>
    request<Array<{ id: string; student_name: string; course_name: string; enrollment_code: string; status: "pending" | "approved" | "denied"; created_at: string }>>(
      "/teacher/enrollments", undefined, accessToken,
    ),
  reviewEnrollment: (id: string, action: "approved" | "denied", accessToken: string) =>
    request<{ id: string; status: string }>(`/enrollments/${id}`, { method: "PATCH", body: JSON.stringify({ action }) }, accessToken),
  myEnrollments: (accessToken: string) =>
    request<Array<{ id: string; course_id: string; course_name: string; enrollment_code: string; teacher: string; status: "pending" | "approved" | "denied"; created_at: string }>>(
      "/me/enrollments", undefined, accessToken,
    ),
  cancelEnrollment: (id: string, accessToken: string) =>
    request<{ deleted: boolean }>(`/enrollments/${id}`, { method: "DELETE" }, accessToken),
  myCourses: (accessToken: string) =>
    request<Array<{ id: string; name: string; subject: string; enrollment_code: string; teacher_id: string; teacher: string; show_work_enabled: boolean }>>(
      "/me/courses", undefined, accessToken,
    ),
};
