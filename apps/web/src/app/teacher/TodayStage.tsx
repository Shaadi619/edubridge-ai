import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Sparkles } from "lucide-react";

import { api } from "../../lib/api";
import { citationLocation, loadCitationExcerpt, type CitationExcerpt } from "../../lib/citations";
import { highlightEvidence } from "../../lib/evidenceHighlight";

type Analytics = Awaited<ReturnType<typeof api.teacherCourseAnalytics>>;
export type QueueItem = Analytics["intervention_queue"][number];

const SOURCE_LABEL: Record<QueueItem["source"], string> = {
  misconception: "Flagged by the tutor",
  retention: "Missed a follow-up check",
  confidence_gap: "Confident but wrong in quizzes",
  prerequisite_gap: "Possible gap in an earlier concept",
  study_plan: "Overdue study task",
};

const MOTES = [
  { left: "58%", top: "30%", size: 3, duration: "9s", delay: "0s" },
  { left: "66%", top: "48%", size: 2, duration: "11s", delay: "1.4s" },
  { left: "72%", top: "24%", size: 2, duration: "8.5s", delay: "3s" },
  { left: "61%", top: "62%", size: 3, duration: "12s", delay: "0.7s" },
  { left: "78%", top: "40%", size: 2, duration: "10s", delay: "4s" },
  { left: "54%", top: "44%", size: 2, duration: "9.5s", delay: "2.2s" },
];

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}

function shortTitle(title: string) {
  return title.replace(/\.(pdf|pptx?|docx?)$/i, "");
}

function whereLabel(item: QueueItem) {
  const citation = item.citations[0];
  const location = citation ? citationLocation(citation.source_kind, citation.page_number) : null;
  return location ? `${item.concept}, ${location.toLowerCase()}` : item.concept;
}

type ExcerptState = "none" | "loading" | "error" | CitationExcerpt;

function CorrectingPassage({ courseId, item }: { courseId: string; item: QueueItem }) {
  const citation = item.citations.find(entry => entry.chunk_id) ?? null;
  const [excerpt, setExcerpt] = useState<ExcerptState>(citation ? "loading" : "none");

  useEffect(() => {
    if (!citation?.chunk_id) { setExcerpt("none"); return; }
    const controller = new AbortController();
    setExcerpt("loading");
    void loadCitationExcerpt(courseId, citation.chunk_id, controller.signal)
      .then(source => { if (!controller.signal.aborted) setExcerpt(source); })
      .catch(() => { if (!controller.signal.aborted) setExcerpt("error"); });
    return () => controller.abort();
  }, [courseId, citation?.chunk_id]);

  const spans = useMemo(() => {
    if (excerpt === "none" || excerpt === "loading" || excerpt === "error") return [];
    return highlightEvidence(excerpt.content, `${item.concept} ${item.recommended_action} ${item.reason}`);
  }, [excerpt, item]);
  const location = citation ? citationLocation(citation.source_kind, citation.page_number) : null;

  return (
    <article key={item.id} aria-label="What the course says"
      className="eb-paper relative z-[1] flex max-h-[340px] min-w-0 flex-[1.3_1_300px] flex-col gap-2 overflow-y-auto px-7 py-6">
      <span className="text-[13px] text-[var(--eb-ink-faint)]">
        {citation ? `${shortTitle(citation.document_title)}${location ? `, ${location.toLowerCase()}` : ""}` : "What the course says"}
      </span>
      <span className="eb-serif text-[21px] font-medium">{item.concept}</span>
      {excerpt === "none" && (
        <p className="m-0 text-[15px] text-[var(--eb-ink-muted)]">
          {item.citations.length > 0
            ? `Cited: ${item.citations.map(entry => `${shortTitle(entry.document_title)}${entry.page_number ? `, ${citationLocation(entry.source_kind, entry.page_number)?.toLowerCase()}` : ""}`).join("; ")}.`
            : "No course passage was linked to this item."}
        </p>
      )}
      {excerpt === "loading" && (
        <div role="status" aria-label="Loading course passage" className="flex flex-col gap-3 pt-1">
          {["82%", "94%", "70%"].map((width, index) => (
            <span key={index} aria-hidden="true" className="block h-2 animate-pulse rounded-sm bg-[rgba(30,42,54,0.13)] motion-reduce:animate-none" style={{ width }} />
          ))}
        </div>
      )}
      {excerpt === "error" && <p className="m-0 text-[15px] text-[var(--eb-ink-muted)]">This passage is unavailable right now.</p>}
      {spans.length > 0 && (
        <p className="eb-serif m-0 text-[17px] leading-[1.7] text-[var(--eb-ink-muted)]">
          {spans.map((span, index) => (
            <span key={index}>
              {span.lit ? <mark className="eb-lit">{span.text}</mark> : span.text}
              {index < spans.length - 1 ? " " : ""}
            </span>
          ))}
        </p>
      )}
    </article>
  );
}

export default function TodayStage({ courseId, analytics, loading, accessToken, assigningId, assignedIds, onAssign, onDraft, onViewStudent }: {
  courseId: string;
  analytics: Analytics | null;
  loading: boolean;
  accessToken: string;
  assigningId: string | null;
  assignedIds: string[];
  onAssign: (item: QueueItem) => void;
  onDraft: (item: QueueItem) => void;
  onViewStudent: (studentId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [concept, setConcept] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => { setSelectedId(null); setConcept(null); setResolvedIds([]); }, [courseId]);

  const items = useMemo(
    () => (analytics?.intervention_queue ?? []).filter(item => !resolvedIds.includes(item.id)),
    [analytics, resolvedIds],
  );
  const isAssigned = (item: QueueItem) => item.practice_assigned || assignedIds.includes(item.id);
  const openStudents = new Set(items.filter(item => !isAssigned(item)).map(item => item.student_id)).size;
  const shown = concept ? items.filter(item => item.concept === concept) : items;
  const selected = shown.find(item => item.id === selectedId) ?? shown[0] ?? null;

  const concepts = useMemo(() => {
    const groups = new Map<string, { name: string; students: Set<string>; pages: Set<string> }>();
    items.forEach(item => {
      const group = groups.get(item.concept) ?? { name: item.concept, students: new Set<string>(), pages: new Set<string>() };
      group.students.add(item.student_id);
      item.citations.forEach(citation => {
        const location = citationLocation(citation.source_kind, citation.page_number);
        if (location) group.pages.add(location);
      });
      groups.set(item.concept, group);
    });
    return [...groups.values()].sort((a, b) => b.students.size - a.students.size).slice(0, 4);
  }, [items]);
  const maxStudents = Math.max(1, ...concepts.map(group => group.students.size));

  const resolve = async (item: QueueItem) => {
    if (!item.misconception_id) return;
    setResolvingId(item.id);
    try {
      await api.addressMisconception(courseId, item.misconception_id, accessToken);
      setResolvedIds(current => [...current, item.id]);
      toast.success(`Marked ${firstName(item.student)}’s ${item.concept} flag as resolved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not mark this as resolved.");
    } finally {
      setResolvingId(null);
    }
  };

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const headline = loading && !analytics
    ? "Loading today’s queue…"
    : openStudents === 0 ? "Everyone is on track today"
    : `${openStudents} student${openStudents === 1 ? " needs" : "s need"} you today`;

  return (
    <section aria-label="Students who need you today" className="eb-stage mb-10 overflow-hidden rounded-2xl px-6 py-7 sm:px-8 sm:py-8">
      <header className="mb-7 flex flex-col gap-1.5">
        <span className="text-sm text-[var(--eb-text-muted)]">{today}</span>
        <h1 aria-live="polite" className="m-0 text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[40px]">{headline}</h1>
        <p className="m-0 mt-1 max-w-[62ch] text-[15px] text-[var(--eb-text-muted)]">
          Flags from the tutor, quizzes and follow-up checks. Each one sits next to the passage in your material that addresses it.
        </p>
      </header>

      {items.length > 0 && (
        <div className="flex flex-wrap items-start gap-6">
          <div role="group" aria-label="Students to review" className="flex min-w-0 max-w-[420px] flex-[1_1_300px] flex-col gap-2">
            {shown.map(item => {
              const on = selected?.id === item.id;
              const assigned = isAssigned(item);
              const when = timeAgo(item.due_at);
              return (
                <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-pressed={on}
                  className={`flex w-full items-start gap-3.5 rounded-xl px-4 py-3.5 text-left transition-[background,box-shadow] duration-200 ${on
                    ? "bg-[var(--eb-raised)] shadow-[0_0_0_1px_rgba(240,185,74,0.5),0_10px_30px_-12px_rgba(0,0,0,0.6)]"
                    : `shadow-[0_0_0_1px_var(--eb-line-soft)] hover:bg-[var(--eb-raised-2)]${assigned ? " opacity-70" : ""}`}`}
                >
                  <span aria-hidden="true" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-[var(--eb-student)] text-[13px] font-bold text-[var(--eb-student-text)]">
                    {initials(item.student)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex justify-between gap-2.5">
                      <span className="text-[15px] font-semibold">{item.student}</span>
                      {when && <span className="whitespace-nowrap text-[13px] text-[var(--eb-text-muted)]">{when}</span>}
                    </span>
                    {item.student_evidence
                      ? <span className="text-sm leading-snug text-[#A7DDD6]">“{item.student_evidence}”</span>
                      : <span className="text-sm leading-snug text-[var(--eb-text-soft)]">{SOURCE_LABEL[item.source]}</span>}
                    <span className="text-[13px] text-[var(--eb-text-muted)]">{whereLabel(item)}</span>
                    {assigned && <span className="mt-1 self-start rounded-md bg-[#A7DDD6] px-2 py-0.5 text-[13px] font-semibold text-[var(--eb-ink)]">Practice assigned</span>}
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <p className="m-0 rounded-xl bg-[var(--eb-raised-2)] px-4 py-4 text-[var(--eb-text-soft)]">Nobody is waiting on this concept. Pick another below or show everyone.</p>
            )}
          </div>

          {selected && (
            <div className="eb-source min-w-0 flex-[999_1_520px] rounded-[18px] shadow-[inset_0_0_160px_rgba(0,0,0,0.6),0_0_0_1px_#26313D]">
              <div aria-hidden="true" className="eb-beam" style={{ left: "62%", width: "90%" }} />
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                {MOTES.map((mote, index) => (
                  <span key={index} className="eb-mote" style={{ left: mote.left, top: mote.top, width: mote.size, height: mote.size, animationDuration: mote.duration, animationDelay: mote.delay }} />
                ))}
              </div>
              <div key={selected.id} className="eb-rise relative z-[1] flex flex-col gap-6 px-6 py-6 sm:px-8 sm:py-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-[22px] font-semibold tracking-[-0.01em]">{selected.student}</span>
                    <span className="text-sm text-[var(--eb-text-muted)]">
                      {SOURCE_LABEL[selected.source]}{timeAgo(selected.due_at) ? ` ${timeAgo(selected.due_at)}` : ""}
                      {selected.priority === "high" ? ". High priority" : ""}
                    </span>
                  </div>
                  <button type="button" onClick={() => onViewStudent(selected.student_id)}
                    className="min-h-11 text-sm text-[var(--eb-text-soft)] underline underline-offset-4 hover:text-[var(--eb-light)]">
                    Open {firstName(selected.student)}’s progress
                  </button>
                </div>

                <div className="flex flex-wrap items-stretch gap-5">
                  <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2.5 pt-2">
                    {selected.student_evidence ? (
                      <>
                        <span className="text-sm text-[var(--eb-text-muted)]">{firstName(selected.student)} wrote</span>
                        <p className="m-0 text-[24px] font-medium leading-[1.35] tracking-[-0.01em] text-[#A7DDD6]">“{selected.student_evidence}”</p>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-[var(--eb-text-muted)]">Why this is here</span>
                        <p className="m-0 text-[18px] leading-[1.5] text-[var(--eb-text)]">{selected.reason}</p>
                      </>
                    )}
                    {selected.downstream_concept && (
                      <p className="m-0 text-sm text-[var(--eb-text-muted)]">This may be holding back {selected.downstream_concept}.</p>
                    )}
                  </div>
                  <CorrectingPassage courseId={courseId} item={selected} />
                </div>

                <div className="flex flex-col gap-3.5 rounded-[14px] border border-[var(--eb-line)] bg-[rgba(39,51,63,0.82)] px-5 py-5 backdrop-blur-[6px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-base font-semibold">Suggested next step</span>
                    <span className="text-[15px] text-[var(--eb-text-soft)]">{selected.recommended_action}</span>
                  </div>
                  {isAssigned(selected) ? (
                    <div role="status" className="eb-rise flex flex-wrap items-center gap-3">
                      <span aria-hidden="true" className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#A7DDD6] text-[var(--eb-ink)]"><Check size={14} strokeWidth={3} /></span>
                      <span>Practice on {selected.concept} is assigned to {firstName(selected.student)}.</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2.5">
                      <button type="button" onClick={() => onAssign(selected)} disabled={assigningId === selected.id}
                        className="min-h-[46px] rounded-[10px] bg-[var(--eb-light)] px-[18px] font-bold text-[var(--eb-ink)] shadow-[0_0_28px_var(--eb-light-glow)] disabled:opacity-60">
                        {assigningId === selected.id ? "Assigning…" : `Assign practice to ${firstName(selected.student)}`}
                      </button>
                      <button type="button" onClick={() => onDraft(selected)}
                        className="inline-flex min-h-[46px] items-center gap-2 rounded-[10px] border border-[#44525F] px-4 text-[var(--eb-text)] hover:bg-[var(--eb-raised)]">
                        <Sparkles size={15} aria-hidden="true" />Draft a message with AI
                      </button>
                      {selected.misconception_id && (
                        <button type="button" onClick={() => void resolve(selected)} disabled={resolvingId === selected.id}
                          className="min-h-[46px] px-3 text-[var(--eb-text-soft)] underline underline-offset-4 hover:text-[var(--eb-text)] disabled:opacity-60">
                          {resolvingId === selected.id ? "Saving…" : "Mark resolved"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {concepts.length > 0 && (
        <div className="mt-8 flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="m-0 text-lg font-semibold">By concept</h2>
            {concept && (
              <button type="button" onClick={() => setConcept(null)} className="min-h-11 text-[var(--eb-text-soft)] underline underline-offset-4">Show everyone</button>
            )}
          </div>
          <div role="group" aria-label="Filter by concept" className="flex flex-wrap gap-4">
            {concepts.map(group => {
              const on = concept === group.name;
              const share = group.students.size / maxStudents;
              const bar = `rgba(240,185,74,${(0.35 + 0.65 * share).toFixed(2)})`;
              return (
                <button key={group.name} type="button" onClick={() => setConcept(on ? null : group.name)} aria-pressed={on}
                  className={`flex min-w-0 flex-[1_1_200px] flex-col gap-3 rounded-xl border px-[18px] py-4 text-left transition-[box-shadow,background] duration-200 ${on
                    ? "border-[rgba(240,185,74,0.6)] bg-[var(--eb-raised)] shadow-[0_0_30px_-8px_rgba(240,185,74,0.45)]"
                    : "border-[var(--eb-line-soft)] bg-[#1A2430] hover:bg-[var(--eb-raised-2)]"}`}
                >
                  <span className="flex justify-between gap-2.5">
                    <span className="font-semibold">{group.name}</span>
                    <span className="whitespace-nowrap text-sm text-[var(--eb-text-soft)]">{group.students.size} student{group.students.size === 1 ? "" : "s"}</span>
                  </span>
                  <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-[3px] bg-[var(--eb-line-soft)]">
                    <span className="block h-full rounded-[3px]" style={{ width: `${Math.round(share * 100)}%`, background: bar, boxShadow: `0 0 14px ${bar}` }} />
                  </span>
                  {group.pages.size > 0 && <span className="text-[13px] text-[var(--eb-text-muted)]">{[...group.pages].slice(0, 3).join(", ")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
