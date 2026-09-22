import { describe, expect, it } from "vitest";
import { storageSteps, validateSopSubmission } from "./submit-review.js";

const valid = {
  teamId: "team-1",
  generatedAt: "2026-09-21T12:00:00.000Z",
  draft: {
    title: "Create a team",
    summary: "Create a workspace.",
    prerequisites: ["Sign in."],
    steps: [{ title: "Open Settings", instruction: "Choose Create team.", sourceIds: ["D1"] }],
    warnings: [],
    openQuestions: [],
  },
  sources: [{ id: "D1", name: "sample.docx", kind: "docx", warnings: [] }],
};

describe("SOP review submission validation", () => {
  it("normalizes a valid generated result and creates markdown without binary data", () => {
    const submission = validateSopSubmission({
      ...valid,
      content: {
        blocks: [{ id: "D1-B1", sourceId: "D1", type: "image", src: `data:image/png;base64,${"A".repeat(64_000)}`, alt: "Embedded screenshot" }],
        suggestions: [],
        limitations: [],
      },
    });
    expect(submission.teamId).toBe("team-1");
    expect(submission.sourceMarkdown).toContain("Unpublished imported draft");
    expect(submission.sourceMarkdown).toContain("sample.docx");
    expect(submission.sourceProviderId).toMatch(/^upload:[0-9a-f-]{36}$/);
    expect(submission.sourceMarkdown).not.toContain("data:");
    expect(submission.sourceMarkdown).toContain("Image unavailable");
    expect(submission.sourceContent).toEqual({
      blocks: [{ id: "D1-B1", sourceId: "D1", type: "image", src: undefined, alt: "Embedded screenshot" }],
      suggestions: [],
      limitations: [],
    });
    expect(JSON.stringify(submission.sourceContent)).not.toContain('"src"');
  });

  it("preserves source formatting while removing image bytes", () => {
    const submission = validateSopSubmission({
      ...valid,
      content: {
        blocks: [
          { id: "D1-B1", sourceId: "D1", type: "heading", level: 2, runs: [{ text: "Service level", bold: true, underline: true }] },
          { id: "D1-B2", sourceId: "D1", type: "list-item", ordered: true, marker: "1.", runs: [{ text: "Choose ETSOE", italic: true }] },
          { id: "D1-B3", sourceId: "D1", type: "table", rows: [[[ { text: "Code", bold: true } ], [ { text: "Meaning" } ]]] },
          { id: "D1-B4", sourceId: "D1", type: "image", src: "data:image/png;base64,AAAA", alt: "Quote screen" },
        ],
        suggestions: [],
        limitations: ["Floating layout may differ."],
      },
    });

    expect(submission.sourceContent?.blocks).toEqual([
      { id: "D1-B1", sourceId: "D1", type: "heading", level: 2, runs: [{ text: "Service level", bold: true, italic: undefined, underline: true }], src: undefined },
      { id: "D1-B2", sourceId: "D1", type: "list-item", ordered: true, marker: "1.", runs: [{ text: "Choose ETSOE", bold: undefined, italic: true, underline: undefined }], src: undefined },
      { id: "D1-B3", sourceId: "D1", type: "table", rows: [[[ { text: "Code", bold: true } ], [ { text: "Meaning" } ]]], src: undefined },
      { id: "D1-B4", sourceId: "D1", type: "image", alt: "Quote screen", src: undefined },
    ]);
    expect(JSON.stringify(submission.sourceContent)).not.toContain("data:image");
  });

  it("builds review steps from an imported document when the draft has content blocks only", () => {
    const submission = validateSopSubmission({
      ...valid,
      draft: { ...valid.draft, steps: [] },
      content: {
        blocks: [
          { id: "D1-B1", sourceId: "D1", type: "heading", level: 1, runs: [{ text: "Open Settings" }] },
          { id: "D1-B2", sourceId: "D1", type: "paragraph", runs: [{ text: "Choose the team settings page." }] },
        ],
        suggestions: [],
        limitations: [],
      },
    });
    expect(submission.draft.steps).toEqual([
      { title: "Open Settings", instruction: "Open Settings", sourceIds: ["D1"] },
      { title: "Imported procedure step 2", instruction: "Choose the team settings page.", sourceIds: ["D1"] },
    ]);
  });

  it("flattens structured steps for the existing review and RAG storage schema", () => {
    const submission = validateSopSubmission(valid);
    expect(storageSteps(submission)).toEqual(["Open Settings\nChoose Create team.\nSources: D1"]);
  });

  it("rejects unknown source references and oversized untrusted text", () => {
    expect(() => validateSopSubmission({ ...valid, draft: { ...valid.draft, steps: [{ ...valid.draft.steps[0], sourceIds: ["D999"] }] } })).toThrow("Invalid source reference");
    expect(() => validateSopSubmission({ ...valid, draft: { ...valid.draft, title: "x".repeat(201) } })).toThrow();
  });

  it("rejects a missing selected team and malformed generated timestamp", () => {
    expect(() => validateSopSubmission({ ...valid, teamId: "" })).toThrow();
    expect(() => validateSopSubmission({ ...valid, generatedAt: "not-a-date" })).toThrow();
  });
});
