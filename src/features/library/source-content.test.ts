import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublishedDocumentContent } from "./LibraryPage";

const draft = { title: "Imported SOP", problem: "Generic problem", summary: "Generic summary", steps: ["Generic step"], warnings: [] };

describe("published SOP presentation", () => {
  it("renders preserved source blocks instead of the generic draft", () => {
    const html = renderToStaticMarkup(createElement(PublishedDocumentContent, { detail: {
      draft,
      sourceContent: { blocks: [
        { id: "heading", sourceId: "D1", type: "heading", level: 2, runs: [{ text: "Exact heading" }] },
        { id: "list", sourceId: "D1", type: "list-item", ordered: true, marker: "3.", runs: [{ text: "Exact step", bold: true }] },
        { id: "image", sourceId: "D1", type: "image", src: "https://untrusted.example/image.png", alt: "Source screenshot" },
      ], suggestions: [], limitations: [] },
    } }));
    expect(html).toContain("Original procedure");
    expect(html).toContain("Exact heading");
    expect(html).toContain("<strong>Exact step</strong>");
    expect(html).toContain("Image unavailable");
    expect(html).not.toContain("Generic problem");
    expect(html).not.toContain("<img");
  });

  it("keeps the legacy published layout without source blocks", () => {
    const html = renderToStaticMarkup(createElement(PublishedDocumentContent, { detail: { draft } }));
    expect(html).toContain("Problem");
    expect(html).toContain("Generic summary");
    expect(html).toContain("Generic step");
    expect(html).not.toContain("Original procedure");
  });
});
