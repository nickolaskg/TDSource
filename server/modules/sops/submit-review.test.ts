import { describe, expect, it } from "vitest";
import { validateSopSubmission } from "./submit-review.js";

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
    const submission = validateSopSubmission(valid);
    expect(submission.teamId).toBe("team-1");
    expect(submission.sourceMarkdown).toContain("Unpublished AI draft");
    expect(submission.sourceMarkdown).toContain("sample.docx");
    expect(submission.sourceProviderId).toMatch(/^upload:[0-9a-f-]{36}$/);
    expect(submission.sourceMarkdown).not.toContain("data:");
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

  it("rejects unknown source references and oversized untrusted text", () => {
    expect(() => validateSopSubmission({ ...valid, draft: { ...valid.draft, steps: [{ ...valid.draft.steps[0], sourceIds: ["D999"] }] } })).toThrow("Invalid source reference");
    expect(() => validateSopSubmission({ ...valid, draft: { ...valid.draft, title: "x".repeat(201) } })).toThrow();
  });

  it("rejects a missing selected team and malformed generated timestamp", () => {
    expect(() => validateSopSubmission({ ...valid, teamId: "" })).toThrow();
    expect(() => validateSopSubmission({ ...valid, generatedAt: "not-a-date" })).toThrow();
  });
});
