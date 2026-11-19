import assert from "node:assert/strict";
import test from "node:test";
import {
  clearStudentSession, readQuizDraft, readStudentLocation, writeQuizDraft, writeStudentLocation,
} from "../src/lib/studentSession.ts";

const data = new Map();
globalThis.window = {
  sessionStorage: {
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  },
};
const quizDraft = {
  quiz: { id: "quiz-1", questions: [{ id: "q1" }, { id: "q2" }] },
  questionIndex: 1, answers: [2, null], confidences: [3, null],
  selectedAnswer: 1, selectedConfidence: 2, showExplanation: true, showResults: false,
};

test("resumes the same question, pending choice, confidence and view", () => {
  data.clear();
  writeQuizDraft("student-1", "course-a", quizDraft);
  writeStudentLocation("student-1", "course-a", "quiz");
  const { savedAt, ...restored } = readQuizDraft("student-1", "course-a");
  assert.deepEqual(restored, quizDraft);
  assert.equal(typeof savedAt, "number");
  assert.deepEqual(readStudentLocation("student-1"), { courseId: "course-a", tab: "quiz" });
});

test("isolates students and courses and clears the current student on sign-out", () => {
  data.clear();
  writeQuizDraft("student-1", "course-a", quizDraft);
  writeQuizDraft("student-2", "course-a", quizDraft);
  writeStudentLocation("student-1", "course-a", "quiz");
  assert.equal(readQuizDraft("student-1", "course-b"), null);
  clearStudentSession("student-1");
  assert.equal(readQuizDraft("student-1", "course-a"), null);
  assert.notEqual(readQuizDraft("student-2", "course-a"), null);
  assert.equal(readStudentLocation("student-1").tab, "");
});

test("restores the committed result even when the draft choices came from another tab", () => {
  data.clear();
  const receipt = { attempt_id: "saved", correct: 0, total: 2, score: 0,
    outcomes: [{ question_id: "q2", is_correct: false, confidence: 1 },
      { question_id: "q1", is_correct: false, confidence: 2 }] };
  writeQuizDraft("student-1", "course-a", { ...quizDraft, showResults: true, receipt });
  assert.deepEqual(readQuizDraft("student-1", "course-a").receipt, receipt);
  assert.equal(readQuizDraft("student-2", "course-a"), null);
});

test("ignores expired or invalid snapshots", () => {
  data.clear();
  writeQuizDraft("student-1", "course-a", quizDraft);
  const storageKey = [...data.keys()][0];
  data.set(storageKey, JSON.stringify({ ...quizDraft, savedAt: 1 }));
  assert.equal(readQuizDraft("student-1", "course-a"), null);
  data.set(storageKey, "not json");
  assert.equal(readQuizDraft("student-1", "course-a"), null);
});
