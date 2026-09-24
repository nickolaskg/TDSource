export const RAG_EMBEDDING_DIMENSIONS = 768;
export const RAG_DEFAULT_MATCH_COUNT = 8;
export const RAG_MAX_MATCH_COUNT = 50;

export interface KnowledgeChunk {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  chunk_index: number;
  content: string;
  source_locator: Record<string, unknown>;
  similarity: number;
}

interface RetrievalDb {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface KnowledgeChunkSearch {
  organizationId: string;
  userId: string;
  embedding: readonly number[];
  embeddingModel: string;
  matchCount?: number;
  minSimilarity?: number;
}

function normalizedMatchCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return RAG_DEFAULT_MATCH_COUNT;
  return Math.min(Math.max(Math.trunc(value as number), 1), RAG_MAX_MATCH_COUNT);
}

function normalizedSimilarity(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.35;
  return Math.min(Math.max(value as number, -1), 1);
}

export function toPgVector(embedding: readonly number[]): string {
  if (embedding.length !== RAG_EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error(`RAG embeddings must contain exactly ${RAG_EMBEDDING_DIMENSIONS} finite values`);
  }
  return `[${embedding.join(",")}]`;
}

export function buildKnowledgeChunkSearchBody(input: KnowledgeChunkSearch): Record<string, unknown> {
  if (!input.organizationId || !input.userId) throw new Error("RAG retrieval requires organization and user identity");
  if (!input.embeddingModel.trim()) throw new Error("RAG retrieval requires embedding model identity");
  return {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_query_embedding: toPgVector(input.embedding),
    p_embedding_model: input.embeddingModel.trim(),
    p_match_count: normalizedMatchCount(input.matchCount),
    p_min_similarity: normalizedSimilarity(input.minSimilarity),
  };
}

export async function retrieveKnowledgeChunks(db: RetrievalDb, input: KnowledgeChunkSearch): Promise<KnowledgeChunk[]> {
  return db<KnowledgeChunk[]>("rpc/search_knowledge_chunks", {
    method: "POST",
    body: JSON.stringify(buildKnowledgeChunkSearchBody(input)),
  });
}
