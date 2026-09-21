import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SopContent } from "../../domain/sop-content";
import { sopMarkdown } from "../../domain/sop";
import { ContentBlocks, SopContentView } from "./SopContentView";
import { resolveSuggestion, sopUploadForm } from "./content-review";

const content: SopContent = {
  blocks: [
    { id: "one", sourceId: "D1", type: "list-item", level: 0, ordered: true, marker: "4.", runs: [{ text: "Open setup.", bold: true }] },
    { id: "exception", sourceId: "D1", type: "list-item", level: 1, ordered: false, marker: "•", runs: [{ text: "Except for existing accounts: skip this step.", italic: true }] },
    { id: "table", sourceId: "D1", type: "table", rows: [[[{ text: "Exact cell", underline: true }]]] },
    { id: "image", sourceId: "D1", type: "image", src: "data:image/png;base64,iVBORw0KGgo=", alt: "Settings screenshot" },
  ],
  suggestions: [{ blockId: "one", original: "Open setup.", replacement: "Open Setup.", reason: "Capitalization." }],
  limitations: ["Verify images against the original."],
};

describe("faithful SOP review", () => {
  it("renders nested semantic lists, exact markers, emphasis, tables, and screenshots without dropping exceptions", () => {
    const html = renderToStaticMarkup(createElement(ContentBlocks, { blocks: content.blocks }));
    expect(html).toContain('<ol><li'); expect(html).toContain('<ul><li');
    expect(html).toContain('4. '); expect(html).toContain('<strong>Open setup.</strong>');
    expect(html).toContain('<em>Except for existing accounts: skip this step.</em>');
    expect(html).toContain('<td><u>Exact cell</u></td>');
    expect(html).toContain('alt="Settings screenshot"');
    expect(html.indexOf('<ul>')).toBeLessThan(html.indexOf('</ol>'));
  });
  it("shows a placeholder for missing or unsafe image URLs", () => {
    for (const src of [undefined, "https://untrusted.example/track.png", "data:image/svg+xml;base64,PHN2Zz4="]) {
      const html = renderToStaticMarkup(createElement(ContentBlocks, { blocks: [{ id: "image", sourceId: "D1", type: "image", src }] }));
      expect(html).toContain("Image unavailable"); expect(html).not.toContain("<img");
    }
  });
  it("keeps suggested wording separate until accepted, and rejects without changing any blocks", () => {
    const html = renderToStaticMarkup(createElement(SopContentView, { content, onChange: () => {} }));
    expect(html).toContain('Before:'); expect(html).toContain('After:'); expect(html).toContain('Capitalization.');
    expect(html).toContain('Accept suggestion 1'); expect(html).toContain('Reject suggestion 1');
    const rejected = resolveSuggestion(content, 0, false);
    expect(rejected.blocks).toEqual(content.blocks); expect(rejected.suggestions).toEqual([]);
    const accepted = resolveSuggestion(content, 0, true);
    expect(accepted.blocks[0].runs).toEqual([{ text: "Open Setup." }]);
    expect(accepted.blocks[0].marker).toBe("4.");
    expect(accepted.blocks.slice(1)).toEqual(content.blocks.slice(1));
    expect(content.blocks[0].runs?.[0].bold).toBe(true);
  });
  it("does not apply stale suggestions or replacements to tables", () => {
    expect(resolveSuggestion({ ...content, suggestions: [{ ...content.suggestions[0], original: "Wrong text" }] }, 0, true).blocks).toEqual(content.blocks);
    expect(resolveSuggestion({ ...content, suggestions: [{ ...content.suggestions[0], blockId: "table" }] }, 0, true).blocks).toEqual(content.blocks);
  });
  it("exports imported exceptions rather than the legacy summary or unaccepted suggestions", () => {
    const markdown = sopMarkdown({ content, draft: { title: "Setup", summary: "Legacy summary", steps: [], prerequisites: [], warnings: [], openQuestions: [] }, sources: [], generatedAt: "2026-09-18", teamId: "test" });
    expect(markdown).toContain("Except for existing accounts: skip this step.");
    expect(markdown).not.toContain("Open Setup."); expect(markdown).toContain("Open setup."); expect(markdown).not.toContain("Legacy summary");
  });
  it("sends optional AI edits only after selection and preserves documents and notes", () => {
    const file = new File(["sample"], "sample.docx");
    const form = sopUploadForm([file], "team", "Title", "Do not omit exceptions", false);
    expect(form.has("suggestEdits")).toBe(false); expect(form.get("sampleConfirmed")).toBe("true");
    expect(form.get("notes")).toBe("Do not omit exceptions"); expect((form.get("files") as File).name).toBe("sample.docx");
    expect(sopUploadForm([file], "team", "Title", "", true).get("suggestEdits")).toBe("true");
  });
});

