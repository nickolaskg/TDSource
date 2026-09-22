import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { validateFaithfulResponse } from "./faithful-ai.js";
import { generateSop, handleSopRequest } from "./generate.js";
import type { SopBlock } from "../../../src/domain/sop-content.js";
const original = "Discount: 42% applies. We do not apply EDU DART for this account.";
const block: SopBlock = { id: "D1-B1", sourceId: "D1", type: "paragraph", runs: [{ text: original }] };
const base = { pdfBlocks: [], suggestions: [], openQuestions: [] };
function doc() {
  const zipped = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(`<w:document><w:body><w:p><w:r><w:t>${original}</w:t></w:r></w:p></w:body></w:document>`) });
  return new File([new Uint8Array(zipped)], "procedure.docx");
}
const env = { APP_ORIGIN: "http://localhost:5173", GEMINI_AI_API: "synthetic-key" };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("faithful SOP import", () => {
  it("sends Office content to the provider even without optional edits", async () => {
    const fetcher = vi.fn(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(base) }] } }] })); vi.stubGlobal("fetch", fetcher);
    const result = await generateSop([doc()], "Extra note", "", "team", env);
    expect(result.content?.blocks[0].runs?.map((run) => run.text).join("")).toBe(original);
    expect(result.content?.blocks.some((b) => b.sourceId === "N1")).toBe(true);
    expect(result.content?.suggestions).toEqual([]); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetcher.mock.calls[0])).toContain(original);
  });
  it("does not send Office screenshots when the response schema cannot use them", async () => {
    const zipped = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(`<w:document><w:body><w:p><w:r><w:t>${original}</w:t></w:r><w:drawing><a:blip r:embed="rIdPicture"/></w:drawing></w:p></w:body></w:document>`),
      "word/_rels/document.xml.rels": strToU8('<Relationships><Relationship Id="rIdPicture" Target="media/image1.png"/></Relationships>'),
      "word/media/image1.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const fetcher = vi.fn(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(base) }] } }] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await generateSop([new File([new Uint8Array(zipped)], "procedure.docx")], "", "", "team", env);
    expect(result.content?.blocks.some(({ type }) => type === "image")).toBe(true);
    expect(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)).not.toContain("inlineData");
  });
  it("keeps a Word import when optional AI parsing is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    const result = await generateSop([doc()], "", "", "team", env);
    expect(result.content?.blocks.some((item) => item.sourceId === "D1")).toBe(true);
    expect(result.content?.limitations).toContain("The original content was imported unchanged. You can retry optional AI edits later.");
  });
  it("fails the import when required AI parsing fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private quota detail", { status: 429 })));
    await expect(generateSop([doc()], "", "", "team", env, undefined, {}, true)).rejects.toThrow("quota or rate limit");
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain("private quota detail");
  });
  it("rejects truncated PDF transcription and never returns a partial draft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: JSON.stringify(base) }] } }] })));
    await expect(generateSop([new File(["%PDF-1.7 fake"], "sample.pdf")], "", "", "team", env)).rejects.toThrow("Incomplete transcription");
  });
  it("rechecks authentication after required AI parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(base) }] } }] })));
    const body = new FormData(); body.append("files", doc()); body.set("teamId", "team"); body.set("sampleConfirmed", "true");
    const session = vi.fn().mockResolvedValueOnce({ appUserId: "user", accountStatus: "active", teamRoles: [{ teamId: "team", role: "moderator" }] }).mockResolvedValueOnce(null);
    const response = await handleSopRequest(new Request(`${env.APP_ORIGIN}/api/sops/generate`, { method: "POST", headers: { origin: env.APP_ORIGIN }, body }), env, session);
    expect(response.status).toBe(403);
  });
});
describe("source-anchored AI edits", () => {
  it.each([
    ["wrong source", { blockId: "D999-B1", original, replacement: original }],
    ["wrong original", { blockId: block.id, original: "Different source", replacement: original }],
    ["changed percentage", { blockId: block.id, original, replacement: original.replace("42%", "45%") }],
    ["missing prohibition", { blockId: block.id, original, replacement: "Discount: 42% applies. Apply EDU DART for this account." }],
    ["changed service code", { blockId: block.id, original, replacement: original.replace("EDU DART", "OTHER") }],
  ])("withholds %s without rewriting the original", (_label, suggestion) => {
    const result = validateFaithfulResponse({ ...base, suggestions: [{ ...suggestion, reason: "Test" }] }, [block], [], true);
    expect(result.suggestions).toEqual([]); expect(result.limitations.length).toBeGreaterThan(0); expect(block.runs?.[0].text).toBe(original);
  });
  it("retains a safe suggestion separately and ignores unsolicited edits", () => {
    const suggestion = { blockId: block.id, original, replacement: "Discount: 42% applies. For this account, we do not apply EDU DART.", reason: "Clarifies which account the exception applies to." };
    expect(validateFaithfulResponse({ ...base, suggestions: [suggestion] }, [block], [], true).suggestions).toEqual([suggestion]);
    expect(validateFaithfulResponse({ ...base, suggestions: [suggestion] }, [block], [], false).suggestions).toEqual([]);
  });
  it("requires a transcription for every PDF and rejects invented sources", () => {
    expect(() => validateFaithfulResponse(base, [], ["D1"], false)).toThrow("Missing PDF");
    expect(() => validateFaithfulResponse({ ...base, pdfBlocks: [{ sourceId: "D999", page: 1, type: "paragraph", runs: [{ text: "fake" }] }] }, [], ["D1"], false)).toThrow("Invalid PDF");
  });
});
