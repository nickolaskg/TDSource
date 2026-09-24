import { describe, expect, it } from "vitest";
import { buildKnowledgeContext, chatQuestion, mergeRankedKnowledge, parseChatResponse, rankKnowledge, type KnowledgeRecord } from "./chat.js";

const records: KnowledgeRecord[] = [
  { id: "a", title: "Reset a password", summary: "Use Settings to reset it.", problem: "Password expired", steps: ["Open Settings", "Choose Reset password"], warnings: [] },
  { id: "b", title: "Request access", summary: "Ask a moderator.", problem: "Access missing", steps: ["Open the access form"], warnings: [] },
];

describe("knowledge chat helpers", () => {
  it("ranks matching title and body content", () => {
    expect(rankKnowledge("How do I reset my password?", records).map(({ id }) => id)).toEqual(["a"]);
    expect(rankKnowledge("Where is the CCWR quote workflow?", [{ ...records[0], sourceText: "Create the CCWR quote in the quoting tool." }]).map(({ id }) => id)).toEqual(["a"]);
  });

  it("builds numbered, redacted source context", () => {
    const context = buildKnowledgeContext(rankKnowledge("password", records));
    expect(context).toContain("[S1]");
    expect(context).toContain("Reset a password");
    expect(buildKnowledgeContext(rankKnowledge("quote", [{ ...records[0], summary: "Quote number Q-1234" }]))).toContain("[QUOTE_NUMBER_1]");
  });

  it("prefers semantic matches, removes duplicates, and keeps lexical fallback", () => {
    const lexical = rankKnowledge("password access", records);
    const semantic = [{ ...records[1], score: 95 }];
    expect(mergeRankedKnowledge(semantic, lexical).map(({ id }) => id)).toEqual(["b", "a"]);
    expect(mergeRankedKnowledge([], lexical).map(({ id }) => id)).toEqual(lexical.map(({ id }) => id));
  });

  it("validates questions and limits citation indexes", () => {
    expect(chatQuestion(" ")).toBeNull();
    expect(chatQuestion("Where? ")).toBe("Where?");
    expect(parseChatResponse({ answer: "Use Settings.", citations: [1, 1, 9, "2"] }, 2)).toEqual({ answer: "Use Settings.", citations: [1] });
    expect(parseChatResponse({ answer: "", citations: [] }, 2)).toBeNull();
  });
});
