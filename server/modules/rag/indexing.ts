import { toPgVector } from "./retrieval.js";
import type { KnowledgeChunkDraft } from "./chunks.js";

interface IndexingDb {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface IndexKnowledgeVersionInput {
  organizationId: string;
  documentId: string;
  documentVersionId: string;
  claimStartedAt: string;
  embeddingProvider: string;
  embeddingModel: string;
  chunks: readonly KnowledgeChunkDraft[];
  embed: (content: string) => Promise<readonly number[]>;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Atomically replace one current published version's index through the guarded database RPC. */
export async function indexKnowledgeVersion(db: IndexingDb, input: IndexKnowledgeVersionInput): Promise<number> {
  if (!input.organizationId || !input.documentId || !input.documentVersionId || !input.claimStartedAt || !input.embeddingProvider.trim() || !input.embeddingModel.trim()) {
    throw new Error("RAG indexing requires organization, document, version, claim, provider, and model identity");
  }
  const rows = [];
  for (const chunk of input.chunks) {
    const embedding = await input.embed(chunk.content);
    toPgVector(embedding);
    rows.push({
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      token_count: chunk.tokenCount,
      source_locator: chunk.sourceLocator,
      embedding: [...embedding],
      content_hash: await sha256(chunk.content),
    });
  }
  return db<number>("rpc/replace_knowledge_chunks", {
    method: "POST",
    body: JSON.stringify({
      p_organization_id: input.organizationId,
      p_document_id: input.documentId,
      p_document_version_id: input.documentVersionId,
      p_claim_started_at: input.claimStartedAt,
      p_embedding_provider: input.embeddingProvider.trim(),
      p_embedding_model: input.embeddingModel.trim(),
      p_chunks: rows,
    }),
  });
}

export async function removeKnowledgeVersionIndex(db: IndexingDb, documentVersionId: string): Promise<void> {
  if (!documentVersionId) throw new Error("RAG index removal requires version identity");
  await db<void>(`knowledge_chunks?document_version_id=eq.${encodeURIComponent(documentVersionId)}`, { method: "DELETE" });
}
