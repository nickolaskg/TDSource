import { z } from "zod";
import { SOP_LIMITS, sopFileError, type SopResult } from "../../../src/domain/sop.js";
import { type SopBlock, type SopContent } from "../../../src/domain/sop-content.js";
import { faithfulPrompt, faithfulResponseSchema, validateFaithfulResponse } from "./faithful-ai.js";
import { llmConfigured, llmModel, llmProvider, type IntegrationEnvironment } from "../config/integration-status.js";
import { LlmProviderError, requestLlmJson, type LlmPart } from "../llm/provider.js";
import { redactForLlm } from "../redaction/redact.js";
import { prepareDocument, SopInputError } from "./documents.js";

export interface SopEnvironment extends IntegrationEnvironment { APP_ORIGIN?: string; LLM_MODEL?: string }
export const SOP_PROVIDER_TIMEOUT_MS = 180_000;
export interface SopTimings { phase?: string; extractionMs?: number; providerMs?: number; validationMs?: number; providerStatus?: number; providerAttempts?: number }
export interface SopSession {
  appUserId?: string;
  accountStatus?: string;
  teamRoles?: Array<{ teamId: string; teamName: string; role: string }>;
}
const text = z.string().trim().min(1).max(8000);
const draftSchema = z.object({
  title: text.max(200), summary: text,
  prerequisites: z.array(text).max(30),
  steps: z.array(z.object({ title: text.max(200), instruction: text, sourceIds: z.array(z.string()).min(1).max(6) })).min(1).max(50),
  warnings: z.array(text).max(30), openQuestions: z.array(text).max(30),
});
const running = new Set<string>();
const MAX_REQUEST = SOP_LIMITS.totalBytes + 128 * 1024;
class SopProviderError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
function error(message: string, status: number): Response { return json({ message }, status); }
function retryDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export function localOrigin(value: string): boolean {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); } catch { return false; }
}

// Count the stream, not just Content-Length, before buffering a multipart upload.
async function readForm(request: Request): Promise<FormData> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) throw new SopInputError("Choose documents using the upload form.");
  if (Number(request.headers.get("content-length")) > MAX_REQUEST) throw new SopInputError("This upload exceeds the 25 MB request limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new SopInputError("The upload is empty.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST) { await reader.cancel(); throw new SopInputError("This upload exceeds the 25 MB request limit."); }
      chunks.push(new Uint8Array(value));
    }
    return await new Response(new Blob(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  } catch (cause) {
    if (cause instanceof SopInputError) throw cause;
    throw new SopInputError("The upload could not be read. Select the files again and retry.");
  } finally { reader.releaseLock(); }
}

export function validateSopDraft(value: unknown, sourceIds: string[]) {
  const draft = draftSchema.parse(value);
  if (draft.steps.some((step) => step.sourceIds.some((id) => !sourceIds.includes(id)))) throw new Error("Invalid source reference");
  return draft;
}

export async function generateSop(
  files: File[], notes: string, title: string, teamId: string, env: SopEnvironment,
  signal?: AbortSignal, timings: SopTimings = {}, suggestEdits = false,
): Promise<SopResult> {
  timings.phase = "extraction";
  const extractionStarted = performance.now();
  const parts: LlmPart[] = [];
  const sources: SopResult["sources"] = [];
  const blocks: SopBlock[] = [];
  let preparedSize = 0;
  for (const [index, file] of files.entries()) {
    if (signal?.aborted) throw new SopProviderError("SOP import was canceled. Your documents and notes are unchanged.", 499);
    const prepared = await prepareDocument(file, `D${index + 1}`);
    preparedSize += JSON.stringify(prepared.parts).length;
    if (preparedSize > 40 * 1024 * 1024) throw new SopInputError("The extracted documents exceed the AI request limit. Upload fewer or smaller documents.");
    parts.push(...prepared.parts); sources.push(prepared.source); blocks.push(...(prepared.blocks || []));
  }
  if (notes.trim()) {
    sources.push({ id: "N1", name: "Additional notes", kind: "notes", warnings: [] });
    blocks.push({ id: "N1-B1", sourceId: "N1", type: "heading", level: 2, runs: [{ text: "Additional notes" }] }, { id: "N1-B2", sourceId: "N1", type: "paragraph", runs: [{ text: notes }] });
    parts.push({ text: `Source N1, additional user notes: ${redactForLlm(notes).sanitizedText}` });
  }
  const pdfIds = sources.filter(({ kind }) => kind === "pdf").map(({ id }) => id);
  const content: SopContent = { blocks, suggestions: [], limitations: sources.flatMap(({ warnings }) => warnings) };
  const result: SopResult = {
    draft: { title: title.trim() || files[0].name.replace(/\.[^.]+$/, ""), summary: "Imported source procedure. Review against the original before use.", prerequisites: [], steps: [], warnings: [], openQuestions: [] },
    content, sources, teamId, generatedAt: new Date().toISOString(),
  };
  timings.extractionMs = Math.round(performance.now() - extractionStarted);
  if (!llmConfigured(env)) throw new SopProviderError("An AI provider must be configured to parse SOP documents.", 503);
  parts.push({ text: `PDF source IDs to transcribe: ${pdfIds.join(", ") || "none"}. Clarity edits requested: ${suggestEdits ? "yes" : "no"}. Return suggestions separately; do not rewrite Office content.` });
  // Office text is sent for source-aware validation and optional edits. The
  // current schema never consumes Office screenshots, so sending those large
  // image payloads only makes CPU-hosted vision models time out.
  const providerParts = pdfIds.length ? parts : parts.filter((part) => "text" in part);
  let ai: unknown;
  try {
    ai = await requestFaithfulAi(providerParts, env, signal, timings);
  } catch (cause) {
    if (pdfIds.length || suggestEdits || signal?.aborted) throw cause;
    content.limitations.push(cause instanceof SopProviderError ? cause.message : "AI suggestions could not be read.", "The original content was imported unchanged. You can retry optional AI edits later.");
    timings.phase = "complete";
    return result;
  }
  timings.phase = "validation";
  const validationStarted = performance.now();
  try {
    const checked = validateFaithfulResponse(ai, blocks, pdfIds, suggestEdits);
    content.blocks = sources.flatMap(({ id }) => [...blocks.filter(({ sourceId }) => sourceId === id), ...checked.pdfBlocks.filter(({ sourceId }) => sourceId === id)]);
    content.suggestions = checked.suggestions;
    content.limitations.push(...checked.limitations);
    if (pdfIds.length) content.limitations.push("PDF content is AI-transcribed, not a verified complete copy. Check every page against the original; screenshots remain in the original PDF and are represented by placeholders here.");
  } catch (cause) {
    if (pdfIds.length) throw cause;
    content.limitations.push("AI suggestions failed source validation. The original imported content is unchanged.");
  }
  timings.validationMs = Math.round(performance.now() - validationStarted);
  timings.phase = "complete";
  return result;
}

async function requestFaithfulAi(parts: LlmPart[], env: SopEnvironment, signal: AbortSignal | undefined, timings: SopTimings): Promise<unknown> {
  timings.phase = "provider";
  const providerStarted = performance.now();
  const provider = llmProvider(env);
  const providerName = provider === "ollama" ? "Ollama" : "Gemini";
  const deadline = AbortSignal.timeout(SOP_PROVIDER_TIMEOUT_MS);
  const providerSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const send = () => requestLlmJson({ env, systemPrompt: faithfulPrompt, parts, schema: faithfulResponseSchema, signal: providerSignal, maxOutputTokens: 12000 });
    timings.providerAttempts = 1;
    try {
      const result = await send();
      timings.providerStatus = 200;
      return result;
    } catch (cause) {
      if (!(cause instanceof LlmProviderError) || !cause.retryable) throw cause;
      timings.providerStatus = cause.status;
      await retryDelay(providerSignal);
      timings.providerAttempts = 2;
      const result = await send();
      timings.providerStatus = 200;
      return result;
    }
  } catch (cause) {
    if (signal?.aborted) throw new SopProviderError("SOP generation was canceled. Your documents and notes are unchanged.", 499);
    if (deadline.aborted || (cause instanceof Error && cause.name === "TimeoutError")) throw new SopProviderError(`${providerName} did not finish within 3 minutes. Your document was read successfully, but no draft was returned. Please try again.`, 504);
    if (cause instanceof SopProviderError) throw cause;
    if (cause instanceof LlmProviderError) {
      timings.providerStatus = cause.status;
      if (cause.message.includes("incomplete response")) throw new SopProviderError("Incomplete transcription", 502);
      if (cause.status === 415) throw new SopProviderError(cause.message, 400);
      if (cause.status === 401 || cause.status === 403) throw new SopProviderError(`${providerName} rejected the configured credentials. Update the AI provider credentials and try again.`, 503);
      if (cause.status === 429) throw new SopProviderError(`${providerName}'s quota or rate limit was reached. Check the provider account or wait before trying again.`, 503);
      if ([500, 502, 503].includes(cause.status)) throw new SopProviderError(`${providerName} is temporarily unavailable or busy. Your document was read successfully. Wait a moment, then try again.`, 503);
      if (cause.status === 504) throw new SopProviderError(`${providerName} timed out while generating the draft. Your document was read successfully. Please try again.`, 504);
      throw new SopProviderError(`${providerName} could not process these documents. Try smaller files or a different model.`, 502);
    }
    throw new SopProviderError(`The connection to ${providerName} was interrupted while waiting for the draft. Your document was read successfully. Please try again.`, 502);
  } finally { timings.providerMs = Math.round(performance.now() - providerStarted); }
}

export async function handleSopRequest(
  request: Request, env: SopEnvironment,
  readSession: () => Promise<SopSession | null>,
): Promise<Response> {
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) return error("Request origin was not accepted.", 403);
  const session = await readSession();
  if (!session?.appUserId) return error("Sign in again to create an SOP.", 401);
  const teams = session.accountStatus === "active" ? session.teamRoles?.filter(({ role }) => role === "admin" || role === "moderator") || [] : [];
  if (!teams.length) return error("An active Moderator or Admin role is required.", 403);
  const aiAvailable = llmConfigured(env);
  if (request.method === "GET") return json({ available: aiAvailable, aiAvailable, teams, provider: llmProvider(env), model: llmModel(env), providerTimeoutSeconds: SOP_PROVIDER_TIMEOUT_MS / 1000, message: aiAvailable ? "Ready to import SOP documents." : "Configure an AI provider before uploading SOP documents." });
  if (running.has(session.appUserId)) return error("An SOP is already being generated for your account. Wait for it to finish before retrying.", 429);
  running.add(session.appUserId);
  const requestId = crypto.randomUUID();
  const timings: SopTimings = { phase: "upload" };
  const started = performance.now();
  const finish = (body: unknown, status = 200) => {
    const response = json(body, status);
    response.headers.set("x-request-id", requestId);
    response.headers.set("server-timing", [
      `sop_total;dur=${Math.round(performance.now() - started)}`,
      ...(["extractionMs", "providerMs", "validationMs"] as const).filter((key) => timings[key] !== undefined).map((key) => `sop_${key.replace("Ms", "")};dur=${timings[key]}`),
    ].join(", "));
    // Operational metadata only: never filenames, notes, document text, images, keys, or provider bodies.
    console.info("SOP generation", { requestId, status, ...timings });
    return response;
  };
  try {
    const form = await readForm(request);
    const teamId = form.get("teamId");
    if (typeof teamId !== "string" || !teams.some((team) => team.teamId === teamId)) return error("You must be a Moderator or Admin in the selected team.", 403);
    const title = form.get("title") ?? "";
    const notes = form.get("notes") ?? "";
    if (typeof title !== "string" || typeof notes !== "string" || title.length > SOP_LIMITS.title || notes.length > SOP_LIMITS.notes) return error("The title or notes exceed the allowed length.", 400);
    const uploads = form.getAll("files");
    if (uploads.some((file) => typeof file === "string")) return error("Choose valid document files.", 400);
    const files = uploads as File[];
    const validation = sopFileError(files);
    if (validation) return error(validation, 400);
    const result = await generateSop(files, notes, title, teamId, env, request.signal, timings, form.get("suggestEdits") === "true");
    // Recheck permissions before returning content after a long provider call.
    const current = await readSession();
    if (current?.accountStatus !== "active" || !current.teamRoles?.some((team) => team.teamId === teamId && ["admin", "moderator"].includes(team.role))) return error("Your team access changed. Sign in again before continuing.", 403);
    return finish(result);
  } catch (cause) {
    if (cause instanceof SopInputError) return finish({ message: cause.message }, 400);
    if (cause instanceof SopProviderError) return finish({ message: cause.message }, cause.status);
    return finish({ message: "The AI response could not be validated as a complete SOP. Your documents and notes are unchanged. Please try again." }, 502);
  } finally { running.delete(session.appUserId); }
}
