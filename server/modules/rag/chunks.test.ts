import { describe, expect, it } from "vitest";
import { buildKnowledgeChunks } from "./chunks.js";

describe("knowledge chunk construction", () => {
  it("keeps structured steps individually addressable and deterministic", () => {
    const version = { title: "Reset a switch", problem: "Switch is offline", summary: "Restore connectivity", steps: ["Open the console.", "Reload the switch."], warnings: ["Save the configuration first."] };
    const first = buildKnowledgeChunks(version);
    expect(buildKnowledgeChunks(version)).toEqual(first);
    expect(first.map(({ sourceLocator }) => sourceLocator)).toEqual([
      { section: "Title" }, { section: "Problem" }, { section: "Summary" },
      { section: "Steps", step: 1 }, { section: "Steps", step: 2 }, { section: "Warnings", step: 1 },
    ]);
    expect(first.map(({ chunkIndex }) => chunkIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("preserves SOP headings, blocks, tables, and image descriptions", () => {
    const chunks = buildKnowledgeChunks({ title: "Quote creation", sourceContent: { suggestions: [], limitations: [], blocks: [
      { id: "h1", sourceId: "D1", type: "heading", runs: [{ text: "Service level" }] },
      { id: "b1", sourceId: "D1", type: "list-item", marker: "1.", runs: [{ text: "Select ETSOP" }] },
      { id: "t1", sourceId: "D1", type: "table", rows: [[[{ text: "Code" }], [{ text: "Meaning" }]]] },
      { id: "i1", sourceId: "D1", type: "image", alt: "Support selector screenshot" },
      { id: "i2", sourceId: "D1", type: "image" },
    ] } });
    expect(chunks.slice(1).map(({ sourceLocator }) => sourceLocator)).toEqual([
      { section: "source", heading: "Service level", blockIds: ["h1", "b1", "t1", "i1"] },
    ]);
    expect(chunks.map(({ content }) => content).join("\n")).toContain("Image: Support selector screenshot");
  });

  it("splits oversized units within the configured bound", () => {
    const chunks = buildKnowledgeChunks({ title: "A".repeat(650) }, 200);
    expect(chunks).toHaveLength(4);
    expect(chunks.every(({ content }) => content.length <= 200)).toBe(true);
    expect(chunks.map(({ sourceLocator }) => sourceLocator.part)).toEqual([1, 2, 3, 4]);
  });
});
