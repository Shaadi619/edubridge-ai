import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { api } from "../../lib/api";

type Analytics = Awaited<ReturnType<typeof api.teacherCourseAnalytics>>;
type WorkReview = Awaited<ReturnType<typeof api.teacherWorkSubmissions>>[number];

export type DeskRequest = {
  id: number | string; name: string; email: string; course: string; requestedAt: string;
  status: "pending" | "approved" | "denied";
};
export type DeskAnnouncement = { id: string; title: string; body: string; createdAt: string; pinned?: boolean };
export type DeskCourse = { id: string; name: string; code: string; students: number };

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function shortTitle(title: string) {
  return title.replace(/\.(pdf|pptx?|docx?)$/i, "");
}

const quietButton = "min-h-10 rounded-lg border border-[var(--eb-line)] px-3 text-sm text-[var(--eb-text-soft)] transition-colors hover:border-[var(--eb-text-muted)] hover:text-[var(--eb-text)] disabled:opacity-40";
const primaryButton = "min-h-10 rounded-lg bg-[var(--eb-text)] px-4 text-sm font-semibold text-[var(--eb-ink)] disabled:opacity-40";
const field = "w-full rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-4 py-2.5 text-[15px] focus:border-[var(--eb-text-muted)] focus:outline-none";

function Heading({ title, note, action }: { title: string; note?: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>
        {note && <p className="m-0 max-w-[56ch] text-sm leading-relaxed text-[var(--eb-text-muted)]">{note}</p>}
      </div>
      {action}
    </header>
  );
}

export default function CourseDesk({
  course, courses, analytics, analyticsLoading, requests, onResolveRequest, workReviews, reviewingWorkId, onReviewWork,
  announcements, onPostAnnouncement, onDeleteAnnouncement, onNewCourse, focusedEnrollmentId, focusKey,
}: {
  course: DeskCourse;
  courses: DeskCourse[];
  analytics: Analytics | null;
  analyticsLoading: boolean;
  requests: DeskRequest[];
  onResolveRequest: (id: DeskRequest["id"], decision: "approved" | "denied") => Promise<void>;
  workReviews: WorkReview[];
  reviewingWorkId: string | null;
  onReviewWork: (id: string, decision: "approved" | "dismissed") => void;
  announcements: DeskAnnouncement[];
  onPostAnnouncement: (title: string, body: string, pinned: boolean) => Promise<boolean>;
  onDeleteAnnouncement: (id: string) => Promise<void>;
  onNewCourse: () => void;
  focusedEnrollmentId?: string;
  focusKey: number;
}) {
  const [resolving, setResolving] = useState<DeskRequest["id"] | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const pending = requests.filter(request => request.status === "pending" && request.course === course.name);

  useEffect(() => {
    if (!focusedEnrollmentId) return;
    const timer = window.setTimeout(() => document.getElementById(`enrollment-${focusedEnrollmentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => window.clearTimeout(timer);
  }, [focusKey, focusedEnrollmentId]);

  const resolve = async (id: DeskRequest["id"], decision: "approved" | "denied") => {
    setResolving(id);
    try { await onResolveRequest(id, decision); } finally { setResolving(null); }
  };

  const post = async () => {
    if (!title.trim() || !body.trim() || posting) return;
    setPosting(true);
    const ok = await onPostAnnouncement(title.trim(), body.trim(), pinned);
    setPosting(false);
    if (ok) { setTitle(""); setBody(""); setPinned(false); setComposing(false); }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(course.code);
      toast.success("Join code copied");
    } catch {
      toast.error(`Couldn’t copy. The code is ${course.code}.`);
    }
  };

  const summary = analyticsLoading || !analytics ? null : [
    plural(analytics.active_students, "student"),
    analytics.average_score ? `a ${analytics.average_score}% quiz average` : "no quiz results yet",
    analytics.open_flags ? `${plural(analytics.open_flags, "mistake")} still open` : "no open mistakes",
  ];

  return (
    <section aria-label={`${course.name} at a glance`} className="eb-stage mb-10 overflow-hidden rounded-2xl">
      <header className="flex flex-wrap items-end justify-between gap-5 px-6 pb-6 pt-7 sm:px-8">
        <div className="flex max-w-[62ch] flex-col gap-1.5">
          <h2 className="m-0 text-[24px] font-semibold tracking-[-0.015em]">{course.name}</h2>
          <p className="m-0 text-[16px] leading-relaxed text-[var(--eb-text-soft)]">
            {summary ? `${summary[0]}, ${summary[1]} and ${summary[2]}.` : "Adding up this course’s numbers…"}
            {analytics && analytics.quizzes_today > 0 && ` ${plural(analytics.quizzes_today, "quiz", "quizzes")} finished today.`}
            {analytics && analytics.overdue_study_tasks > 0 && ` ${plural(analytics.overdue_study_tasks, "study task")} overdue.`}
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-[var(--eb-line)] px-4 py-2.5">
          <span className="flex flex-col">
            <span className="text-sm text-[var(--eb-text-muted)]">Students join with</span>
            <span className="text-[17px] font-semibold tracking-wide">{course.code}</span>
          </span>
          <button type="button" onClick={() => void copyCode()} className={quietButton}>Copy</button>
        </div>
      </header>

      <div className="grid gap-px border-t border-[var(--eb-line-soft)] bg-[var(--eb-line-soft)] lg:grid-cols-2">
        <div className="flex flex-col gap-8 bg-[var(--eb-stage)] px-6 py-7 sm:px-8">
          <div className="flex flex-col gap-3">
            <Heading title={pending.length ? `${plural(pending.length, "student")} waiting to join` : "Join requests"}
              note={pending.length ? undefined : "When a student enters your join code, they appear here for you to let in."} />
            {pending.length > 0 && (
              <ul className="m-0 flex list-none flex-col p-0">
                {pending.map(request => (
                  <li key={request.id} id={`enrollment-${request.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eb-line-soft)] py-3 last:border-0"
                    style={String(request.id) === focusedEnrollmentId ? { boxShadow: "inset 3px 0 0 var(--eb-text)", paddingLeft: 12 } : undefined}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">{request.name}</span>
                      <span className="truncate text-sm text-[var(--eb-text-muted)]">{request.email}, asked {request.requestedAt}</span>
                    </span>
                    <span className="flex gap-2">
                      <button type="button" disabled={resolving === request.id} onClick={() => void resolve(request.id, "approved")} className={primaryButton}>Let in</button>
                      <button type="button" disabled={resolving === request.id} onClick={() => void resolve(request.id, "denied")} className={quietButton}>Turn down</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {workReviews.length > 0 && (
            <div className="flex flex-col gap-3">
              <Heading title={`${plural(workReviews.length, "upload")} to check`}
                note="From Show Your Work. EduBridge thinks these students may misunderstand something. Nothing goes on their record unless you agree." />
              <ul className="m-0 flex list-none flex-col p-0">
                {workReviews.map(submission => {
                  const misconception = submission.analysis?.misconception;
                  const sources = submission.analysis?.citations ?? [];
                  const busy = reviewingWorkId === submission.id;
                  return (
                    <li key={submission.id} className="flex flex-col gap-2.5 border-b border-[var(--eb-line-soft)] py-4 last:border-0">
                      <span className="text-sm text-[var(--eb-text-muted)]">{submission.student} uploaded {submission.filename}</span>
                      {misconception && (
                        <span className="text-[16px] font-semibold">May misunderstand {misconception.concept || misconception.label}</span>
                      )}
                      {misconception?.explanation && <p className="m-0 text-[15px] leading-relaxed text-[var(--eb-text-soft)]">{misconception.explanation}</p>}
                      {misconception?.evidence_from_student && (
                        <p className="m-0 border-l-2 border-[var(--eb-student-line)] pl-3 text-[15px] leading-relaxed text-[var(--eb-student-text)]">“{misconception.evidence_from_student}”</p>
                      )}
                      {sources.length > 0 && (
                        <span className="text-sm text-[var(--eb-text-muted)]">
                          Checked against {sources.map(source => `${shortTitle(source.document_title)}${source.page_number ? `, ${source.source_kind === "slide" ? "slide" : "page"} ${source.page_number}` : ""}`).join("; ")}
                        </span>
                      )}
                      <span className="flex flex-wrap gap-2 pt-1">
                        <button type="button" disabled={busy} onClick={() => onReviewWork(submission.id, "approved")} className={primaryButton}>{busy ? "Saving…" : "Agree, add to their record"}</button>
                        <button type="button" disabled={busy} onClick={() => onReviewWork(submission.id, "dismissed")} className={quietButton}>Not a problem</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Heading title="Your courses" action={<button type="button" onClick={onNewCourse} className={quietButton}>New course</button>} />
            <ul className="m-0 flex list-none flex-col p-0">
              {courses.map(item => (
                <li key={item.id} className="flex items-baseline justify-between gap-3 border-b border-[var(--eb-line-soft)] py-2.5 last:border-0">
                  <span className={`truncate text-[15px] ${item.id === course.id ? "font-semibold" : "text-[var(--eb-text-soft)]"}`}>{item.name}</span>
                  <span className="shrink-0 text-sm text-[var(--eb-text-muted)]">
                    {item.id === course.id && analytics ? `${plural(analytics.active_students, "student")}, code ${item.code}` : `Code ${item.code}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-4 bg-[var(--eb-stage)] px-6 py-7 sm:px-8">
          <Heading title="Announcements" note="Shown to every student in this course."
            action={<button type="button" onClick={() => setComposing(open => !open)} aria-expanded={composing} className={composing ? quietButton : primaryButton}>{composing ? "Cancel" : "Write one"}</button>} />
          {composing && (
            <form className="eb-rise flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void post(); }}>
              <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Title" aria-label="Title" className={`${field} font-semibold`} />
              <textarea value={body} onChange={event => setBody(event.target.value)} rows={4} placeholder="What do your students need to know?" aria-label="Message" className={`${field} resize-none leading-relaxed`} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-[var(--eb-text-soft)]">
                  <input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} className="h-4 w-4 accent-[#E7EDF2]" />
                  Keep it at the top for students
                </label>
                <button type="submit" disabled={!title.trim() || !body.trim() || posting} className={primaryButton}>{posting ? "Posting…" : `Post to ${course.name}`}</button>
              </div>
            </form>
          )}
          {announcements.length === 0 ? (
            !composing && <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">Nothing posted yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {announcements.map(item => (
                <li key={item.id} className="flex items-start justify-between gap-4 border-b border-[var(--eb-line-soft)] py-4 last:border-0">
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[15px] font-semibold">{item.title}{item.pinned && <span className="ml-2 text-sm font-normal text-[var(--eb-text-muted)]">Kept at the top</span>}</span>
                    <span className="text-[15px] leading-relaxed text-[var(--eb-text-soft)]">{item.body}</span>
                    <span className="text-sm text-[var(--eb-text-muted)]">{item.createdAt}</span>
                  </span>
                  <button type="button" disabled={deleting === item.id} aria-label={`Delete ${item.title}`}
                    onClick={async () => { setDeleting(item.id); await onDeleteAnnouncement(item.id); setDeleting(null); }}
                    className="min-h-9 shrink-0 rounded-lg px-2.5 text-sm text-[var(--eb-text-muted)] hover:text-[var(--eb-text)] disabled:opacity-40">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
