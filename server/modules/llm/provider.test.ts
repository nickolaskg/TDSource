import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLlmJson } from "./provider.js";

afterEach(() => vi.unstubAllGlobals());

describe("LLM provider adapter", () => {
  it("sends text, images, model, and JSON schema to local Ollama", async () => {
    const fetcher = vi.fn(async () => Response.json({ message: { content: JSON.stringify({ ok: true }) } }));
    vi.stubGlobal("fetch", fetcher);
    const schema = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };
    await expect(requestLlmJson({
      env: { LLM_PROVIDER: "ollama", LLM_MODEL: "qwen2.5vl:3b", LLM_BASE_URL: "http://127.0.0.1:11434/" },
      systemPrompt: "Return structured output.",
      parts: [{ text: "Read this source." }, { inlineData: { mimeType: "image/png", data: "image-data" } }],
      schema,
    })).resolves.toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "qwen2.5vl:3b", stream: false, format: schema, messages: [{ role: "system" }, { role: "user", images: ["image-data"] }], options: { num_ctx: 16384 } });
  });

  it("rejects raw PDF input before contacting a local vision model", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(requestLlmJson({
      env: { LLM_PROVIDER: "ollama" }, systemPrompt: "Parse.", schema: { type: "object" },
      parts: [{ inlineData: { mimeType: "application/pdf", data: "pdf-data" } }],
    })).rejects.toThrow("does not accept raw PDF files");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
