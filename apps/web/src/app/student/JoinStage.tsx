import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "../../auth/AuthContext";
import { api, ApiError } from "../../lib/api";
import type { StudentCourse } from "./chatTypes";

type Pending = { id: string; code: string; course: string; teacher: string; createdAt: string };
type Found = Awaited<ReturnType<typeof api.lookupCourse>>;
type Lookup = "idle" | "looking" | "found" | "notfound" | { error: string };

const WRONG = "#E8907F";

function asked(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

export default function JoinStage({ courses }: { courses: StudentCourse[] }) {
  const { session } = useAuth();
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<Lookup>("idle");
  const [found, setFound] = useState<Found | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    if (!session) return;
    try {
      const rows = await api.myEnrollments(session.access_token);
      setPending(rows.filter(row => row.status === "pending").map(row => ({
        id: row.id, code: row.enrollment_code, course: row.course_name, teacher: row.teacher, createdAt: row.created_at,
      })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your requests couldn’t be loaded.");
    }
  }, [session]);

  useEffect(() => { void loadPending(); }, [loadPending]);

  const find = async () => {
    const value = code.trim();
    if (value.length < 3 || !session || lookup === "looking") return;
    setLookup("looking"); setFound(null);
    try {
      setFound(await api.lookupCourse(value, session.access_token));
      setLookup("found");
    } catch (error) {
      setLookup(error instanceof ApiError && error.status === 404
        ? "notfound"
        : { error: error instanceof Error ? error.message : "Finding courses isn’t working right now. Try again in a moment." });
    }
  };

  const request = async () => {
    if (!found || !session) return;
    setSending(true);
    try {
      await api.requestEnrollment(found.id, session.access_token);
      await loadPending();
      toast.success(`Asked ${found.teacher} to let you into ${found.name}`);
      setCode(""); setFound(null); setLookup("idle");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your request couldn’t be sent. Try again.");
    } finally {
      setSending(false);
    }
  };

  const cancel = async (item: Pending) => {
    if (!session) return;
    setCancelling(item.id);
    try {
      await api.cancelEnrollment(item.id, session.access_token);
      setPending(current => current.filter(row => row.id !== item.id));
      toast(`Request for ${item.course} cancelled`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The request couldn’t be cancelled.");
    } finally {
      setCancelling(null);
    }
  };

  const alreadyAsked = found ? pending.some(item => item.code.toUpperCase() === found.enrollment_code.toUpperCase()) : false;
  const alreadyIn = found ? courses.some(course => course.id === found.id) : false;

  return (
    <div className="eb-stage min-h-[calc(100vh-3.5rem)] px-5 py-10 sm:px-10">
      <div className="mx-auto flex max-w-[600px] flex-col gap-10">
        <div className="flex flex-col gap-2">
          <h2 className="m-0 text-[28px] font-semibold tracking-[-0.02em]">Enter your join code</h2>
          <p className="m-0 text-[16px] leading-relaxed text-[var(--eb-text-soft)]">Your teacher gives each course a short code. Once you enter it, they get a request and let you in.</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void find(); }}>
          <label className="flex flex-col gap-2">
            <span className="text-[15px] font-medium">Join code</span>
            <span className="flex gap-2">
              <input value={code} aria-label="Join code" autoCapitalize="characters" autoComplete="off" spellCheck={false}
                onChange={event => { setCode(event.target.value.toUpperCase()); setLookup("idle"); setFound(null); }}
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-4 text-[18px] font-semibold tracking-[0.08em] focus:border-[var(--eb-text-muted)] focus:outline-none" />
              <button type="submit" disabled={code.trim().length < 3 || lookup === "looking"}
                className="min-h-12 shrink-0 rounded-xl bg-[var(--eb-text)] px-5 font-semibold text-[var(--eb-ink)] disabled:opacity-40">
                {lookup === "looking" ? "Finding…" : "Find course"}
              </button>
            </span>
          </label>
          {lookup === "notfound" && <p role="alert" className="m-0 text-[15px]" style={{ color: WRONG }}>No course has that code. Check it with your teacher, letters and dashes included.</p>}
          {typeof lookup === "object" && <p role="alert" className="m-0 text-[15px]" style={{ color: WRONG }}>{lookup.error}</p>}

          {lookup === "found" && found && (
            <div className="eb-rise flex flex-col gap-4 rounded-2xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] p-5">
              <div className="flex flex-col gap-1">
                <span className="text-[20px] font-semibold">{found.name}</span>
                <span className="text-[15px] text-[var(--eb-text-soft)]">Taught by {found.teacher}{found.subject ? `, ${found.subject}` : ""}</span>
                <span className="text-sm text-[var(--eb-text-muted)]">{found.students} {found.students === 1 ? "student" : "students"}, {found.documents} {found.documents === 1 ? "document" : "documents"} to learn from</span>
              </div>
              {alreadyIn ? (
                <p className="m-0 text-[15px] text-[var(--eb-text-soft)]">You’re already in this course.</p>
              ) : alreadyAsked ? (
                <p className="m-0 text-[15px] text-[var(--eb-text-soft)]">You’ve already asked to join. Your teacher hasn’t answered yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={sending} onClick={() => void request()}
                    className="min-h-11 rounded-xl bg-[var(--eb-text)] px-5 font-semibold text-[var(--eb-ink)] disabled:opacity-50">
                    {sending ? "Sending…" : "Ask to join"}
                  </button>
                  <button type="button" onClick={() => { setCode(""); setFound(null); setLookup("idle"); }}
                    className="min-h-11 rounded-xl border border-[var(--eb-line)] px-4 text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]">
                    Not this one
                  </button>
                </div>
              )}
            </div>
          )}
        </form>

        {pending.length > 0 && (
          <section className="flex flex-col gap-3">
            <h3 className="m-0 text-[18px] font-semibold">Waiting for your teacher</h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {pending.map(item => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eb-line-soft)] py-3 last:border-0">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">{item.course}</span>
                    <span className="text-sm text-[var(--eb-text-muted)]">{item.teacher}, asked {asked(item.createdAt)}</span>
                  </span>
                  <button type="button" disabled={cancelling === item.id} onClick={() => void cancel(item)}
                    className="min-h-10 rounded-lg px-3 text-sm text-[var(--eb-text-muted)] hover:text-[var(--eb-text)] disabled:opacity-40">
                    {cancelling === item.id ? "Cancelling…" : "Cancel request"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-[18px] font-semibold">Your courses</h3>
          {courses.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {courses.map(course => (
                <li key={course.id} className="flex items-baseline justify-between gap-3 border-b border-[var(--eb-line-soft)] py-3 last:border-0">
                  <span className="text-[15px] font-semibold">{course.name}</span>
                  <span className="text-sm text-[var(--eb-text-muted)]">{course.teacher}</span>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">None yet. Courses appear here once a teacher lets you in.</p>}
        </section>
      </div>
    </div>
  );
}
