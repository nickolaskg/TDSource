export type LifecycleAction = "flag" | "deprecate" | "outdate" | "approve" | "reject";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isCurrentKnowledge(label: unknown): boolean {
  return label === "verified" || label === "unresolved";
}
export function libraryLifecycleFilter(includeHistorical: boolean): string {
  return includeHistorical ? "" : "&knowledge_label=in.(verified,unresolved)";
}
export function parseLifecycleAction(value: unknown): { action: LifecycleAction; reason: string; replacementId: string | null; requestId: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!["flag", "deprecate", "outdate", "approve", "reject"].includes(String(body.action))) return null;
  if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 2000) return null;
  const replacementId = body.replacementId || null; const requestId = body.requestId || null;
  if (replacementId !== null && (typeof replacementId !== "string" || !uuid.test(replacementId))) return null;
  if (requestId !== null && (typeof requestId !== "string" || !uuid.test(requestId))) return null;
  if ((body.action === "approve" || body.action === "reject") !== (requestId !== null)) return null;
  if ((body.action === "flag" || body.action === "reject") && replacementId !== null) return null;
  return { action: body.action as LifecycleAction, reason: body.reason.trim(), replacementId, requestId };
}
interface Context {
  userId: string;
  readIds: string[];
  reviseIds: string[];
  db: <T>(path: string, init?: RequestInit) => Promise<T>;
}
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
export async function mutateKnowledgeLifecycle(request: Request, documentId: string, context: Context): Promise<Response> {
  if (!context.readIds.includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  const body = parseLifecycleAction(await request.json().catch(() => null));
  if (!body) return json({ message: "Choose an action and provide a reason of 1–2,000 characters." }, 400);
  if (body.action !== "flag" && !context.reviseIds.includes(documentId)) return json({ code: "FORBIDDEN" }, 403);
  if (body.replacementId && (body.replacementId === documentId || !context.readIds.includes(body.replacementId))) return json({ message: "Choose an accessible, different replacement document." }, 400);
  try {
    const id = await context.db<string>("rpc/change_knowledge_lifecycle", { method: "POST", body: JSON.stringify({ p_document_id: documentId, p_user_id: context.userId, p_action: body.action, p_reason: body.reason, p_replacement_id: body.replacementId, p_request_id: body.requestId }) });
    return json({ ok: true, id });
  } catch {
    return json({ message: "The change could not be saved. Refresh and try again. Lifecycle database setup may be required." }, 409);
  }
}
