import {
  embeddingBaseUrl,
  embeddingKey,
  embeddingModel,
  embeddingProvider,
  type IntegrationEnvironment,
} from "../config/integration-status.js";
import { RAG_EMBEDDING_DIMENSIONS } from "./retrieval.js";

export type EmbeddingEnvironment = IntegrationEnvironment;

export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: "gemini" | "ollama",
    readonly retryable = false,
  ) {
    super(message);
  }
}

interface EmbeddingRequest {
  env: EmbeddingEnvironment;
  text: string;
  purpose?: "document" | "query";
  signal?: AbortSignal;
}

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);

function validateEmbedding(value: unknown, provider: "gemini" | "ollama"): number[] {
  if (!Array.isArray(value) || value.length !== RAG_EMBEDDING_DIMENSIONS || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new EmbeddingProviderError(
      `${provider === "gemini" ? "Gemini" : "Ollama"} returned an invalid embedding; expected exactly ${RAG_EMBEDDING_DIMENSIONS} finite values.`,
      502,
      provider,
    );
  }
  return value as number[];
}

async function fetchEmbedding(url: string, init: RequestInit, provider: "gemini" | "ollama"): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new EmbeddingProviderError(`${provider === "gemini" ? "Gemini" : "Ollama"} embedding request could not reach the provider.`, 503, provider, true);
  }
}

export async function createEmbedding({ env, text, purpose = "document", signal }: EmbeddingRequest): Promise<number[]> {
  const provider = embeddingProvider(env);
  const input = text.trim();
  if (!input) throw new EmbeddingProviderError("Embedding input must not be empty.", 400, provider);
  const instructedInput = purpose === "query"
    ? `Retrieve approved internal knowledge that answers this question:\n${input}`
    : `Represent this approved internal knowledge for question answering retrieval:\n${input}`;

  if (provider === "ollama") {
    const response = await fetchEmbedding(`${embeddingBaseUrl(env)}/api/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.EMBEDDING_API_KEY?.trim() ? { authorization: `Bearer ${env.EMBEDDING_API_KEY.trim()}` } : {}),
      },
      body: JSON.stringify({ model: embeddingModel(env), input: instructedInput, dimensions: RAG_EMBEDDING_DIMENSIONS }),
      signal,
    }, provider);
    if (!response.ok) throw new EmbeddingProviderError(`Ollama embedding request failed with status ${response.status}.`, response.status, provider, retryableStatuses.has(response.status));
    const payload = await response.json() as { embeddings?: unknown[] };
    return validateEmbedding(payload.embeddings?.[0], provider);
  }

  const apiKey = embeddingKey(env);
  if (!apiKey) throw new EmbeddingProviderError("Gemini embeddings are not configured.", 503, provider);
  const model = embeddingModel(env);
  const response = await fetchEmbedding(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text: instructedInput }] },
      output_dimensionality: RAG_EMBEDDING_DIMENSIONS,
    }),
    signal,
  }, provider);
  if (!response.ok) throw new EmbeddingProviderError(`Gemini embedding request failed with status ${response.status}.`, response.status, provider, retryableStatuses.has(response.status));
  const payload = await response.json() as { embedding?: { values?: unknown } };
  return validateEmbedding(payload.embedding?.values, provider);
}
