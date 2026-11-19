import assert from "node:assert/strict";
import test from "node:test";
import { joinPageChunks, pageParagraphs } from "../src/lib/pageText.ts";

const PAGE = "Attention lets every token look at every other token in the sequence. "
  + "Queries, keys and values are projections of the same input. "
  + "The scores are scaled by the square root of the key dimension before the softmax.";

test("removes the overlap between neighbouring chunks", () => {
  const first = PAGE.slice(0, 120);
  const second = PAGE.slice(80);
  assert.equal(joinPageChunks([first, second]), PAGE);
});

test("joins chunks that don't overlap with a space", () => {
  assert.equal(joinPageChunks(["First part.", "Second part."]), "First part. Second part.");
});

test("ignores empty chunks and copes with a single one", () => {
  assert.equal(joinPageChunks(["", "  Only this.  "]), "Only this.");
  assert.equal(joinPageChunks([]), "");
});

test("does not treat a tiny coincidental match as overlap", () => {
  assert.equal(joinPageChunks(["It ends with the", "the start of more"]), "It ends with the the start of more");
});

test("splits paragraphs and inline slide bullets", () => {
  assert.deepEqual(pageParagraphs("Title line\n\nBody text\ncontinues • one • two"), [
    "Title line", "Body text continues", "• one", "• two",
  ]);
});
