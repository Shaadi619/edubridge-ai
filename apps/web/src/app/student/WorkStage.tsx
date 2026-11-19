import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FileText, Upload } from "lucide-react";

import { api, type SourceCitation, type WorkAnalysis, type WorkSubmission } from "../../lib/api";
import SourceStage, { type StageCitation } from "./SourceStage";

const WRONG = "#E8907F";
const ACCEPTED: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
const MAX_BYTES = 8 * 1024 * 1024;

type Step = WorkAnalysis["steps"][number];

const STATUS: Record<Step["status"], { label: string; color: string }> = {
  correct: { label: "Holds up", color: "var(--eb-text-muted)" },
  needs_revision: { label: "Needs another look", color: WRONG },
  unclear: { label: "Couldn’t read this clearly", color: "var(--eb-text-muted)" },
};

function citationKey(submissionId: string, citation: SourceCitation) {
  return `${submissionId}:${citation.chunk_id}`;
}

function when(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `Today, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

function reviewNote(status: WorkSubmission["review_status"]) {
  if (status === "pending") return "Your teacher will look at this before it counts towards your progress.";
  if (status === "approved") return "Your teacher agreed this is worth working on.";
  if (status === "dismissed") return "Your teacher decided this isn’t a problem.";
  return "This is a suggestion only. It doesn’t change your progress.";
}

export default function WorkStage({ courseId, courseName, accessToken }: {
  courseId: string; courseName: string; accessToken: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState("");
  const [context, setContext] = useState("");
  const [dragging, setDragging] = useState(false);
  const [submissions, setSubmissions] = useState<WorkSubmission[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoadingHistory(true); setHistoryError(null);
    setFile(null); setFileType(""); setContext(""); setSelectedId(null); setActiveKey(null);
    api.workSubmissions(courseId, accessToken)
      .then(rows => { if (current) setSubmissions(rows); })
      .catch(error => { if (current) setHistoryError(error instanceof Error ? error.message : "Your earlier work couldn’t be loaded."); })
      .finally(() => { if (current) setLoadingHistory(false); });
    return () => { current = false; };
  }, [accessToken, courseId]);

  const selected = submissions.find(item => item.id === selectedId) ?? submissions[0] ?? null;
  const analysis = selected?.status === "analyzed" ? selected.analysis : null;

  const stageItems = useMemo<StageCitation[]>(() => {
    if (!selected || !analysis) return [];
    const seen = new Map<string, StageCitation>();
    const add = (citation: SourceCitation, answerText: string) => {
      if (!citation.chunk_id) return;
      const key = citationKey(selected.id, citation);
      if (!seen.has(key)) seen.set(key, { key, citation, answerText, quote: citation.quote });
    };
    analysis.steps.forEach(step => step.citations.forEach(citation => add(citation, step.feedback)));
    analysis.citations.forEach(citation => add(citation, analysis.summary));
    return [...seen.values()];
  }, [selected, analysis]);

  const shownKey = stageItems.some(item => item.key === activeKey) ? activeKey : stageItems[0]?.key ?? null;

  const chooseFile = (picked?: File) => {
    if (!picked) return;
    const type = picked.type || ACCEPTED[picked.name.toLowerCase().split(".").pop() ?? ""];
    if (!type || !Object.values(ACCEPTED).includes(type)) { toast.error("Choose a JPG, PNG, WebP or PDF file."); return; }
    if (picked.size > MAX_BYTES) { toast.error("The file must be 8 MB or smaller."); return; }
    setFile(picked); setFileType(type);
  };

  const submit = async () => {
    if (!file || context.trim().length < 3 || analyzing) return;
    setAnalyzing(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("That file couldn’t be read. Try choosing it again."));
        reader.readAsDataURL(file);
      });
      const result = await api.analyzeWork(courseId, {
        filename: file.name, mime_type: fileType, data_base64: dataUrl.split(",")[1] ?? "", context: context.trim(),
      }, accessToken);
      setSubmissions(current => [result, ...current.filter(item => item.id !== result.id)]);
      setSelectedId(result.id); setActiveKey(null);
      setFile(null); setFileType(""); setContext("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your work couldn’t be checked. Try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const ready = Boolean(file) && context.trim().length >= 3 && !analyzing;
  const primaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--eb-text)] px-6 font-semibold text-[var(--eb-ink)] transition-opacity disabled:opacity-40";

  return (
    <div className="eb-stage grid min-h-[calc(100vh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(380px,42%)]">
      <section aria-label="Your work" className="flex min-w-0 flex-col gap-8 px-5 py-8 sm:px-10">
        <div className="flex max-w-[640px] flex-col gap-2">
          <h2 className="m-0 text-[28px] font-semibold leading-tight tracking-[-0.02em]">Show your work</h2>
          <p className="m-0 text-[16px] leading-relaxed text-[var(--eb-text-soft)]">
            Upload a photo or PDF of your working for {courseName}. Each step is checked against your course material, and any correction points to the line in your notes it relies on.
          </p>
        </div>

        <form className="flex max-w-[680px] flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <button type="button" onClick={() => fileInputRef.current?.click()}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]); }}
            className="flex min-h-[96px] items-center gap-4 rounded-xl border border-dashed px-5 py-4 text-left transition-colors"
            style={{
              borderColor: file ? "var(--eb-student)" : dragging ? "var(--eb-text-muted)" : "var(--eb-line)",
              background: file ? "rgba(95,184,174,0.08)" : dragging ? "var(--eb-raised-2)" : "transparent",
            }}
          >
            {file ? <FileText size={22} aria-hidden="true" className="shrink-0 text-[var(--eb-student)]" /> : <Upload size={22} aria-hidden="true" className="shrink-0 text-[var(--eb-text-muted)]" />}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-semibold" style={{ color: file ? "var(--eb-student-text)" : undefined }}>{file ? file.name : "Choose your work, or drop it here"}</span>
              <span className="text-sm text-[var(--eb-text-muted)]">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB. Choose again to replace it.` : "JPG, PNG, WebP or a PDF with selectable text, up to 8 MB"}</span>
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={event => chooseFile(event.target.files?.[0])} />

          <label className="flex flex-col gap-2">
            <span className="font-semibold">What are you working on?</span>
            <textarea value={context} onChange={event => setContext(event.target.value)} maxLength={2000} rows={3}
              placeholder="For example: solving question 4 on the worksheet using the quadratic formula"
              className="w-full resize-none rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-4 py-3 text-[15px] leading-relaxed text-[var(--eb-student-text)] focus:border-[var(--eb-student)] focus:outline-none" />
            <span className="text-sm text-[var(--eb-text-muted)]">This helps find the right pages in your course. You don’t need to include the answer.</span>
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={!ready} className={primaryButton}>{analyzing ? "Checking your steps…" : "Check my work"}</button>
            <span className="text-sm text-[var(--eb-text-muted)]">Any learning gap it suggests is reviewed by your teacher before it counts.</span>
          </div>
          {analyzing && (
            <span role="status" className="flex flex-col gap-2 text-[15px] text-[var(--eb-text-soft)]">
              Reading your steps and finding the pages they rely on. This can take up to a minute.
              <span aria-hidden="true" className="relative block h-[3px] max-w-[360px] overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
                <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-light),transparent)]" />
              </span>
            </span>
          )}
        </form>

        {loadingHistory && <p role="status" className="m-0 text-[15px] text-[var(--eb-text-muted)]">Loading your earlier work…</p>}
        {historyError && <p role="alert" className="m-0 max-w-[680px] rounded-xl border border-[rgba(232,144,127,0.4)] bg-[rgba(232,144,127,0.08)] px-4 py-3">{historyError}</p>}

        {selected && (
          <article key={selected.id} aria-label={`Feedback on ${selected.filename}`} className="eb-rise flex max-w-[680px] flex-col gap-6 border-t border-[var(--eb-line-soft)] pt-8">
            <header className="flex flex-col gap-1">
              <span className="text-sm text-[var(--eb-text-muted)]">{when(selected.created_at)}</span>
              <h3 className="m-0 text-[20px] font-semibold leading-snug">{selected.filename}</h3>
              <p className="m-0 text-[15px] leading-relaxed text-[var(--eb-student-text)]">{selected.context}</p>
            </header>

            {selected.status === "analyzing" && <p role="status" className="m-0 text-[15px] text-[var(--eb-text-soft)]">Still being checked. Come back in a minute.</p>}
            {selected.status === "failed" && (
              <p role="alert" className="m-0 rounded-xl border border-[rgba(232,144,127,0.4)] bg-[rgba(232,144,127,0.08)] px-4 py-3">
                {selected.processing_error ?? "This one couldn’t be checked."} Try uploading it again.
              </p>
            )}

            {analysis && (
              <>
                <div className="flex flex-col gap-3">
                  <p className="m-0 text-[17px] leading-[1.65]">{analysis.summary}</p>
                  {analysis.strengths.length > 0 && (
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px] text-[var(--eb-text-soft)]">
                      {analysis.strengths.map(strength => (
                        <li key={strength} className="flex gap-2"><Check size={16} aria-hidden="true" className="mt-1 shrink-0 text-[var(--eb-text-muted)]" />{strength}</li>
                      ))}
                    </ul>
                  )}
                  {!analysis.grounded && (
                    <p className="m-0 text-sm text-[var(--eb-text-muted)]">None of this feedback could be matched to a line in your course material, so treat it as a second opinion and check with your teacher.</p>
                  )}
                </div>

                <ol aria-label="Your steps" className="m-0 flex list-none flex-col p-0">
                  {analysis.steps.map((step, index) => {
                    const status = STATUS[step.status];
                    const unbacked = step.status === "needs_revision" && step.grounded === false;
                    const sources = step.citations.filter(citation => citation.chunk_id);
                    return (
                      <li key={step.step_number} className="relative flex gap-4 pb-6 last:pb-0">
                        {index < analysis.steps.length - 1 && <span aria-hidden="true" className="absolute left-[13px] top-8 bottom-1 w-px bg-[var(--eb-line-soft)]" />}
                        <span aria-hidden="true" className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold"
                          style={{ borderColor: status.color, color: status.color }}>
                          {step.step_number}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                          <span className="text-sm font-medium" style={{ color: status.color }}>Step {step.step_number}: {status.label}</span>
                          <p className="m-0 border-l-2 border-[var(--eb-student-line)] pl-3 text-[15px] leading-relaxed text-[var(--eb-student-text)]">{step.observed_reasoning}</p>
                          <p className="m-0 text-[16px] leading-[1.65] text-[var(--eb-text-soft)]">{step.feedback}</p>
                          {unbacked && <p className="m-0 text-sm text-[var(--eb-text-muted)]">This correction couldn’t be matched to your course material. Check it with your teacher before relying on it.</p>}
                          {sources.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {sources.map(citation => {
                                const key = citationKey(selected.id, citation);
                                const lit = key === shownKey;
                                return (
                                  <button key={key} type="button" aria-pressed={lit} onClick={() => setActiveKey(key)}
                                    className="min-h-9 rounded-lg border px-3 text-sm transition-colors"
                                    style={lit
                                      ? { borderColor: "var(--eb-light)", color: "var(--eb-text)", background: "rgba(240,185,74,0.10)" }
                                      : { borderColor: "var(--eb-line)", color: "var(--eb-text-soft)" }}>
                                    {citation.document_title.replace(/\.(pdf|pptx?|docx?)$/i, "")}{citation.page_number ? `, ${citation.source_kind === "slide" ? "slide" : "page"} ${citation.page_number}` : ""}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {analysis.misconception.detected && (
                  <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-4 py-3">
                    <span className="font-semibold">Possible gap: {analysis.misconception.concept || analysis.misconception.label}</span>
                    {analysis.misconception.explanation && <p className="m-0 text-[15px] leading-relaxed text-[var(--eb-text-soft)]">{analysis.misconception.explanation}</p>}
                    <span className="text-sm text-[var(--eb-text-muted)]">{reviewNote(selected.review_status)}</span>
                  </div>
                )}

                <p className="m-0 text-[16px] leading-relaxed"><span className="font-semibold">Next: </span>{analysis.next_step}</p>
              </>
            )}
          </article>
        )}

        {submissions.length > 1 && (
          <nav aria-label="Earlier work" className="flex max-w-[680px] flex-col gap-2">
            <span className="text-sm text-[var(--eb-text-muted)]">Earlier work</span>
            <ul className="m-0 flex list-none flex-col p-0">
              {submissions.map(item => {
                const current = item.id === selected?.id;
                return (
                  <li key={item.id}>
                    <button type="button" aria-current={current ? "true" : undefined} onClick={() => { setSelectedId(item.id); setActiveKey(null); }}
                      className="flex min-h-11 w-full items-center justify-between gap-4 border-b border-[var(--eb-line-soft)] py-2 text-left text-[15px] transition-colors hover:text-[var(--eb-text)]"
                      style={{ color: current ? "var(--eb-text)" : "var(--eb-text-soft)", fontWeight: current ? 600 : 400 }}>
                      <span className="truncate">{item.filename}</span>
                      <span className="shrink-0 text-sm font-normal text-[var(--eb-text-muted)]">
                        {item.status === "failed" ? "Couldn’t be checked" : item.status === "analyzing" ? "Being checked" : when(item.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {!loadingHistory && !historyError && submissions.length === 0 && (
          <p className="m-0 max-w-[60ch] text-[15px] text-[var(--eb-text-muted)]">Nothing checked yet. Your first upload and its feedback will appear here.</p>
        )}
      </section>

      <aside aria-label="Course source"
        className={`min-h-[420px] border-t border-[#26313D] lg:block lg:border-l lg:border-t-0 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:self-start ${stageItems.length ? "" : "hidden"}`}>
        <SourceStage
          courseId={courseId}
          items={stageItems}
          activeKey={shownKey}
          onPick={setActiveKey}
          hoverKey={null}
          searching={analyzing}
          hasAnswerWithoutSource={Boolean(analysis) && stageItems.length === 0}
          emptyMessage={analysis
            ? "None of this feedback was matched to a passage you can open."
            : "When a step needs fixing, the line in your notes it relies on appears here."}
          stripCaption="Pages this feedback relies on"
          idleCaption="The page behind each correction appears here"
          emptyHint="The exact line is lit, so you can check the feedback against your course."
        />
      </aside>
    </div>
  );
}
