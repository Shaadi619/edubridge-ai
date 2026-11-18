/**
 * Picks the sentences of a course excerpt that an answer most likely relied on,
 * so the source stage can light them. This is a reading aid based on shared
 * words, not a verification: the backend's quote checks stay the source of truth.
 */
export type EvidenceSpan = { text: string; lit: boolean };

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that", "these", "those",
  "from", "into", "onto", "than", "then", "they", "them", "their", "there", "here", "what", "when",
  "which", "while", "where", "who", "whom", "why", "how", "can", "could", "would", "should", "will",
  "has", "have", "had", "was", "were", "been", "being", "its", "it's", "also", "such", "each", "any",
  "all", "one", "two", "more", "most", "some", "other", "only", "very", "just", "about", "over",
  "under", "between", "because", "so", "if", "of", "to", "in", "on", "at", "by", "or", "as", "is",
  "be", "an", "a", "course", "material", "materials",
]);

const MAX_LIT = 2;
const MIN_SHARED = 2;

function terms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? [];
  return new Set(words.map(word => word.replace(/'s$/, "").replace(/s$/, "")).filter(word => word.length > 2 && !STOP_WORDS.has(word)));
}

export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  return flat
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}“"(])|\s+[•▪●]\s+/u)
    .map(part => part.trim())
    .filter(Boolean);
}

export function highlightEvidence(excerpt: string, answer: string): EvidenceSpan[] {
  const sentences = splitSentences(excerpt);
  const answerTerms = terms(answer);
  const scored = sentences.map((text, index) => {
    const own = terms(text);
    let shared = 0;
    own.forEach(term => { if (answerTerms.has(term)) shared += 1; });
    return { index, shared, score: own.size ? shared / Math.sqrt(own.size) : 0 };
  });
  const ranked = scored.filter(item => item.shared >= MIN_SHARED).sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  const litIndexes = new Set(ranked.filter(item => item.score >= best * 0.75).slice(0, MAX_LIT).map(item => item.index));
  return sentences.map((text, index) => ({ text, lit: litIndexes.has(index) }));
}
