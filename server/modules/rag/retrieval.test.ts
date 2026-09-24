import { describe, expect, it, vi } from "vitest";
import { buildKnowledgeChunkSearchBody, RAG_EMBEDDING_DIMENSIONS, retrieveKnowledgeChunks, toPgVector } from "./retrieval.js";

const embedding = Array.from({ length: RAG_EMBEDDING_DIMENSIONS }, (_, index) => index / RAG_EMBEDDING_DIMENSIONS);

describe("RAG retrieval boundary", () => {
  it("serializes the fixed-size embedding and clamps search controls", () => {
    const body = buildKnowledgeChunkSearchBody({ organizationId: "org", userId: "user", embedding, embeddingModel: "gemini-embedding-2", matchCount: 999, minSimilarity: 4 });
    expect(body).toMatchObject({ p_organization_id: "org", p_user_id: "user", p_embedding_model: "gemini-embedding-2", p_match_count: 50, p_min_similarity: 1 });
    expect(body.p_query_embedding).toBe(toPgVector(embedding));
  });

  it("rejects malformed embeddings before database access", () => {
    expect(() => toPgVector([1, 2])).toThrow(/exactly 768/);
    const invalid = [...embedding]; invalid[4] = Number.NaN;
    expect(() => toPgVector(invalid)).toThrow(/finite/);
  });

  it("calls the visibility-filtered RPC and returns its rows", async () => {
    const rows = [{ chunk_id: "chunk", document_id: "doc", document_version_id: "version", chunk_index: 0, content: "text", source_locator: {}, similarity: 0.9 }];
    const db = vi.fn().mockResolvedValue(rows);
    await expect(retrieveKnowledgeChunks(db, { organizationId: "org", userId: "user", embedding, embeddingModel: "gemini-embedding-2" })).resolves.toEqual(rows);
    expect(db).toHaveBeenCalledWith("rpc/search_knowledge_chunks", expect.objectContaining({ method: "POST" }));
  });
});
