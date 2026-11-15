import type { SourceCitation } from "./api";
import { supabase } from "./supabase";

const LINK_LIFETIME_SECONDS = 300;

type CitationRow = {
  content: string;
  page_number: number | null;
  materials: {
    title: string;
    storage_path: string;
    mime_type: string;
  };
};

export type CitationExcerpt = {
  content: string;
  path: string;
  pageNumber: number | null;
  kind: SourceCitation["source_kind"];
};

export function citationLocation(kind: SourceCitation["source_kind"], number: number | null) {
  if (kind === "document" || number === null || number < 1) return null;
  return `${kind === "slide" ? "Slide" : "Page"} ${number}`;
}

export async function loadCitationExcerpt(courseId: string, chunkId: string, signal: AbortSignal) {
  if (!supabase) throw new Error("Course sources are unavailable.");

  const { data, error } = await supabase.from("material_chunks")
    .select("content,page_number,materials!inner(title,storage_path,mime_type)")
    .eq("id", chunkId)
    .eq("course_id", courseId)
    .eq("materials.course_id", courseId)
    .eq("materials.status", "ready")
    .abortSignal(signal)
    .maybeSingle()
    .overrideTypes<CitationRow, { merge: false }>();
  if (error || !data?.materials) {
    throw new Error("This excerpt is unavailable. The source may have changed or your access may have expired.");
  }

  const { title, storage_path, mime_type } = data.materials;
  const titleLower = title.toLowerCase();
  const parts = storage_path.split("/");
  const safePath = parts.length >= 2 && parts[0] === courseId
    && parts.every(part => part && part !== "." && part !== "..");
  let kind: CitationExcerpt["kind"] = "document";
  if (mime_type === "application/pdf" || titleLower.endsWith(".pdf")) kind = "page";
  if (mime_type.includes("presentationml") || /\.pptx?$/.test(titleLower)) kind = "slide";

  return {
    content: data.content,
    path: safePath ? storage_path : "",
    pageNumber: data.page_number,
    kind,
  } satisfies CitationExcerpt;
}

export async function createCitationLink(excerpt: CitationExcerpt) {
  if (!supabase || !excerpt.path) throw new Error("Original file unavailable.");
  const expiresAt = Date.now() + LINK_LIFETIME_SECONDS * 1000;
  const { data, error } = await supabase.storage.from("course-materials")
    .createSignedUrl(excerpt.path, LINK_LIFETIME_SECONDS);
  if (error || !data?.signedUrl) throw new Error("Original file unavailable.");

  const url = new URL(data.signedUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Original file unavailable.");
  const page = excerpt.pageNumber;
  if (excerpt.kind === "page" && page !== null && Number.isInteger(page) && page > 0) {
    url.hash = `page=${page}`;
  }
  return { href: url.toString(), expiresAt };
}
