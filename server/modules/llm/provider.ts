import { geminiKey, llmBaseUrl, llmModel, llmProvider, type IntegrationEnvironment } from "../config/integration-status.js";

export type LlmPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export interface LlmEnvironment extends IntegrationEnvironment { LLM_MODEL?: string; }
export class LlmProviderError extends Error {
  constructor(message: string, readonly status: number, readonly provider: "gemini" | "ollama", readonly retryable = false) { super(message); }
}

interface RequestOptions {
  env: LlmEnvironment;
  systemPrompt: string;
  parts: LlmPart[];
  schema: Record<string, unknown>;
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

function ollamaPayload(options: RequestOptions) {
  const images: string[] = [];
  const text = options.parts.map((part) => {
    if ("text" in part) return part.text;
    if (!part.inlineData.mimeType.startsWith("image/")) throw new LlmProviderError("The selected Ollama model does not accept raw PDF files. Upload a DOCX/XLSX source or switch LLM_PROVIDER=gemini for PDF parsing.", 415, "ollama");
    images.push(part.inlineData.data);
    return `[Image attached: ${part.inlineData.mimeType}]`;
  }).join("\n");
  return {
    model: llmModel(options.env),
    messages: [{ role: "system", content: options.systemPrompt }, { role: "user", content: text, ...(images.length ? { images } : {}) }],
    stream: false,
    format: options.schema,
    options: {
      temperature: 0.1,
      num_ctx: Math.max(4096, Number(options.env.LLM_CONTEXT_TOKENS) || 16384),
      ...(options.maxOutputTokens ? { num_predict: options.maxOutputTokens } : {}),
    },
  };
}

export async function requestLlmJson(options: RequestOptions): Promise<unknown> {
  const provider = llmProvider(options.env);
  if (provider === "ollama") {
    const response = await fetch(`${llmBaseUrl(options.env)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.env.LLM_API_KEY?.trim() ? { authorization: `Bearer ${options.env.LLM_API_KEY.trim()}` } : {}) },
      body: JSON.stringify(ollamaPayload(options)),
      signal: options.signal,
    });
    if (!response.ok) throw new LlmProviderError(`Ollama request failed with status ${response.status}.`, response.status, provider, [500, 502, 503].includes(response.status));
    const payload = await response.json() as { message?: { content?: string } };
    const output = payload.message?.content?.trim();
    if (!output) throw new LlmProviderError("Ollama returned no structured response.", 502, provider);
    return JSON.parse(output);
  }

  const apiKey = geminiKey(options.env);
  if (!apiKey) throw new LlmProviderError("Gemini is not configured.", 503, provider);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(llmModel(options.env))}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: options.systemPrompt }] },
      contents: [{ role: "user", parts: options.parts }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseJsonSchema: options.schema, ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(llmModel(options.env) === "gemini-2.5-flash" ? { thinkingConfig: { thinkingBudget: 1024 } } : {}),
      },
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new LlmProviderError(`Gemini request failed with status ${response.status}.`, response.status, provider, [500, 502, 503].includes(response.status));
  const payload = await response.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason !== "STOP") throw new LlmProviderError("Gemini returned an incomplete response.", 502, provider);
  const output = candidate.content?.parts?.filter((part) => !part.thought).map((part) => part.text || "").join("").trim();
  if (!output) throw new LlmProviderError("Gemini returned no structured response.", 502, provider);
  return JSON.parse(output);
}
