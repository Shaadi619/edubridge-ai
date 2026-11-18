import type { api } from "./api";

type GeneratedQuiz = Awaited<ReturnType<typeof api.generateQuiz>>;

export type QuizDraft = {
  quiz: GeneratedQuiz;
  questionIndex: number;
  answers: (number | null)[];
  confidences: (number | null)[];
  selectedAnswer: number | null;
  selectedConfidence: number | null;
  showExplanation: boolean;
  showResults: boolean;
};

const PREFIX = "edubridge:study:v1:";
const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;

const key = (userId: string, resource: string) => PREFIX + userId + ":" + resource;

function read(key: string) {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { window.sessionStorage.setItem(key, value); } catch { /* Storage is optional. */ }
}

export function readStudentLocation(userId: string) {
  try {
    const data = JSON.parse(read(key(userId, "location")) ?? "null");
    return { tab: typeof data?.tab === "string" ? data.tab : "", courseId: typeof data?.courseId === "string" ? data.courseId : "" };
  } catch {
    return { tab: "", courseId: "" };
  }
}

export function writeStudentLocation(userId: string, courseId: string, tab: string) {
  write(key(userId, "location"), JSON.stringify({ courseId, tab }));
}

export function readQuizDraft(userId: string, courseId: string): QuizDraft | null {
  const storageKey = key(userId, "quiz:" + courseId);
  try {
    const saved = JSON.parse(read(storageKey) ?? "null") as (QuizDraft & { savedAt: number }) | null;
    if (!saved) return null;
    if (!Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt > DRAFT_LIFETIME_MS) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    const { quiz, questionIndex, answers, confidences } = saved;
    if (!quiz?.id || !Array.isArray(quiz.questions) || !Number.isInteger(questionIndex) ||
        questionIndex < 0 || questionIndex >= quiz.questions.length ||
        !Array.isArray(answers) || answers.length !== quiz.questions.length ||
        !Array.isArray(confidences) || confidences.length !== quiz.questions.length) return null;
    return saved;
  } catch { return null; }
}

export function writeQuizDraft(userId: string, courseId: string, draft: QuizDraft) {
  write(key(userId, "quiz:" + courseId), JSON.stringify({ ...draft, savedAt: Date.now() }));
}

export function clearStudentSession(userId: string) {
  const prefix = key(userId, "");
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index--) {
      const storageKey = window.sessionStorage.key(index);
      if (storageKey?.startsWith(prefix)) window.sessionStorage.removeItem(storageKey);
    }
  } catch { /* Storage is optional. */ }
}
