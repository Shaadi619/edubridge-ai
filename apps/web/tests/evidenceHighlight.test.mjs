import assert from "node:assert/strict";
import test from "node:test";
import { highlightEvidence, splitSentences } from "../src/lib/evidenceHighlight.ts";

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
