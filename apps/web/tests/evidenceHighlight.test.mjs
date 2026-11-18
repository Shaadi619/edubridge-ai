import assert from "node:assert/strict";
import test from "node:test";
import { highlightEvidence, highlightQuote, splitSentences } from "../src/lib/evidenceHighlight.ts";

const SLIDE = "Sequence models read one token at a time. The Transformer is the core engine behind modern AI. "
  + "It was introduced for machine translation. Attention weighs every token against every other token.";

test("splits sentences and slide bullets", () => {
  assert.deepEqual(splitSentences("First point.  Second point!\nThird • Fourth"), [
    "First point.", "Second point!", "Third", "Fourth",
  ]);
  assert.deepEqual(splitSentences("   "), []);
});

test("lights the sentence the answer relied on", () => {
  const spans = highlightEvidence(SLIDE, "A transformer is a neural-network architecture: the core engine behind modern AI.");
  assert.deepEqual(spans.filter(span => span.lit).map(span => span.text), [
    "The Transformer is the core engine behind modern AI.",
  ]);
  assert.equal(spans.map(span => span.text).join(" "), SLIDE);
});

test("lights at most two sentences", () => {
  const spans = highlightEvidence(SLIDE, "transformer engine modern attention weighs every token against other token machine translation");
  assert.ok(spans.filter(span => span.lit).length <= 2);
});

test("lights nothing when the answer shares too little with the excerpt", () => {
  const spans = highlightEvidence(SLIDE, "Photosynthesis happens in chloroplasts.");
  assert.equal(spans.some(span => span.lit), false);
});

test("does not light a short heading even when it shares words", () => {
  const excerpt = "Transformer and self-attention • The transformer architecture uses self-attention to capture relationships between words. "
    + "Self-attention allows each word to look at all words in the sentence at the same time.";
  const spans = highlightEvidence(excerpt, "Transformers read words one at a time like an RNN. Transformer self-attention");
  const lit = spans.filter(span => span.lit).map(span => span.text);
  assert.ok(!lit.includes("Transformer and self-attention"));
  assert.ok(lit.includes("Self-attention allows each word to look at all words in the sentence at the same time."));
});

test("treats slide lines as separate when there are no full stops", () => {
  const slide = "Transformer and self-attention\nThe transformer architecture uses a mechanism\ncalled self-attention to capture relationships between words\n"
    + "Self-Attention allows each word to look at all words in the sentence at the same time";
  assert.deepEqual(splitSentences(slide), [
    "Transformer and self-attention",
    "The transformer architecture uses a mechanism called self-attention to capture relationships between words",
    "Self-Attention allows each word to look at all words in the sentence at the same time",
  ]);
  const lit = highlightEvidence(slide, "Transformers read words one at a time like an RNN").filter(span => span.lit).map(span => span.text);
  assert.ok(lit.includes("Self-Attention allows each word to look at all words in the sentence at the same time"));
  assert.ok(!lit.includes("Transformer and self-attention"));
  assert.ok(lit.length <= 2);
});

test("splits long merged slide runs before a capitalised word", () => {
  const run = "The transformer architecture uses a mechanism called self-attention to capture relationships between words "
    + "Self-Attention allows each word to look at all words in the sentence at the same time, while focusing on the relevant ones";
  assert.deepEqual(splitSentences(run), [
    "The transformer architecture uses a mechanism called self-attention to capture relationships between words",
    "Self-Attention allows each word to look at all words in the sentence at the same time, while focusing on the relevant ones",
  ]);
  assert.deepEqual(splitSentences("Short line About Names stays whole"), ["Short line About Names stays whole"]);
});

test("lights an exact verified quote, ignoring line breaks", () => {
  const spans = highlightQuote("Plants take in light.\nPlants release oxygen\n during photosynthesis. Roots absorb water.",
    "Plants release oxygen during photosynthesis.", "");
  assert.deepEqual(spans, [
    { text: "Plants take in light.", lit: false },
    { text: "Plants release oxygen during photosynthesis.", lit: true },
    { text: "Roots absorb water.", lit: false },
  ]);
});

test("falls back to word overlap when the quote is missing", () => {
  const spans = highlightQuote(SLIDE, null, "the core engine behind modern AI transformer");
  assert.ok(spans.some(span => span.lit && span.text.includes("core engine")));
});
