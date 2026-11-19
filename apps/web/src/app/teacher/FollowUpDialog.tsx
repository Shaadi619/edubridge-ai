import { useEffect, useRef } from "react";

import type { TeacherInterventionDraft } from "../../lib/api";
import type { QueueItem } from "./TodayStage";
import { friendlyConcept } from "./TodayStage";

const field = "w-full resize-y rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-4 py-3 text-[15px] leading-relaxed focus:border-[var(--eb-text-muted)] focus:outline-none";

export default function FollowUpDialog({ item, draft, loading, dueDays, assigning, onDueDays, onChange, onClose, onAssign }: {
  item: QueueItem;
  draft: TeacherInterventionDraft | null;
  loading: boolean;
  dueDays: number;
  assigning: boolean;
  onDueDays: (days: number) => void;
  onChange: (draft: TeacherInterventionDraft) => void;
  onClose: () => void;
  onAssign: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const first = item.student.split(" ")[0];

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(10,15,20,0.62)] p-4 backdrop-blur-sm"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Follow-up for ${item.student}`}
        className="eb-stage eb-rise flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--eb-line-soft)] px-6 py-5">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[21px] font-semibold tracking-[-0.01em]">Plan a follow-up with {first}</h2>
            <p className="m-0 text-[15px] text-[var(--eb-text-soft)]">On {friendlyConcept(item.concept)}. Edit anything before you send it.</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg px-3 text-sm text-[var(--eb-text-muted)] hover:text-[var(--eb-text)]">{loading ? "Stop" : "Close"}</button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading || !draft ? (
            <div role="status" className="flex flex-col gap-3 py-8 text-[15px] text-[var(--eb-text-soft)]">
              Writing a plan from {first}’s mistake and your course material…
              <span aria-hidden="true" className="relative block h-[3px] max-w-[320px] overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
                <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-text-muted),transparent)]" />
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <p className="m-0 text-[15px] leading-relaxed text-[var(--eb-text-soft)]"><span className="font-semibold text-[var(--eb-text)]">Why: </span>{draft.rationale}</p>

              <label className="flex flex-col gap-2">
                <span className="font-semibold">What you’ll do</span>
                <textarea rows={3} value={draft.recommended_action} onChange={event => onChange({ ...draft, recommended_action: event.target.value })} className={field} />
              </label>
              <label className="flex flex-col gap-2">
                <span className="font-semibold">Message {first} will get</span>
                <textarea rows={3} value={draft.student_message} onChange={event => onChange({ ...draft, student_message: event.target.value })} className={`${field} text-[var(--eb-text)]`} />
              </label>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="font-semibold">Things to say</span>
                  <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-[var(--eb-text-soft)]">
                    {draft.talking_points.map((point, index) => <li key={index}>{point}</li>)}
                  </ul>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="font-semibold">How you’ll know it worked</span>
                  <p className="m-0 text-[15px] leading-relaxed text-[var(--eb-text-soft)]">{draft.success_check}</p>
                </div>
              </div>

              {draft.citations.length > 0 && (
                <p className="m-0 text-sm text-[var(--eb-text-muted)]">
                  Based on {draft.citations.map(source => `${source.document_title.replace(/\.(pdf|pptx?|docx?)$/i, "")}${source.page_number ? `, ${source.source_kind === "slide" ? "slide" : "page"} ${source.page_number}` : ""}`).join("; ")}
                </p>
              )}
            </div>
          )}
        </div>

        {draft && !loading && (
          <footer className="flex flex-wrap items-end justify-between gap-4 border-t border-[var(--eb-line-soft)] px-6 py-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--eb-text-muted)]">Due in</span>
              <select value={dueDays} onChange={event => onDueDays(Number(event.target.value))}
                className="min-h-10 rounded-lg border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-3 text-[15px]">
                {[1, 3, 7, 14].map(days => <option key={days} value={days}>{days === 1 ? "1 day" : `${days} days`}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-[var(--eb-line)] px-4 text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]">Cancel</button>
              <button type="button" onClick={onAssign} disabled={!draft.recommended_action.trim() || !draft.student_message.trim() || assigning}
                className="min-h-11 rounded-xl bg-[var(--eb-text)] px-5 font-semibold text-[var(--eb-ink)] disabled:opacity-40">
                {assigning ? "Sending…" : `Send to ${first}`}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
