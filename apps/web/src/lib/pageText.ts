/**
 * Course pages are stored as overlapping chunks (about 200 characters shared
 * between neighbours). Stitch one page's chunks back into readable text.
 */
const MAX_OVERLAP = 400;
const MIN_OVERLAP = 12;

function sharedLength(previous: string, next: string) {
  const limit = Math.min(MAX_OVERLAP, previous.length, next.length);
  for (let size = limit; size >= MIN_OVERLAP; size -= 1) {
    if (previous.endsWith(next.slice(0, size))) return size;
  }
  return 0;
}

export function joinPageChunks(chunks: string[]): string {
  let text = "";
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    if (!text) { text = chunk; continue; }
    const shared = sharedLength(text, chunk);
    if (shared) text += chunk.slice(shared);
    else text += (/\s$/.test(text) ? "" : " ") + chunk;
  }
  return text;
}

/** Split page text into paragraphs; slide bullets that arrive inline get their own line. */
export function pageParagraphs(text: string): string[] {
  return text
    .replace(/\s*[•▪●]\s*/g, "\n• ")
    .split(/\n\s*\n|\n(?=• )/)
    .map(part => part.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}
