import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api";
import { useScopedQuery } from "../useScopedRequest";
import { friendlyConcept } from "./TodayStage";

type Analytics = Awaited<ReturnType<typeof api.teacherCourseAnalytics>>;
type Student = Analytics["students"][number];
type Filter = "all" | Student["status"];

const WRONG = "#E8907F";
const STATUS: Record<Student["status"], { label: string; color: string }> = {
  struggling: { label: "Needs support", color: WRONG },
  active: { label: "On track", color: "var(--eb-text-muted)" },
  excelling: { label: "Doing well", color: "var(--eb-text)" },
};
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "struggling", label: "Needs support" },
  { id: "active", label: "On track" },
  { id: "excelling", label: "Doing well" },
];

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function date(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

function summary(student: Student) {
  if (student.quizzes === 0) return "No quizzes yet";
  return `${student.progress}% average across ${plural(student.quizzes, "quiz", "quizzes")}`;
}

function StudentDetail({ courseId, student, accessToken, focusedAttemptId, focusKey }: {
  courseId: string; student: Student; accessToken: string; focusedAttemptId?: string; focusKey: number;
}) {
  const load = useCallback((signal: AbortSignal) => api.teacherStudentProgress(courseId, student.id, accessToken, signal), [courseId, student.id, accessToken]);
  const { data: detail, loading } = useScopedQuery(`${courseId}:${student.id}`, load, "This student’s progress couldn’t be loaded.");

  useEffect(() => {
    if (!detail || !focusedAttemptId) return;
    const timer = window.setTimeout(() => document.getElementById(`attempt-${focusedAttemptId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    return () => window.clearTimeout(timer);
  }, [detail, focusKey, focusedAttemptId]);

  const status = STATUS[student.status];
  const topics = detail ? [...detail.topic_scores].sort((a, b) => a.score - b.score) : [];
  const open = detail?.misconceptions.filter(item => item.status === "open") ?? [];

  return (
    <article aria-label={student.name} className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h2 className="m-0 text-[24px] font-semibold tracking-[-0.015em]">{student.name}</h2>
        <p className="m-0 text-[16px] text-[var(--eb-text-soft)]">
          {summary(student)}. <span style={{ color: status.color }}>{status.label}</span>
          {student.overdue_tasks > 0 && <>. {plural(student.overdue_tasks, "study task")} overdue</>}
        </p>
      </header>

      {loading || !detail ? (
        <div role="status" className="flex flex-col gap-3 text-[15px] text-[var(--eb-text-soft)]">
          Loading {student.name.split(" ")[0]}’s quizzes and mistakes…
          <span aria-hidden="true" className="relative block h-[3px] max-w-[280px] overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
            <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-text-muted),transparent)]" />
          </span>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h3 className="m-0 text-[17px] font-semibold">Topics, weakest first</h3>
            {topics.length ? (
              <ul className="m-0 list-none p-0">
                {topics.map(topic => {
                  const low = topic.score < 50;
                  return (
                    <li key={topic.topic} className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-x-4 gap-y-1.5 border-b border-[var(--eb-line-soft)] py-2.5 last:border-0">
                      <span className="text-[15px]">{friendlyConcept(topic.topic)}</span>
                      <span className="text-right text-[15px] font-semibold tabular-nums" style={{ color: low ? WRONG : undefined }}>{topic.score}%</span>
                      <span aria-hidden="true" className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-[var(--eb-line-soft)]">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, topic.score)}%`, background: low ? WRONG : "var(--eb-text-soft)" }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">No quiz answers yet, so there are no topic scores.</p>}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="m-0 text-[17px] font-semibold">{open.length ? `${plural(open.length, "mistake")} still open` : "Mistakes spotted"}</h3>
            {detail.misconceptions.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {detail.misconceptions.map(item => (
                  <li key={item.id} className="flex flex-col gap-1 border-b border-[var(--eb-line-soft)] py-3 last:border-0">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold">{friendlyConcept(item.concept)}</span>
                      <span className="text-sm text-[var(--eb-text-muted)]">{item.status === "open" ? "Still open" : "Dealt with"}, {date(item.created_at)}</span>
                    </span>
                    <p className="m-0 text-[15px] leading-relaxed text-[var(--eb-text-soft)]">{item.explanation}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">Nothing spotted so far.</p>}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="m-0 text-[17px] font-semibold">Quizzes taken</h3>
            {detail.attempts.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {detail.attempts.map(attempt => (
                  <li key={attempt.id} id={`attempt-${attempt.id}`}
                    className="flex items-center justify-between gap-4 border-b border-[var(--eb-line-soft)] py-3 last:border-0"
                    style={attempt.id === focusedAttemptId ? { boxShadow: "inset 3px 0 0 var(--eb-text)", paddingLeft: 12 } : undefined}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[15px]">{attempt.title}</span>
                      <span className="text-sm text-[var(--eb-text-muted)]">{attempt.correct} of {attempt.total} right, {date(attempt.completed_at)}</span>
                    </span>
                    <span className="shrink-0 text-[17px] font-semibold tabular-nums" style={{ color: attempt.score < 50 ? WRONG : undefined }}>{attempt.score}%</span>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">No finished quizzes yet.</p>}
          </section>
        </>
      )}
    </article>
  );
}

export default function StudentsStage({ searchQuery = "", courseId, courseName, accessToken, analytics, loading, focusedStudentId, focusedAttemptId, focusKey }: {
  searchQuery?: string;
  courseId: string;
  courseName: string;
  accessToken: string;
  analytics: Analytics | null;
  loading: boolean;
  focusedStudentId?: string;
  focusedAttemptId?: string;
  focusKey: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const students = [...(analytics?.students ?? [])].sort((a, b) => {
    const rank = { struggling: 0, active: 1, excelling: 2 } as const;
    return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name);
  });

  useEffect(() => {
    if (focusedStudentId) { setSelectedId(focusedStudentId); setFilter("all"); }
  }, [focusKey, focusedStudentId]);

  const needle = searchQuery.trim().toLowerCase();
  const visible = students.filter(student =>
    (filter === "all" || student.status === filter) && (!needle || student.name.toLowerCase().includes(needle)));
  const selected = students.find(student => student.id === selectedId) ?? visible[0] ?? null;

  return (
    <section aria-label="Students" className="eb-stage overflow-hidden rounded-2xl">
      <header className="flex flex-col gap-4 px-6 pb-5 pt-7 sm:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.015em]">Students</h1>
          <p className="m-0 text-[15px] text-[var(--eb-text-soft)]">
            {plural(students.length, "student")} in {courseName}{needle ? `, ${visible.length} matching “${searchQuery.trim()}”` : ""}. “Needs support” means averaging under 50% in quizzes; “Doing well” means 80% or more.
          </p>
        </div>
        {students.length > 0 && (
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {FILTERS.map(item => {
              const count = item.id === "all" ? students.length : students.filter(student => student.status === item.id).length;
              return (
                <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}
                  className={`min-h-9 rounded-lg px-3 text-sm transition-colors ${filter === item.id ? "bg-[var(--eb-text)] font-semibold text-[var(--eb-ink)]" : "border border-[var(--eb-line)] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]"}`}>
                  {item.label} ({count})
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div className="grid border-t border-[var(--eb-line-soft)] lg:grid-cols-[minmax(280px,38%)_minmax(0,1fr)]">
        <div className="min-w-0 px-4 py-4 sm:px-6">
          {loading ? (
            <p role="status" className="m-0 px-2 py-4 text-[15px] text-[var(--eb-text-soft)]">Loading students…</p>
          ) : students.length === 0 ? (
            <p className="m-0 px-2 py-4 text-[15px] leading-relaxed text-[var(--eb-text-soft)]">No students have joined yet. Share the course code from Overview so they can join.</p>
          ) : visible.length === 0 ? (
            <p className="m-0 px-2 py-4 text-[15px] text-[var(--eb-text-muted)]">{needle ? `No one matches “${searchQuery.trim()}”.` : "No students in this group."}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {visible.map(student => {
                const current = student.id === selected?.id;
                const status = STATUS[student.status];
                return (
                  <li key={student.id}>
                    <button type="button" aria-current={current ? "true" : undefined} onClick={() => setSelectedId(student.id)}
                      className="flex min-h-[60px] w-full flex-col justify-center gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--eb-raised-2)]"
                      style={current ? { background: "var(--eb-raised)" } : undefined}>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={`truncate text-[15px] ${current ? "font-semibold" : ""}`}>{student.name}</span>
                        <span className="shrink-0 text-sm" style={{ color: status.color }}>{status.label}</span>
                      </span>
                      <span className="text-sm text-[var(--eb-text-muted)]">
                        {summary(student)}{student.overdue_tasks > 0 ? `, ${plural(student.overdue_tasks, "task")} overdue` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="min-h-[420px] border-t border-[var(--eb-line-soft)] px-6 py-7 sm:px-8 lg:border-l lg:border-t-0">
          {selected ? (
            <StudentDetail key={selected.id} courseId={courseId} student={selected} accessToken={accessToken} focusedAttemptId={focusedAttemptId} focusKey={focusKey} />
          ) : (
            <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">Choose a student to see their quizzes, topics and mistakes.</p>
          )}
        </div>
      </div>
    </section>
  );
}
