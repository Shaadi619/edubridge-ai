import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, FileText } from "lucide-react";

import type { SourceCitation } from "../../lib/api";
import {
  citationLocation,
  createCitationLink,
  loadCitationExcerpt,
  type CitationExcerpt,
} from "../../lib/citations";
import { useScopedRequest } from "../useScopedRequest";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

const citationStyle = "flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-left text-xs text-foreground";
const actionStyle = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function CitationPreview({ courseId, citation, darkMode }: {
  courseId: string;
  citation: SourceCitation | string;
  darkMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const title = typeof citation === "string" ? citation : citation.document_title;
  const chunkId = typeof citation === "string" ? undefined : citation.chunk_id;
  const location = typeof citation === "string" ? null : citationLocation(citation.source_kind, citation.page_number);
  const label = (
    <>
      <FileText size={14} aria-hidden="true" className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1 break-words font-medium">{title}</span>
      {location && <span className="shrink-0 text-muted-foreground">{location}</span>}
    </>
  );

  if (!chunkId) return <div className={citationStyle}>{label}</div>;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={`${citationStyle} min-h-10 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}>
          {label}
        </button>
      </DialogTrigger>
      <DialogContent
        className={`${darkMode ? "dark " : ""}max-h-[calc(100dvh-2rem)] overflow-y-auto text-foreground motion-reduce:animate-none`}
        onKeyDown={event => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <DialogHeader className="pr-7 text-left">
          <DialogTitle className="break-words leading-snug">{title}</DialogTitle>
          <DialogDescription>{location ? `Course excerpt · ${location}` : "Course excerpt"}</DialogDescription>
        </DialogHeader>
        {open && <CitationExcerptPanel key={`${courseId}:${chunkId}`} courseId={courseId} chunkId={chunkId} />}
      </DialogContent>
    </Dialog>
  );
}

type ExcerptStatus = "loading" | { error: string } | CitationExcerpt;
type LinkStatus = "loading" | "unavailable" | Awaited<ReturnType<typeof createCitationLink>>;

function CitationExcerptPanel({ courseId, chunkId }: { courseId: string; chunkId: string }) {
  const [excerpt, setExcerpt] = useState<ExcerptStatus>("loading");
  const [link, setLink] = useState<LinkStatus>("loading");
  const [retryCount, setRetryCount] = useState(0);
  const startLinkRequest = useScopedRequest(`${courseId}:${chunkId}`);

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
    const controller = new AbortController();
    void loadCitationExcerpt(courseId, chunkId, controller.signal).then(source => {
      if (controller.signal.aborted) return;
      setExcerpt(source);
      void loadLink(source);
    }).catch(error => {
      if (!controller.signal.aborted) setExcerpt({
        error: error instanceof Error ? error.message : "This excerpt is unavailable.",
      });
    });
    return () => controller.abort();
  }, [courseId, chunkId, retryCount, loadLink]);

  if (excerpt === "loading") {
    return <p role="status" className="text-sm text-muted-foreground">Loading course excerpt…</p>;
  }
  if ("error" in excerpt) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-muted-foreground">{excerpt.error}</p>
        <button type="button" className={actionStyle} onClick={() => {
          setExcerpt("loading");
          setRetryCount(count => count + 1);
        }}>Try again</button>
      </div>
    );
  }

  const location = citationLocation(excerpt.kind, excerpt.pageNumber);
  return (
    <>
      <blockquote tabIndex={0} aria-label="Retrieved source text" className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/50 p-4 text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{excerpt.content}</blockquote>
      <div className="min-h-10">
        {link === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">Preparing the source link…</p>
        ) : link === "unavailable" ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="text-sm text-muted-foreground">The original file is unavailable.</p>
            {excerpt.path && <button type="button" className={actionStyle} onClick={() => void loadLink(excerpt)}>Retry link</button>}
          </div>
        ) : (
          <a href={link.href} target="_blank" rel="noopener noreferrer" className={actionStyle} onClick={event => {
            if (Date.now() >= link.expiresAt) {
              event.preventDefault();
              void loadLink(excerpt);
            }
          }}>
            {excerpt.kind === "page" && location ? `Open ${location.toLowerCase()}`
              : excerpt.kind === "slide" ? "Open original slides" : "Open original document"}
            <ArrowUpRight size={15} aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </>
  );
}
