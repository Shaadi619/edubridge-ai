import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";

import type { SourceCitation } from "../../lib/api";
import {
  citationLocation,
  createCitationLink,
  loadCitationExcerpt,
  type CitationExcerpt,
} from "../../lib/citations";
import { highlightQuote } from "../../lib/evidenceHighlight";
import { useScopedRequest } from "../useScopedRequest";

export type StageCitation = {
  key: string;
  citation: SourceCitation;
  /** Text of the answer that cited this source, used to pick which lines to light. */
  answerText: string;
  /** Exact verified quote from this source, lit as-is when present. */
  quote?: string | null;
};

type ExcerptStatus = "idle" | "loading" | { error: string } | CitationExcerpt;
type LinkStatus = "loading" | "unavailable" | Awaited<ReturnType<typeof createCitationLink>>;

const MOTES = [
  { left: "38%", top: "58%", size: 3, duration: "9s", delay: "0s" },
  { left: "47%", top: "40%", size: 2, duration: "11s", delay: "1.5s" },
  { left: "55%", top: "62%", size: 2, duration: "8s", delay: "3s" },
  { left: "61%", top: "35%", size: 3, duration: "12s", delay: "0.8s" },
  { left: "43%", top: "28%", size: 2, duration: "10s", delay: "4s" },
  { left: "66%", top: "52%", size: 2, duration: "9.5s", delay: "2.2s" },
  { left: "33%", top: "44%", size: 2, duration: "13s", delay: "5s" },
  { left: "52%", top: "20%", size: 3, duration: "10.5s", delay: "6s" },
];

function frameLabel(citation: SourceCitation) {
  return citationLocation(citation.source_kind, citation.page_number) ?? "Excerpt";
}

/** Slide bullets arrive inline ("a • b • c"); give each its own line. */
function asLines(text: string) {
  return text.replace(/\s*[•▪●]\s*/g, "\n• ").replace(/^\n/, "");
}

function shortTitle(title: string) {
  return title.replace(/\.(pdf|pptx?|docx?)$/i, "");
}

export default function SourceStage({ courseId, items, activeKey, onPick, hoverKey, searching, hasAnswerWithoutSource, emptyMessage, stripCaption, idleCaption, emptyHint }: {
  courseId: string;
  items: StageCitation[];
  activeKey: string | null;
  onPick: (key: string) => void;
  hoverKey: string | null;
  searching: boolean;
  hasAnswerWithoutSource: boolean;
  emptyMessage?: string;
  stripCaption?: string;
  /** Line under "Course source" before anything is cited. */
  idleCaption?: string;
  /** Second line of the empty state. */
  emptyHint?: string;
}) {
  const active = items.find(item => item.key === activeKey) ?? null;
  const [excerpt, setExcerpt] = useState<ExcerptStatus>("idle");
  const [link, setLink] = useState<LinkStatus>("loading");
  const [retryCount, setRetryCount] = useState(0);
  const startLinkRequest = useScopedRequest(active ? `${courseId}:${active.key}` : null);

  const loadLink = useCallback(async (source: CitationExcerpt) => {
    const request = startLinkRequest(false);
    if (!request) return;
    setLink("loading");
    try {
      const next = await createCitationLink(source);
      if (request.isCurrent()) setLink(next);
    } catch {
      if (request.isCurrent()) setLink("unavailable");
    } finally {
      request.finish();
    }
  }, [startLinkRequest]);

  useEffect(() => {
    if (!active) {
      setExcerpt("idle");
      return;
    }
    const controller = new AbortController();
    setExcerpt("loading");
    void loadCitationExcerpt(courseId, active.key, controller.signal).then(source => {
      if (controller.signal.aborted) return;
      setExcerpt(source);
      void loadLink(source);
    }).catch(error => {
      if (!controller.signal.aborted) setExcerpt({
        error: error instanceof Error ? error.message : "This excerpt is unavailable.",
      });
    });
    return () => controller.abort();
  }, [courseId, active?.key, retryCount, loadLink]);

  const spans = useMemo(() => (
    excerpt !== "idle" && excerpt !== "loading" && !("error" in excerpt) && active
      ? highlightQuote(excerpt.content, active.quote, active.answerText)
      : []
  ), [excerpt, active]);
  const hasLit = spans.some(span => span.lit);
  const glowing = hoverKey !== null && hoverKey === activeKey;
  const location = active ? frameLabel(active.citation) : null;

  return (
    <div className={`eb-source flex h-full min-h-0 w-full flex-col gap-5 px-6 py-6 sm:px-8 sm:py-7${searching ? " is-searching" : ""}${!active ? " is-quiet" : ""}`}>
      <div aria-hidden="true" className="eb-beam" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {MOTES.map((mote, index) => (
          <span key={index} className="eb-mote" style={{
            left: mote.left, top: mote.top, width: mote.size, height: mote.size,
            animationDuration: mote.duration, animationDelay: mote.delay,
          }} />
        ))}
      </div>

      <div className="relative z-[1] flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{active ? shortTitle(active.citation.document_title) : "Course source"}</span>
          <span className="text-[13px] text-[var(--eb-text-muted)]">
            {active ? (location ?? "Course excerpt") : (idleCaption ?? "The page behind each answer appears here")}
          </span>
        </div>
        {active && excerpt !== "idle" && excerpt !== "loading" && !("error" in excerpt) && (
          link === "loading" ? (
            <span role="status" className="text-sm text-[var(--eb-text-muted)]">Preparing the original…</span>
          ) : link === "unavailable" ? (
            excerpt.path
              ? <button type="button" onClick={() => void loadLink(excerpt)} className="min-h-11 text-sm text-[var(--eb-text-soft)] underline underline-offset-4">Retry original file</button>
              : <span className="text-sm text-[var(--eb-text-muted)]">Original file unavailable</span>
          ) : (
            <a href={link.href} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--eb-text-soft)] underline underline-offset-4 hover:text-[var(--eb-light)]"
              onClick={event => {
                if (Date.now() >= link.expiresAt) {
                  event.preventDefault();
                  void loadLink(excerpt);
                }
              }}
            >
              Open original<ArrowUpRight size={14} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )
        )}
      </div>

      <article
        key={active?.key ?? "empty"}
        aria-label={active ? `Excerpt from ${shortTitle(active.citation.document_title)}${location ? `, ${location}` : ""}` : "No excerpt selected"}
        tabIndex={active ? 0 : -1}
        className="eb-paper relative z-[1] min-h-[260px] flex-1 overflow-y-auto px-7 py-8 sm:px-10 sm:py-9"
      >
        {!active && (
          <div className="flex h-full flex-col justify-center gap-3 text-[var(--eb-ink-muted)]">
            <p className="eb-serif m-0 text-[19px] leading-relaxed text-[var(--eb-ink)]">
              {emptyMessage ?? (hasAnswerWithoutSource
                ? "No passage supported the last answer, so nothing is lit."
                : "Ask a question and the page your answer comes from will appear here.")}
            </p>
            <p className="m-0 text-[15px]">{emptyHint ?? "The exact lines the answer used are lit, so you can check it against your course."}</p>
          </div>
        )}
        {active && excerpt === "loading" && (
          <div role="status" className="flex flex-col gap-4" aria-label="Loading course excerpt">
            {["72%", "90%", "84%", "66%", "78%"].map((width, index) => (
              <span key={index} aria-hidden="true" className="block h-2.5 animate-pulse rounded-sm bg-[rgba(30,42,54,0.13)] motion-reduce:animate-none" style={{ width }} />
            ))}
          </div>
        )}
        {active && excerpt !== "idle" && excerpt !== "loading" && "error" in excerpt && (
          <div className="flex flex-col gap-3">
            <p role="alert" className="m-0 text-[15px] text-[var(--eb-ink)]">{excerpt.error}</p>
            <button type="button" onClick={() => setRetryCount(count => count + 1)}
              className="min-h-11 self-start rounded-lg border border-[rgba(30,42,54,0.3)] px-4 font-semibold text-[var(--eb-ink)]">
              Try again
            </button>
          </div>
        )}
        {active && spans.length > 0 && (
          <>
            <span className="text-[13px] text-[var(--eb-ink-faint)]">
              {hasLit
                ? (active.quote && spans.some(span => span.lit && span.text === active.quote?.replace(/\s+/g, " ").trim())
                  ? "Lit: the exact line this answer was checked against"
                  : "Lit lines share the most wording with the answer")
                : "Retrieved excerpt"}
            </span>
            <p className="eb-serif m-0 mt-3 whitespace-pre-line text-[18px] leading-[1.75] text-[var(--eb-ink-muted)]">
              {spans.map((span, index) => (
                <span key={index}>
                  {span.lit
                    ? <mark className={`eb-lit${glowing ? " is-hovered" : ""}`}>{asLines(span.text)}</mark>
                    : asLines(span.text)}
                  {index < spans.length - 1 ? " " : ""}
                </span>
              ))}
            </p>
          </>
        )}
      </article>

      {(items.length > 0 || searching) && (
        <div className="relative z-[1] flex flex-col gap-2.5">
          <span className="text-sm text-[var(--eb-text-muted)]">
            {searching ? "Searching your course material" : (stripCaption ?? "Pages this conversation cites")}
          </span>
          <div role="group" aria-label="Cited pages" className="flex gap-3.5 overflow-x-auto pb-1">
            {items.map((item, index) => {
              const on = item.key === activeKey && !searching;
              return (
                <button key={item.key} type="button" onClick={() => onPick(item.key)} aria-pressed={on}
                  aria-label={`Show ${frameLabel(item.citation)} of ${shortTitle(item.citation.document_title)}`}
                  className="flex shrink-0 flex-col items-start gap-2 text-left"
                >
                  <span aria-hidden="true" className="eb-frame block h-[72px] w-[104px] rounded-[3px] bg-[var(--eb-paper)] px-3 py-2.5"
                    style={{
                      animationDelay: `${index * 0.3}s`,
                      opacity: on || searching ? 1 : 0.62,
                      transform: on ? "translateY(-3px)" : undefined,
                      boxShadow: on ? "0 0 0 2px var(--eb-light), 0 0 28px var(--eb-light-glow)" : undefined,
                    }}
                  >
                    <span className="mb-1.5 block h-1 w-[70%] rounded-[1px] bg-[rgba(30,42,54,0.18)]" />
                    <span className="mb-1.5 block h-1 w-[88%] rounded-[1px] bg-[rgba(30,42,54,0.12)]" />
                    <span className="mb-1.5 block h-1.5 w-[92%] rounded-[1px]" style={{ background: on ? "rgba(240,185,74,0.9)" : "rgba(240,185,74,0.45)" }} />
                    <span className="block h-1 w-[60%] rounded-[1px] bg-[rgba(30,42,54,0.12)]" />
                  </span>
                  <span className={`max-w-[104px] truncate text-[13px] ${on ? "font-semibold text-[var(--eb-text)]" : "text-[var(--eb-text-muted)]"}`}>
                    {frameLabel(item.citation)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
