import { redactForLlm } from "../redaction/redact.js";

export interface KnowledgeRecord {
  id: string;
  title: string;
  summary: string;
  problem: string;
  steps: string[];
  warnings: string[];
  sourceText?: string;
}

export interface RankedKnowledge extends KnowledgeRecord {
  score: number;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const maxHistoryMessages = 6;
const maxHistoryCharacters = 12000;

const tokenPattern = /[a-z0-9]{2,}/gi;

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().match(tokenPattern) || [])];
}

export function rankKnowledge(query: string, records: readonly KnowledgeRecord[], limit = 6): RankedKnowledge[] {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return [];
  return records.map((record) => {
    const title = tokens(record.title);
    const body = tokens([record.summary, record.problem, ...record.steps, ...record.warnings, record.sourceText || ""].join(" "));
    const score = queryTokens.reduce((total, token) => total + (title.includes(token) ? 4 : 0) + (body.includes(token) ? 1 : 0), 0);
    return { ...record, score };
  }).filter((record) => record.score > 0).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title)).slice(0, limit);
}

export function mergeRankedKnowledge(vector: readonly RankedKnowledge[], lexical: readonly RankedKnowledge[], limit = 6): RankedKnowledge[] {
  return [...vector, ...lexical]
    .filter((record, index, all) => all.findIndex(({ id }) => id === record.id) === index)
    .slice(0, Math.max(0, limit));
}

export function buildKnowledgeContext(records: readonly RankedKnowledge[]): string {
  return records.map((record, index) => {
    const source = `S${index + 1}`;
    const text = [
      `Title: ${record.title}`,
      `Summary: ${record.summary}`,
      `Problem: ${record.problem}`,
      record.steps.length ? `Steps:\n${record.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join("\n")}` : "",
      record.warnings.length ? `Warnings:\n${record.warnings.join("\n")}` : "",
      record.sourceText ? `Source transcript:\n${record.sourceText}` : "",
    ].filter(Boolean).join("\n");
    return `[${source}]\n${redactForLlm(text).sanitizedText}`;
  }).join("\n\n");
}

export function parseChatResponse(value: unknown, sourceCount: number): { answer: string; citations: number[] } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { answer?: unknown; citations?: unknown };
  if (typeof body.answer !== "string" || !body.answer.trim() || !Array.isArray(body.citations)) return null;
  const citations = [...new Set(body.citations)].filter((item): item is number => Number.isInteger(item) && item >= 1 && item <= sourceCount);
  return { answer: body.answer.trim(), citations };
}

export function chatQuestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const question = value.trim();
  return question.length >= 2 && question.length <= 4000 ? question : null;
}

export function chatHistory(value: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(value)) return [];
  let characters = 0;
  const messages: ChatHistoryMessage[] = [];
  for (const item of value.slice(-maxHistoryMessages)) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const normalized = content.trim().slice(0, 4000);
    if (!normalized || characters + normalized.length > maxHistoryCharacters) break;
    messages.push({ role, content: normalized });
    characters += normalized.length;
  }
  return messages;
}

export function buildRetrievalQuery(question: string, history: readonly ChatHistoryMessage[]): string {
  const recentQuestions = history.filter(({ role }) => role === "user").slice(-2).map(({ content }) => content);
  return [...recentQuestions, question].join("\n").slice(-6000);
}

export function buildConversationContext(history: readonly ChatHistoryMessage[]): string {
  if (!history.length) return "No earlier messages in this conversation.";
  return history.map(({ role, content }) => `${role === "user" ? "User" : "Assistant"}: ${redactForLlm(content).sanitizedText}`).join("\n\n");
}
