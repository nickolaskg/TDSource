import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSop, handleSopRequest, type SopSession } from "./generate.js";
const env = { APP_ORIGIN: "http://localhost:5173", GEMINI_AI_API: "synthetic-secret", LLM_MODEL: "gemini-2.5-flash" };
const session: SopSession = { appUserId: "reliability-user", accountStatus: "active", teamRoles: [{ teamId: "team-1", teamName: "Test", role: "moderator" }] };
const sample = () => new File(["%PDF-1.7\nsynthetic-content"], "synthetic-filename.pdf");
const draft = { pdfBlocks: [{ sourceId: "D1", page: 1, type: "paragraph", runs: [{ text: "Inspect the sample." }] }], suggestions: [], openQuestions: [] };
const success = () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(draft) }] } }] });
function upload(signal?: AbortSignal) {
  const body = new FormData();
  body.set("teamId", "team-1"); body.set("sampleConfirmed", "true"); body.set("notes", "synthetic-notes"); body.append("files", sample());
  return new Request(`${env.APP_ORIGIN}/api/sops/generate`, { method: "POST", headers: { origin: env.APP_ORIGIN }, body, signal });
}
beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("SOP provider reliability", () => {
  it.each(["gemini-2.5-flash", "future-model"])("only applies supported thinking settings to %s", async (model) => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { calls.push(init); return success(); }));
    await generateSop([sample()], "", "", "team-1", { ...env, LLM_MODEL: model });
    const config = JSON.parse(String(calls[0].body)).generationConfig;
    expect(config.maxOutputTokens).toBe(12000);
    if (model === "gemini-2.5-flash") expect(config.thinkingConfig).toEqual({ thinkingBudget: 1024 });
    else expect(config).not.toHaveProperty("thinkingConfig");
  });
  it.each([500, 502, 503])("retries HTTP %s once under the same 180-second deadline", async (status) => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { calls.push(init); return calls.length === 1 ? new Response("private details", { status }) : success(); }));
    expect((await handleSopRequest(upload(), env, async () => session)).status).toBe(200);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(180_000);
    expect(calls).toHaveLength(2); expect(calls[0].signal).toBe(calls[1].signal);
  });
  it("returns safe busy guidance after both attempts and releases the running guard", async () => {
    const fetcher = vi.fn(async () => new Response("private provider details", { status: 503 })); vi.stubGlobal("fetch", fetcher);
    const response = await handleSopRequest(upload(), env, async () => session);
    expect(response.status).toBe(503); const body = await response.text();
    expect(body).toContain("temporarily unavailable or busy"); expect(body).not.toContain("private provider details"); expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockImplementation(async () => success());
    expect((await handleSopRequest(upload(), env, async () => session)).status).toBe(200);
  });
  it.each([400, 429, 504])("does not retry HTTP %s", async (status) => {
    const fetcher = vi.fn(async () => new Response("private details", { status })); vi.stubGlobal("fetch", fetcher);
    const response = await handleSopRequest(upload(), env, async () => session);
    expect(response.ok).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1); expect(await response.text()).not.toContain("private details");
  });
  it("does not retry an ambiguous connection failure", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("private details"); }); vi.stubGlobal("fetch", fetcher);
    const response = await handleSopRequest(upload(), env, async () => session);
    expect(response.status).toBe(502); expect(fetcher).toHaveBeenCalledTimes(1); expect(await response.text()).not.toContain("private details");
  });
  it.each(["cancel", "deadline"])("propagates %s through the shared signal without retrying", async (reason) => {
    const client = new AbortController(); const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal!;
      const pending = new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      if (reason === "cancel") client.abort(); else deadline.abort(new DOMException("synthetic timeout", "TimeoutError"));
      return pending;
    }); vi.stubGlobal("fetch", fetcher);
    const response = await handleSopRequest(upload(client.signal), env, async () => session);
    expect(response.status).toBe(reason === "cancel" ? 499 : 504);
    expect(await response.text()).toContain(reason === "cancel" ? "canceled" : "3 minutes"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["provider", "draft"])("handles malformed %s JSON safely without retrying", async (kind) => {
    const fetcher = vi.fn(async () => kind === "provider" ? new Response("private malformed contents") : Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "private malformed contents" }] } }] })); vi.stubGlobal("fetch", fetcher);
    const response = await handleSopRequest(upload(), env, async () => session);
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("private malformed contents"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("includes timing metadata without filenames, document text, notes or keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => success()));
    const response = await handleSopRequest(upload(), env, async () => session);
    expect(response.status).toBe(200);
    for (const phase of ["total", "extraction", "provider", "validation"]) expect(response.headers.get("server-timing")).toMatch(new RegExp(`sop_${phase};dur=\\d+`));
    const headers: Record<string, string> = {}; response.headers.forEach((value, key) => { headers[key] = value; });
    const metadata = JSON.stringify({ headers, logs: vi.mocked(console.info).mock.calls });
    for (const sensitive of ["synthetic-filename.pdf", "synthetic-content", "synthetic-notes", env.GEMINI_AI_API]) expect(metadata).not.toContain(sensitive);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
