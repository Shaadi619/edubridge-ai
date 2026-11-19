import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, Sparkles, Volume2, X } from "lucide-react";

import type { ExplanationFormat, SourceCitation } from "../../lib/api";
import { citationLocation } from "../../lib/citations";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import type { AiMessage, Announcement, ChatMessage, HistoryStatus, StudentCourse } from "./chatTypes";
import { renderText } from "./renderText";
import SourceStage, { type StageCitation } from "./SourceStage";

const FORMATS: Array<[ExplanationFormat, string]> = [
  ["simpler", "Simpler"],
  ["analogy", "Use an analogy"],
  ["worked_example", "Worked example"],
  ["visual_outline", "Visual outline"],
];

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function sourceCitations(message: ChatMessage): SourceCitation[] {
  if (message.role !== "ai") return [];
  return message.citations.filter((citation): citation is SourceCitation & { chunk_id: string } =>
    typeof citation !== "string" && Boolean(citation.chunk_id));
}

export default function AskWorkspace({ messages, isTyping, tutorStatus, historyStatus, onRetryHistory, input, setInput, onSend, onExplain, announcements, course }: {
  messages: ChatMessage[]; isTyping: boolean; tutorStatus: string; input: string;
  historyStatus: HistoryStatus; onRetryHistory: () => void;
  setInput: (v: string) => void; onSend: () => void;
  onExplain: (messageIndex: number, format: ExplanationFormat) => void;
  announcements: Announcement[]; course: StudentCourse;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [formatMenu, setFormatMenu] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [messages, isTyping, reducedMotion]);

  // Every cited source in this conversation, once each, in the order it was first cited.
  const stageItems = useMemo(() => {
    const seen = new Map<string, StageCitation>();
    messages.forEach(message => {
      sourceCitations(message).forEach(citation => {
        const key = citation.chunk_id as string;
        if (!seen.has(key)) seen.set(key, { key, citation, answerText: message.text });
      });
    });
    return [...seen.values()];
  }, [messages]);

  // Follow the newest answer: show its first source, or nothing if it had none.
  const latestAiIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].role === "ai") return index;
    return -1;
  }, [messages]);
  const latestSources = latestAiIndex >= 0 ? sourceCitations(messages[latestAiIndex]) : [];
  const latestFirstKey = latestSources[0]?.chunk_id ?? null;
  useEffect(() => { setActiveKey(latestFirstKey); }, [latestAiIndex, latestFirstKey]);
  useEffect(() => { setActiveKey(null); setHoverKey(null); setSheetOpen(false); }, [course.id]);

  const pick = (key: string) => {
    setActiveKey(key);
    if (!isDesktop) setSheetOpen(true);
  };

  const listen = (text: string) => {
    if (!("speechSynthesis" in window)) {
      toast.error("Audio playback is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.rate = 0.95;
    window.speechSynthesis.speak(speech);
  };

  const canSend = Boolean(input.trim()) && !isTyping && historyStatus === "ready";
  const pinned = announcements.filter(a => a.pinned && !dismissedIds.includes(a.id));
  const empty = historyStatus === "ready" && messages.length === 0 && !isTyping;

  const stage = (
    <SourceStage
      courseId={course.id}
      items={stageItems}
      activeKey={activeKey}
      onPick={pick}
      hoverKey={hoverKey}
      searching={isTyping}
      hasAnswerWithoutSource={latestAiIndex >= 0 && latestSources.length === 0}
    />
  );

  return (
    <div className="eb-stage grid h-[calc(100vh-3.5rem)] min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(400px,44%)]">
      <section aria-label="Conversation" className="flex min-h-0 flex-col">
        {pinned.map(a => (
          <div key={a.id} className="flex items-start gap-3 border-b border-[rgba(240,185,74,0.25)] bg-[rgba(240,185,74,0.08)] px-6 py-3">
            <div className="min-w-0 flex-1 text-sm">
              <span className="font-semibold text-[var(--eb-text)]">{a.title}</span>
              <span className="ml-2 text-[var(--eb-text-soft)]">{a.body.slice(0, 120)}{a.body.length > 120 ? "…" : ""}</span>
            </div>
            <button type="button" aria-label={`Dismiss announcement: ${a.title}`} onClick={() => setDismissedIds(p => [...p, a.id])}
              className="-m-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--eb-text-muted)] hover:text-[var(--eb-text)]">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ))}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10">
          <div role="log" aria-label="Messages" className="mx-auto flex max-w-[680px] flex-col gap-7">
            {historyStatus === "loading" && <p role="status" className="m-0 text-sm text-[var(--eb-text-muted)]">Restoring your conversation…</p>}
            {historyStatus === "error" && (
              <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-[var(--eb-text-soft)]">
                <span>Could not restore your conversation.</span>
                <button type="button" onClick={onRetryHistory} className="min-h-10 rounded-lg border border-[var(--eb-line)] px-3 font-medium text-[var(--eb-text)] hover:bg-[var(--eb-raised)]">Try again</button>
              </div>
            )}
            {empty && (
              <div className="flex flex-col gap-2 pt-6">
                <h2 className="m-0 text-[26px] font-semibold tracking-[-0.015em]">Ask about {course.name}</h2>
                <p className="m-0 max-w-[56ch] text-[15px] text-[var(--eb-text-muted)]">
                  Answers come only from your course material. {isDesktop ? "The passage behind each answer lights up on the right." : "Tap a page under an answer to see the passage behind it."}
                </p>
              </div>
            )}

            {messages.map((msg, i) => {
              if (msg.role === "user") {
                return (
                  <div key={i} className="max-w-[80%] self-end whitespace-pre-wrap break-words rounded-[14px] border border-[var(--eb-student-line)] bg-[var(--eb-raised-2)] px-4 py-2.5 text-[15px] text-[var(--eb-student-text)]">
                    {msg.text}
                  </div>
                );
              }
              const ai = msg as AiMessage;
              const isLatest = i === latestAiIndex;
              return (
                <article key={i} aria-label="Tutor answer" className={`flex flex-col gap-3${isLatest ? " eb-rise" : ""}`}>
                  {ai.formatLabel && <span className="text-sm font-medium text-[var(--eb-light)]">{ai.formatLabel}</span>}
                  <div className="break-words text-[16.5px] leading-[1.7] text-[var(--eb-text-soft)] [&_strong]:font-semibold [&_strong]:text-[var(--eb-text)]">
                    {renderText(ai.text)}
                  </div>
                  {ai.misconception && (
                    <div className="rounded-xl border border-[var(--eb-student-line)] bg-[rgba(95,184,174,0.08)] px-4 py-3 text-[15px] text-[var(--eb-text-soft)]">
                      <span className="font-semibold text-[var(--eb-student-text)]">Helpful distinction: </span>{ai.misconception}
                    </div>
                  )}
                  {ai.citations.length > 0 && (
                    <div role="group" aria-label="Sources for this answer" className="flex flex-wrap gap-2">
                      {ai.citations.map((citation, index) => {
                        if (typeof citation === "string" || !citation.chunk_id) {
                          const title = typeof citation === "string" ? citation : citation.document_title;
                          return <span key={index} className="rounded-md border border-[var(--eb-line-soft)] px-2.5 py-1.5 text-[13px] text-[var(--eb-text-muted)]">{title}</span>;
                        }
                        const key = citation.chunk_id;
                        const on = key === activeKey;
                        const location = citationLocation(citation.source_kind, citation.page_number);
                        const title = citation.document_title.replace(/\.(pdf|pptx?|docx?)$/i, "");
                        return (
                          <button key={index} type="button" onClick={() => pick(key)} aria-pressed={on}
                            aria-label={`Show ${location ?? "the excerpt"} of ${title}`}
                            onMouseEnter={() => setHoverKey(key)} onMouseLeave={() => setHoverKey(null)}
                            onFocus={() => setHoverKey(key)} onBlur={() => setHoverKey(null)}
                            className={`min-h-9 rounded-md border px-3 text-[13px] transition-colors duration-200 ${on
                              ? "border-[var(--eb-light)] bg-[var(--eb-light)] font-semibold text-[var(--eb-ink)] shadow-[0_0_18px_var(--eb-light-glow)]"
                              : "border-[#3A4757] text-[var(--eb-text-soft)] hover:border-[var(--eb-light)] hover:text-[var(--eb-text)]"}`}
                          >
                            {location ?? title}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {ai.question && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button type="button" onClick={() => setFormatMenu(current => current === i ? null : i)} disabled={isTyping}
                        aria-expanded={formatMenu === i}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--eb-line)] px-3.5 text-sm text-[var(--eb-text-soft)] hover:border-[var(--eb-text-muted)] hover:text-[var(--eb-text)] disabled:opacity-40">
                        <Sparkles size={15} aria-hidden="true" />Explain another way
                      </button>
                      <button type="button" onClick={() => listen(ai.text)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--eb-line)] px-3.5 text-sm text-[var(--eb-text-soft)] hover:border-[var(--eb-text-muted)] hover:text-[var(--eb-text)]">
                        <Volume2 size={15} aria-hidden="true" />Listen
                      </button>
                      {formatMenu === i && (
                        <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] p-2.5">
                          {FORMATS.map(([format, label]) => (
                            <button key={format} type="button" onClick={() => { setFormatMenu(null); onExplain(i, format); }}
                              className="min-h-10 rounded-lg bg-[var(--eb-raised)] px-3 text-sm text-[var(--eb-text)] hover:bg-[var(--eb-text)] hover:text-[var(--eb-ink)]">
                              {label}
                            </button>
                          ))}
                          <span className="ml-auto text-[13px] text-[var(--eb-text-muted)]">Made only when you pick one</span>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}

            {isTyping && (
              <div role="status" className="flex max-w-[360px] flex-col gap-2.5">
                <span className="text-[15px] text-[var(--eb-text-soft)]">{tutorStatus || "Looking through your course material"}</span>
                <span aria-hidden="true" className="relative block h-[3px] overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
                  <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-light),transparent)]" />
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <form className="border-t border-[var(--eb-line-soft)] px-5 pb-4 pt-4 sm:px-10"
          onSubmit={event => { event.preventDefault(); if (canSend) onSend(); }}>
          <div className="mx-auto flex max-w-[680px] gap-2.5">
            <label htmlFor="ask-input" className="sr-only">Ask a question about {course.name}</label>
            <input id="ask-input" value={input} onChange={e => setInput(e.target.value)} autoComplete="off"
              placeholder={`Ask about ${course.name}`}
              className="min-h-[52px] min-w-0 flex-1 rounded-xl border border-[var(--eb-line)] bg-[#18222D] px-4 text-base text-[var(--eb-text)] outline-none focus:border-[var(--eb-text-muted)]" />
            <button type="submit" disabled={!canSend} aria-label="Send question"
              className="flex min-h-[52px] w-[52px] items-center justify-center rounded-xl bg-[var(--eb-text)] text-[var(--eb-ink)] transition-opacity disabled:opacity-35">
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="mx-auto mb-0 mt-2 max-w-[680px] text-[13px] text-[var(--eb-text-muted)]">Answers come only from your course material.</p>
        </form>
      </section>

      {isDesktop ? (
        <aside aria-label="Course source" className="min-h-0 border-l border-[#26313D]">{stage}</aside>
      ) : (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="eb-stage h-[85dvh] gap-0 border-0 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Course source</SheetTitle>
              <SheetDescription>The passage behind this answer</SheetDescription>
            </SheetHeader>
            {stage}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
