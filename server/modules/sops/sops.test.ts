import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { SOP_LIMITS, sopFileError, sopMarkdown } from "../../../src/domain/sop.js";
import { prepareDocument } from "./documents.js";
import { handleSopRequest, validateSopDraft, type SopSession } from "./generate.js";

const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function office(name: string, entries: Record<string, string | Uint8Array>): File {
  const bytes = zipSync(Object.fromEntries(Object.entries({ "[Content_Types].xml": "<Types/>", ...entries }).map(([path, value]) => [path, typeof value === "string" ? strToU8(value) : value])));
  return new File([new Uint8Array(bytes)], name);
}
const docx = () => office("sample.docx", { "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Open Settings &amp; choose Create team.</w:t></w:r></w:p></w:body></w:document>', "word/media/image1.png": fakePng });
const draft = { title: "Create a team", summary: "Create a workspace for a team.", prerequisites: ["Sign in."], steps: [{ title: "Open Settings", instruction: "Choose Create team.", sourceIds: ["D1"] }], warnings: [], openQuestions: [] };
const moderator: SopSession = { appUserId: "user-1", accountStatus: "active", teamRoles: [{ teamId: "team-1", teamName: "Support", role: "moderator" }, { teamId: "team-2", teamName: "Sales", role: "basic" }] };
const env = { APP_ORIGIN: "http://localhost:5173", GEMINI_AI_API: "test-key", LLM_MODEL: "configured-model" };
function upload(options: { teamId?: string; file?: File; origin?: string; url?: string; notes?: string; suggestEdits?: boolean } = {}) {
  const form = new FormData();
  form.set("teamId", options.teamId || "team-1");
  form.set("notes", options.notes || ""); form.set("suggestEdits", String(options.suggestEdits ?? false)); form.append("files", options.file || docx());
  const url = options.url || "http://localhost:5173/api/sops/generate";
  return new Request(url, { method: "POST", headers: { origin: options.origin || new URL(url).origin }, body: form });
}
afterEach(() => vi.unstubAllGlobals());

describe("SOP document extraction", () => {
  it("extracts Word text and embeds screenshots as visual parts", async () => {
    const result = await prepareDocument(docx(), "D1");
    expect(result.parts).toContainEqual({ text: "Source block D1-B1 (paragraph): Open Settings & choose Create team." });
    expect(result.parts.some((part) => "inlineData" in part && part.inlineData.mimeType === "image/png")).toBe(true);
    expect(result.source.warnings.join(" ")).toContain("Word page layout");
  });
  it.each([
    ['deleted instruction', '<w:del><w:r><w:delText>Disable validation.</w:delText></w:r></w:del>'],
    ['inserted replacement', '<w:ins><w:r><w:t>Enable validation.</w:t></w:r></w:ins>'],
    ['moved original', '<w:moveFrom><w:r><w:t>Restart the service.</w:t></w:r></w:moveFrom>'],
    ['moved destination', '<w:moveTo><w:r><w:t>Restart the service.</w:t></w:r></w:moveTo>'],
    ['deleted table cell', '<w:tc><w:tcPr><w:cellDel/></w:tcPr><w:p><w:r><w:t>Old instruction.</w:t></w:r></w:p></w:tc>'],
    ['changed paragraph properties', '<w:pPr><w:pPrChange><w:pPr/></w:pPrChange></w:pPr>'],
  ])("rejects a Word %s before sending ambiguous evidence to the provider", async (_label, revision) => {
    const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    const file = office("revised.docx", {
      "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>Current instructions.</w:t></w:r>${revision}</w:p></w:body></w:document>`,
    });
    const response = await handleSopRequest(upload({ file }), env, async () => moderator);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: expect.stringContaining("Accept or reject all changes in Word") });
    expect(provider).not.toHaveBeenCalled();
  });
  it("extracts resolved Word instructions without confusing ordinary attributes with revisions", async () => {
    const result = await prepareDocument(office("resolved.docx", {
      "word/document.xml": '<w:document><w:body><w:p w:rsidR="revision-id"><w:r><w:t>Enable validation.</w:t></w:r></w:p></w:body></w:document>',
    }), "D1");
    expect(result.parts).toContainEqual({ text: "Source block D1-B1 (paragraph): Enable validation." });
  });
  it("reads Excel shared strings, inline text, coordinates, sheet names and cached formulas", async () => {
    const result = await prepareDocument(office("sample.xlsx", {
      "xl/workbook.xml": '<workbook><sheets><sheet name="Procedure" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml": '<sst><si><t>Open Settings</t></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Create team</t></is></c><c r="C1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
      "xl/media/image1.png": fakePng,
    }), "D2");
    const text = result.parts.filter((part) => "text" in part).map((part) => part.text).join("\n");
    expect(text).toContain("Sheet: Procedure"); expect(text).toContain("A1: Open Settings"); expect(text).toContain("B1: Create team"); expect(text).toContain("cached values may be stale");
    expect(result.parts.some((part) => "inlineData" in part)).toBe(true);
  });
  it("passes PDF visual content intact and refuses renamed or encrypted PDFs", async () => {
    const file = new File(["%PDF-1.7\nsynthetic"], "sample.pdf");
    const result = await prepareDocument(file, "D1");
    expect(result.parts).toContainEqual({ inlineData: { mimeType: "application/pdf", data: btoa("%PDF-1.7\nsynthetic") } });
    await expect(prepareDocument(new File(["fake"], "fake.pdf"), "D1")).rejects.toThrow("not a valid PDF");
    await expect(prepareDocument(new File(["%PDF-1.7 /Encrypt 1 0 R"], "locked.pdf"), "D1")).rejects.toThrow("encrypted");
  });
  it("rejects legacy extensions, empty files, and aggregate payloads beyond the transport limit", () => {
    expect(sopFileError([{ name: "old.doc", size: 12 }])).toContain("Convert older");
    expect(sopFileError([{ name: "empty.pdf", size: 0 }])).toContain("empty");
    expect(sopFileError([{ name: "one.pdf", size: SOP_LIMITS.totalBytes }, { name: "two.pdf", size: 1 }])).toContain("per request");
  });
  it("rejects macros, XML entities, mismatched containers, and oversized expanded files", async () => {
    await expect(prepareDocument(office("macro.docx", { "word/vbaProject.bin": "macro", "word/document.xml": "<w:document/>" }), "D1")).rejects.toThrow("Macros");
    await expect(prepareDocument(office("entity.docx", { "word/document.xml": '<!DOCTYPE x [<!ENTITY e "value">]><x>&e;</x>' }), "D1")).rejects.toThrow("XML");
    await expect(prepareDocument(office("wrong.docx", { "xl/workbook.xml": "<workbook/>" }), "D1")).rejects.toThrow("extension");
    await expect(prepareDocument(office("large.docx", { "word/document.xml": new Uint8Array(9 * 1024 * 1024) }), "D1")).rejects.toThrow("expands");
  });
  it("refuses unsupported visuals instead of silently omitting screenshots", async () => {
    await expect(prepareDocument(office("drawing.docx", { "word/document.xml": "<w:document/>", "word/media/image.emf": "unsupported" }), "D1")).rejects.toThrow("unsupported image");
  });
});

describe("SOP access and generation", () => {
  it("rejects unauthenticated, inactive, Basic and wrong-team users before any AI call", async () => {
    const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    expect((await handleSopRequest(upload(), env, async () => null)).status).toBe(401);
    expect((await handleSopRequest(upload(), env, async () => ({ ...moderator, accountStatus: "suspended" }))).status).toBe(403);
    expect((await handleSopRequest(upload(), env, async () => ({ ...moderator, teamRoles: [{ teamId: "team-1", teamName: "Support", role: "basic" }] }))).status).toBe(403);
    expect((await handleSopRequest(upload({ teamId: "team-2" }), env, async () => moderator)).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
  it("accepts production requests and rejects cross-origin requests before authentication", async () => {
    const session = vi.fn(async () => moderator);
    expect((await handleSopRequest(upload({ origin: "https://evil.example" }), env, session)).status).toBe(403);
    expect(session).not.toHaveBeenCalled();
    const provider = vi.fn(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ pdfBlocks: [], suggestions: [], openQuestions: [] }) }] } }] }));
    vi.stubGlobal("fetch", provider);
    const productionEnv = { ...env, APP_ORIGIN: "https://tds.example" };
    expect((await handleSopRequest(upload({ url: "https://tds.example/api/sops/generate" }), productionEnv, async () => moderator)).status).toBe(200);
  });
  it("rejects oversized multipart bodies", async () => {
    const request = upload(); request.headers.set("content-length", String(100 * 1024 * 1024));
    expect((await handleSopRequest(request, env, async () => moderator)).status).toBe(400);
  });
  it("sends Office content to the configured model without optional edits", async () => {
    const provider = vi.fn(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ pdfBlocks: [], suggestions: [], openQuestions: [] }) }] } }] }));
    vi.stubGlobal("fetch", provider);
    const response = await handleSopRequest(upload({ notes: "Use the sample workspace." }), env, async () => moderator);
    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    const call = provider.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[1].body)).toContain("Open Settings");
    expect(String(call[1].body)).toContain("Use the sample workspace.");
  });
  it("uses the configured model for optional edits and preserves the imported source", async () => {
    const provider = vi.fn(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ pdfBlocks: [], suggestions: [], openQuestions: [] }) }] } }] }));
    vi.stubGlobal("fetch", provider);
    const response = await handleSopRequest(upload({ notes: "Use the sample workspace.", suggestEdits: true }), env, async () => moderator);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.content.blocks.some((block: { runs?: { text: string }[] }) => block.runs?.some((run) => run.text.includes("Open Settings")))).toBe(true); expect(result.sources.map((source: { id: string }) => source.id)).toEqual(["D1", "N1"]);
    expect(result).not.toHaveProperty("published"); expect(response.headers.get("cache-control")).toBe("no-store");
    const call = provider.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toContain("configured-model:generateContent");
    expect(String(call[1].body)).toContain("Use the sample workspace.");
  });
  it("does not return a result after team access is revoked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ pdfBlocks: [], suggestions: [], openQuestions: [] }) }] } }] })));
    const session = vi.fn().mockResolvedValueOnce(moderator).mockResolvedValueOnce({ ...moderator, teamRoles: [] });
    expect((await handleSopRequest(upload(), env, session)).status).toBe(403);
  });
  it("returns safe errors for provider failure and invalid evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("SECRET provider diagnostic", { status: 429 })));
    const response = await handleSopRequest(upload({ file: new File(["%PDF-1.7 synthetic"], "sample.pdf") }), env, async () => moderator);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("SECRET");
    expect(() => validateSopDraft({ ...draft, steps: [{ ...draft.steps[0], sourceIds: ["D999"] }] }, ["D1"])).toThrow();
    expect(() => validateSopDraft({ ...draft, steps: [] }, ["D1"])).toThrow();
  });
  it("explains invalid credentials without exposing provider diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("SECRET invalid credential", { status: 401 })));
    const response = await handleSopRequest(upload({ file: new File(["%PDF-1.7 synthetic"], "sample.pdf") }), env, async () => moderator);
    expect(response.status).toBe(503);
    const message = await response.text();
    expect(message).toContain("Gemini rejected the configured credentials"); expect(message).not.toContain("SECRET");
  });
  it("exports the edited draft with an unpublished label and source names", () => {
    const markdown = sopMarkdown({ draft, sources: [{ id: "D1", name: "sample.docx", kind: "docx", warnings: [] }], generatedAt: "2026-09-18", teamId: "team-1" });
    expect(markdown).toContain("Unpublished AI draft"); expect(markdown).toContain("D1: sample.docx"); expect(markdown).toContain("### 1. Open Settings");
  });
});
