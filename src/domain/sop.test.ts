import { describe, expect, it } from "vitest";
import { sopMarkdown, type SopResult } from "./sop";

describe("SOP Markdown source limitations", () => {
  it("retains extraction warnings alongside their source without inventing warnings for other sources", () => {
    const result: SopResult = {
      draft: { title: "Sample", summary: "Sample procedure", prerequisites: [], steps: [], warnings: [], openQuestions: [] },
      sources: [
        { id: "D1", name: "procedure.xlsx", kind: "xlsx", warnings: ["Formula cached values may be stale.", "Image placement is not preserved."] },
        { id: "D2", name: "procedure.pdf", kind: "pdf", warnings: [] },
      ],
      generatedAt: "2026-09-18", teamId: "sample-team",
    };
    const markdown = sopMarkdown(result);
    expect(markdown).toContain("- D1: procedure.xlsx\n  - Source limitation: Formula cached values may be stale.\n  - Source limitation: Image placement is not preserved.\n- D2: procedure.pdf");
    expect(markdown.match(/Source limitation:/g)).toHaveLength(2);
  });
});
