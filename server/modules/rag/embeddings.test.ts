import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbedding, EmbeddingProviderError } from "./embeddings.js";
import { RAG_EMBEDDING_DIMENSIONS } from "./retrieval.js";

const vector = Array.from({ length: RAG_EMBEDDING_DIMENSIONS }, (_, index) => index / RAG_EMBEDDING_DIMENSIONS);

afterEach(() => vi.unstubAllGlobals());

describe("embedding providers", () => {
  it("requests a fixed-size Gemini embedding with its separate API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ embedding: { values: vector } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createEmbedding({
      env: { EMBEDDING_PROVIDER: "gemini", EMBEDDING_MODEL: "embedding-model", EMBEDDING_API_KEY: "embedding-secret", GEMINI_AI_API: "generation-secret" },
      text: "  knowledge text  ",
    })).resolves.toEqual(vector);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("models/embedding-model:embedContent");
    expect(init.headers).toMatchObject({ "x-goog-api-key": "embedding-secret" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "models/embedding-model",
      content: { parts: [{ text: "Represent this approved internal knowledge for question answering retrieval:\nknowledge text" }] },
      output_dimensionality: RAG_EMBEDDING_DIMENSIONS,
    });
  });

  it("requests an Ollama embedding from its independent endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ embeddings: [vector] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createEmbedding({
      env: { EMBEDDING_PROVIDER: "ollama", EMBEDDING_MODEL: "local-embed", EMBEDDING_BASE_URL: "http://embedding-host:11434/", EMBEDDING_API_KEY: "local-key" },
      text: "knowledge text",
    })).resolves.toEqual(vector);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://embedding-host:11434/api/embed");
    expect(init.headers).toMatchObject({ authorization: "Bearer local-key" });
    expect(JSON.parse(String(init.body))).toEqual({ model: "local-embed", input: "Represent this approved internal knowledge for question answering retrieval:\nknowledge text", dimensions: RAG_EMBEDDING_DIMENSIONS });
  });

  it("rejects malformed provider output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ embedding: { values: [1, 2] } }), { status: 200 })));
    await expect(createEmbedding({ env: { EMBEDDING_API_KEY: "key" }, text: "knowledge" })).rejects.toMatchObject({
      status: 502,
      provider: "gemini",
      retryable: false,
    });
  });

  it("marks throttling and network failures as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    await expect(createEmbedding({ env: { EMBEDDING_API_KEY: "key" }, text: "knowledge" })).rejects.toMatchObject({ status: 429, retryable: true });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(createEmbedding({ env: { EMBEDDING_API_KEY: "key" }, text: "knowledge" })).rejects.toEqual(expect.objectContaining({
      status: 503,
      retryable: true,
    }));
  });

  it("requires a Gemini key and non-empty text", async () => {
    await expect(createEmbedding({ env: {}, text: "knowledge" })).rejects.toBeInstanceOf(EmbeddingProviderError);
    await expect(createEmbedding({ env: { EMBEDDING_API_KEY: "key" }, text: "  " })).rejects.toMatchObject({ status: 400, retryable: false });
  });
});
