import { useEffect, useState } from "react";
import { invalidateApiCache } from "../../lib/api-cache";
import "./knowledge-lifecycle.css";
interface Flag { id: string; document_id: string; reason: string; status: string; title?: string; decision_reason?: string }
interface Lifecycle { reason: string | null; changedAt: string | null; replacementId: string | null; flags: Flag[] }
async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(body.message || "Lifecycle information could not be loaded.");
  return body;
}
async function change(documentId: string, body: object): Promise<void> {
  const response = await fetch(`/api/library/${documentId}/lifecycle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { message?: string };
  if (!response.ok) throw new Error(result.message || "The change could not be saved.");
  invalidateApiCache("/api/library");
}
export function KnowledgeLifecycle({ documentId, label, canManage, replacements, onChanged, onOpenReplacement }: { documentId: string; label: string; canManage: boolean; replacements: { id: string; title: string }[]; onChanged: () => void; onOpenReplacement: (id: string) => void }) {
  const [data, setData] = useState<Lifecycle | null>(null); const [error, setError] = useState("");
  const [reason, setReason] = useState(""); const [replacementId, setReplacementId] = useState(""); const [busy, setBusy] = useState(false);
  const historical = label === "deprecated" || label === "outdated";
  useEffect(() => { let active = true; void read<Lifecycle>(`/api/library/${documentId}/lifecycle`).then((value) => { if (active) setData(value); }).catch((failure: Error) => { if (active) setError(failure.message); }); return () => { active = false; }; }, [documentId]);
  const submit = async (action: "flag" | "deprecate" | "outdate") => {
    setBusy(true); setError("");
    try { await change(documentId, { action, reason, replacementId: action === "flag" ? null : replacementId || null }); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  return <section className="knowledge-lifecycle" aria-label="Knowledge currency">
    {historical && <p className="lifecycle-warning" role="note"><strong>{label === "deprecated" ? "Deprecated" : "Outdated"} — historical reference only.</strong> This guidance is excluded from the current knowledge library.</p>}
    {data?.reason && <p>Reason: {data.reason}{data.changedAt && <> · {new Date(data.changedAt).toLocaleDateString()}</>}</p>}
    {data?.replacementId && <button type="button" onClick={() => onOpenReplacement(data.replacementId!)}>Open current replacement</button>}
    {error && <p role="status">{error}</p>}
    {data && !historical && <details><summary>{canManage ? "Mark guidance outdated or deprecated" : "Flag outdated guidance for review"}</summary>
      <p>{canManage ? "This removes the guidance from current results and retains it in history. Provide a reason before applying the change." : "An admin or moderator will review your report. Reporting does not remove the guidance automatically."}</p>
      <label>Reason<textarea maxLength={2000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
      {canManage && <label>Replacement (optional)<select value={replacementId} onChange={(event) => setReplacementId(event.target.value)} disabled={busy}><option value="">No replacement</option>{replacements.filter((item) => item.id !== documentId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      <div className="lifecycle-actions">{canManage ? <><button disabled={busy || !reason.trim()} onClick={() => void submit("outdate")}>Mark outdated</button><button disabled={busy || !reason.trim()} onClick={() => void submit("deprecate")}>Deprecate document</button></> : <button disabled={busy || !reason.trim() || data.flags.some((flag) => flag.status === "pending")} onClick={() => void submit("flag")}>Submit for review</button>}</div>
    </details>}
    {data && data.flags.length > 0 && <details><summary>Deprecation reports ({data.flags.length})</summary>{data.flags.map((flag) => <p key={flag.id}><strong>{flag.status}</strong>: {flag.reason}{flag.decision_reason && <> — Decision: {flag.decision_reason}</>}</p>)}</details>}
  </section>;
}
