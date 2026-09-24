import { describe, expect, it } from "vitest";
import { embeddingBaseUrl, embeddingConfigured, embeddingKey, embeddingModel, embeddingProvider, integrationStatus } from "./integration-status.js";

const configured = {
  WEBEX_CLIENT_ID: "client",
  WEBEX_CLIENT_SECRET: "secret",
  WEBEX_REDIRECT_URI: "http://localhost/callback",
  SESSION_ENCRYPTION_KEY: "session-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "supabase-secret",
};

describe("integrationStatus", () => {
  it("requires both Supabase URL and a server-side key", () => {
    expect(integrationStatus(configured).supabaseConfigured).toBe(true);
    expect(integrationStatus({ ...configured, SUPABASE_SECRET_KEY: "" }).supabaseConfigured).toBe(false);
    expect(integrationStatus({ ...configured, SUPABASE_URL: "" }).supabaseConfigured).toBe(false);
  });

  it("accepts the legacy service-role key during migration", () => {
    expect(integrationStatus({ ...configured, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "legacy-key" }).supabaseConfigured).toBe(true);
  });

  it("configures local Ollama without a hosted API key", () => {
    expect(integrationStatus({ ...configured, LLM_PROVIDER: "ollama", LLM_MODEL: "qwen2.5vl:3b" })).toMatchObject({ llmConfigured: true, llmProvider: "ollama", llmModel: "qwen2.5vl:3b" });
  });

  it("allows one Gemini key to power generation and embeddings", () => {
    const env = { ...configured, GEMINI_AI_API: "generation-only" };
    expect(embeddingConfigured(env)).toBe(true);
    expect(integrationStatus(env)).toMatchObject({
      llmConfigured: true,
      embeddingConfigured: true,
      embeddingProvider: "gemini",
      embeddingModel: "gemini-embedding-2",
    });
  });

  it("prefers a dedicated embedding key when configured", () => {
    expect(embeddingKey({ GEMINI_AI_API: "shared", EMBEDDING_API_KEY: "embedding-only" })).toBe("embedding-only");
  });

  it("normalizes an Ollama embedding configuration", () => {
    const env = { EMBEDDING_PROVIDER: " OLLAMA ", EMBEDDING_MODEL: "nomic-embed-text", EMBEDDING_BASE_URL: "http://host:11434///" };
    expect(embeddingProvider(env)).toBe("ollama");
    expect(embeddingModel(env)).toBe("nomic-embed-text");
    expect(embeddingBaseUrl(env)).toBe("http://host:11434");
    expect(embeddingConfigured(env)).toBe(true);
  });
});
