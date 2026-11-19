import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, ChevronLeft, ChevronRight, Upload } from "lucide-react";

import { joinPageChunks, pageParagraphs } from "../../lib/pageText";
import { supabase } from "../../lib/supabase";

export type MaterialDoc = {
  id: number | string;
  name: string;
  size: string;
  type: string;
  status: "uploading" | "processing" | "ready" | "error";
  pages?: number;
  uploadedAt: string;
  createdAt?: string;
  storagePath?: string;
};

type PageState = "loading" | { error: string } | { paragraphs: string[] };
type LinkState = "idle" | "loading" | "unavailable" | { href: string; expiresAt: number };

const LINK_SECONDS = 300;
const WRONG = "#E8907F";

function shortTitle(title: string) {
  return title.replace(/\.(pdf|pptx?|docx?)$/i, "");
}

function kindOf(doc: MaterialDoc) {
  const name = doc.name.toLowerCase();
  if (doc.type.includes("presentationml") || /\.pptx?$/.test(name) || doc.type === "pptx") return "slide";
  if (doc.type === "application/pdf" || name.endsWith(".pdf") || doc.type === "pdf") return "page";
  return "document";
}

function formatLabel(doc: MaterialDoc) {
  const kind = kindOf(doc);
  return kind === "slide" ? "Slides" : kind === "page" ? "PDF" : "Document";
}

function added(doc: MaterialDoc) {
  if (!doc.createdAt) return `added ${doc.uploadedAt}`;
  return `added ${new Date(doc.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}

function safePath(courseId: string, path?: string) {
  if (!path) return null;
  const parts = path.split("/");
  return parts.length >= 2 && parts[0] === courseId && parts.every(part => part && part !== "." && part !== "..") ? path : null;
}

export default function MaterialsStage({ docs, onRemoved, onUploadClick, courseId, courseName }: {
  docs: MaterialDoc[];
  onRemoved: (id: MaterialDoc["id"]) => void;
  onUploadClick: () => void;
  courseId: string;
  courseName: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<MaterialDoc["id"] | null>(null);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState<PageState>("loading");
  const [link, setLink] = useState<LinkState>("idle");
  const [confirmRemove, setConfirmRemove] = useState<MaterialDoc["id"] | null>(null);
  const [removing, setRemoving] = useState(false);
  const [linkRefresh, setLinkRefresh] = useState(0);

  const ready = docs.filter(doc => doc.status === "ready");
  const totalPages = ready.reduce((sum, doc) => sum + (doc.pages ?? 0), 0);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? docs.filter(doc => doc.name.toLowerCase().includes(needle)) : docs;
  }, [docs, query]);

  const selected = docs.find(doc => doc.id === selectedId && doc.status === "ready") ?? ready[0] ?? null;
  const pageCount = Math.max(1, selected?.pages ?? 1);
  const kind = selected ? kindOf(selected) : "page";
  const unit = kind === "slide" ? "Slide" : "Page";

  useEffect(() => { setPage(1); }, [selected?.id]);

  useEffect(() => {
    if (!supabase || !selected || typeof selected.id !== "string") return;
    const controller = new AbortController();
    setPageText("loading");
    void supabase.from("material_chunks")
      .select("chunk_index, content")
      .eq("material_id", selected.id)
      .eq("course_id", courseId)
      .eq("page_number", page)
      .order("chunk_index")
      .abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (error) { setPageText({ error: "This page couldn’t be loaded. Try again in a moment." }); return; }
        setPageText({ paragraphs: pageParagraphs(joinPageChunks((data ?? []).map(row => row.content as string))) });
      });
    return () => controller.abort();
  }, [selected?.id, page, courseId]);

  useEffect(() => {
    const path = safePath(courseId, selected?.storagePath);
    if (!supabase || !path) { setLink("unavailable"); return; }
    let current = true;
    setLink("loading");
    void supabase.storage.from("course-materials").createSignedUrl(path, LINK_SECONDS).then(({ data, error }) => {
      if (!current) return;
      if (error || !data?.signedUrl) { setLink("unavailable"); return; }
      const url = new URL(data.signedUrl);
      if (kind === "page") url.hash = `page=${page}`;
      setLink({ href: url.toString(), expiresAt: Date.now() + LINK_SECONDS * 1000 });
    });
    return () => { current = false; };
  }, [selected?.storagePath, page, kind, courseId, linkRefresh]);

  const remove = async (doc: MaterialDoc) => {
    if (!supabase || typeof doc.id !== "string" || removing) return;
    setRemoving(true);
    const { error } = await supabase.from("materials").delete().eq("id", doc.id);
    setRemoving(false);
    if (error) { toast.error(error.message); return; }
    if (doc.storagePath) await supabase.storage.from("course-materials").remove([doc.storagePath]);
    onRemoved(doc.id);
    setConfirmRemove(null);
    toast.success(`Removed ${shortTitle(doc.name)}`);
  };

  const quietButton = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[var(--eb-line)] px-3 text-sm text-[var(--eb-text-soft)] transition-colors hover:border-[var(--eb-text-muted)] hover:text-[var(--eb-text)] disabled:opacity-40";
  const paperButton = "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[rgba(30,42,54,0.18)] text-[var(--eb-ink)] transition-colors hover:bg-[rgba(30,42,54,0.06)] disabled:opacity-30";

  return (
    <section aria-label="Course material" className="eb-stage overflow-hidden rounded-2xl">
      <header className="flex flex-wrap items-end justify-between gap-4 px-6 pb-6 pt-7 sm:px-8">
        <div className="flex max-w-[62ch] flex-col gap-1.5">
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.015em]">Course material</h1>
          <p className="m-0 text-[15px] leading-relaxed text-[var(--eb-text-soft)]">
            Everything students in {courseName} can ask about. The tutor, quizzes and feedback only answer from documents that are ready here.
          </p>
        </div>
        <button type="button" onClick={onUploadClick}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--eb-text)] px-5 font-semibold text-[var(--eb-ink)]">
          <Upload size={16} aria-hidden="true" />Upload material
        </button>
      </header>

      <div className="grid border-t border-[var(--eb-line-soft)] lg:grid-cols-[minmax(300px,42%)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-[var(--eb-text-muted)]">
              {ready.length === 0 ? "Nothing ready yet" : `${ready.length} ready, ${totalPages} ${totalPages === 1 ? "page" : "pages"} in total`}
            </span>
            {docs.length > 5 && (
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a document" aria-label="Find a document"
                className="min-h-9 w-44 rounded-lg border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-3 text-sm focus:border-[var(--eb-text-muted)] focus:outline-none" />
            )}
          </div>

          {docs.length === 0 ? (
            <p className="m-0 max-w-[48ch] text-[15px] leading-relaxed text-[var(--eb-text-soft)]">
              Upload the PDFs and slides you teach from. Students can only get answers that come from material here, so start with the documents they’ll lean on most.
            </p>
          ) : visible.length === 0 ? (
            <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">No document matches “{query}”.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {visible.map(doc => {
                const current = doc.id === selected?.id;
                const asking = confirmRemove === doc.id;
                return (
                  <li key={doc.id} className="border-b border-[var(--eb-line-soft)] py-1 last:border-0">
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={doc.status !== "ready"} aria-current={current ? "true" : undefined}
                        onClick={() => { setSelectedId(doc.id); setConfirmRemove(null); }}
                        className="flex min-h-[56px] min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg px-3 py-2 text-left transition-colors enabled:hover:bg-[var(--eb-raised-2)] disabled:cursor-default"
                        style={current ? { background: "var(--eb-raised)" } : undefined}>
                        <span className={`truncate text-[15px] ${current ? "font-semibold text-[var(--eb-text)]" : "text-[var(--eb-text-soft)]"}`}>{shortTitle(doc.name)}</span>
                        <span className="text-sm text-[var(--eb-text-muted)]">
                          {doc.status === "ready" && `${formatLabel(doc)}${doc.pages ? `, ${doc.pages} ${kindOf(doc) === "slide" ? "slides" : "pages"}` : ""}, ${added(doc)}`}
                          {(doc.status === "processing" || doc.status === "uploading") && "Reading the text so students can ask about it"}
                          {doc.status === "error" && <span style={{ color: WRONG }}>Couldn’t be read. Remove it and upload it again.</span>}
                        </span>
                        {(doc.status === "processing" || doc.status === "uploading") && (
                          <span aria-hidden="true" className="relative mt-1 block h-[3px] w-40 overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
                            <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-text-muted),transparent)]" />
                          </span>
                        )}
                      </button>
                      {!asking && doc.status !== "uploading" && doc.status !== "processing" && (
                        <button type="button" onClick={() => setConfirmRemove(doc.id)} aria-label={`Remove ${shortTitle(doc.name)}`}
                          className="min-h-10 shrink-0 rounded-lg px-2.5 text-sm text-[var(--eb-text-muted)] hover:text-[var(--eb-text)]">
                          Remove
                        </button>
                      )}
                    </div>
                    {asking && (
                      <div role="alertdialog" aria-label={`Remove ${shortTitle(doc.name)}?`} className="eb-rise mx-3 mb-2 flex flex-col gap-3 rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] p-4 text-[15px]">
                        <span>Remove {shortTitle(doc.name)}? Students will stop getting answers from it, and its file is deleted.</span>
                        <div className="flex gap-2">
                          <button type="button" disabled={removing} onClick={() => void remove(doc)}
                            className="min-h-10 rounded-lg px-4 font-semibold text-[var(--eb-ink)] disabled:opacity-50" style={{ background: WRONG }}>
                            {removing ? "Removing…" : "Remove"}
                          </button>
                          <button type="button" onClick={() => setConfirmRemove(null)} className={quietButton}>Keep it</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="relative min-h-[460px] border-t border-[var(--eb-line-soft)] bg-[var(--eb-stage-deep)] px-5 py-6 sm:px-8 lg:border-l lg:border-t-0">
          {selected ? (
            <article aria-label={`${shortTitle(selected.name)}, ${unit.toLowerCase()} ${page}`} className="eb-paper flex min-h-[420px] flex-col gap-4 px-7 py-6 sm:px-9">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(30,42,54,0.12)] pb-3">
                <div className="flex min-w-0 flex-col">
                  <span className="eb-serif truncate text-[19px] font-medium">{shortTitle(selected.name)}</span>
                  <span className="text-[13px] text-[var(--eb-ink-faint)]">{unit} {page} of {pageCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" className={paperButton} disabled={page <= 1} onClick={() => setPage(value => value - 1)} aria-label={`Previous ${unit.toLowerCase()}`}>
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className={paperButton} disabled={page >= pageCount} onClick={() => setPage(value => value + 1)} aria-label={`Next ${unit.toLowerCase()}`}>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  {typeof link === "object" ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer"
                      onClick={event => { if (link.expiresAt < Date.now()) { event.preventDefault(); setLinkRefresh(value => value + 1); toast("That link had expired. Choose Open original again."); } }}
                      className="ml-1 inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-[var(--eb-ink)] underline-offset-4 hover:underline">
                      Open original<ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  ) : link === "loading" ? (
                    <span className="ml-1 px-2.5 text-sm text-[var(--eb-ink-faint)]">Preparing link…</span>
                  ) : null}
                </div>
              </header>

              {pageText === "loading" ? (
                <p role="status" className="m-0 text-[15px] text-[var(--eb-ink-muted)]">Opening {unit.toLowerCase()} {page}…</p>
              ) : "error" in pageText ? (
                <p role="alert" className="m-0 text-[15px] text-[var(--eb-ink-muted)]">{pageText.error}</p>
              ) : pageText.paragraphs.length === 0 ? (
                <p className="m-0 max-w-[52ch] text-[15px] leading-relaxed text-[var(--eb-ink-muted)]">
                  No text was found on this {unit.toLowerCase()}. It may be an image or a scanned page, which students can’t ask about yet.
                </p>
              ) : (
                <div key={`${selected.id}-${page}`} className="eb-rise eb-serif flex max-w-[68ch] flex-col gap-3 text-[16px] leading-[1.75] text-[var(--eb-ink)]">
                  {pageText.paragraphs.map((paragraph, index) => <p key={index} className="m-0">{paragraph}</p>)}
                </div>
              )}
              <p className="m-0 mt-auto pt-2 text-[13px] text-[var(--eb-ink-faint)]">This is the text students’ answers are checked against.</p>
            </article>
          ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center">
              <p className="m-0 max-w-[40ch] text-[15px] leading-relaxed text-[var(--eb-text-muted)]">
                {docs.length ? "When a document is ready, its pages open here so you can see exactly what students’ answers come from." : "Pages open here once a document is uploaded and read."}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
