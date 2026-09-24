import { describe, expect, it, vi } from "vitest";
import { RAG_EMBEDDING_DIMENSIONS } from "./retrieval.js";
import { indexKnowledgeVersion, removeKnowledgeVersionIndex } from "./indexing.js";

const embedding = Array(RAG_EMBEDDING_DIMENSIONS).fill(0.25);
const chunk = { chunkIndex: 0, content: "## Step 1\nOpen the console", tokenCount: 7, sourceLocator: { section: "Steps", step: 1 } };

describe("knowledge version indexing", () => {
  it("atomically replaces deterministic version rows through the guarded RPC", async () => {
    const db = vi.fn().mockResolvedValue(1);
    const embed = vi.fn().mockResolvedValue(embedding);
    await expect(indexKnowledgeVersion(db, { organizationId: "org", documentId: "doc", documentVersionId: "version", claimStartedAt: "2026-09-24T12:00:00Z", embeddingProvider: "gemini", embeddingModel: "embedding-001", chunks: [chunk], embed })).resolves.toBe(1);
    expect(embed).toHaveBeenCalledWith(chunk.content);
    expect(db).toHaveBeenCalledWith("rpc/replace_knowledge_chunks", expect.objectContaining({ method: "POST" }));
    const rows = JSON.parse(db.mock.calls[0][1].body);
    expect(rows).toMatchObject({ p_organization_id: "org", p_document_id: "doc", p_document_version_id: "version", p_claim_started_at: "2026-09-24T12:00:00Z", p_embedding_provider: "gemini", p_embedding_model: "embedding-001" });
    expect(rows.p_chunks[0]).toMatchObject({ chunk_index: 0, source_locator: chunk.sourceLocator, embedding });
    expect(rows.p_chunks[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("clears a version when no chunks remain", async () => {
    const db = vi.fn().mockResolvedValue(0);
    await indexKnowledgeVersion(db, { organizationId: "org", documentId: "doc", documentVersionId: "version", claimStartedAt: "2026-09-24T12:00:00Z", embeddingProvider: "gemini", embeddingModel: "embedding-001", chunks: [], embed: vi.fn() });
    expect(db).toHaveBeenCalledOnce();
    expect(JSON.parse(db.mock.calls[0][1].body).p_chunks).toEqual([]);
  });

  it("removes only the requested document version", async () => {
    const db = vi.fn().mockResolvedValue(undefined);
    await removeKnowledgeVersionIndex(db, "version/1");
    expect(db).toHaveBeenCalledWith("knowledge_chunks?document_version_id=eq.version%2F1", { method: "DELETE" });
  });
});
