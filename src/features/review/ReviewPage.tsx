import { ArrowRight, Building2, Database, LoaderCircle, LockKeyhole, Save, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SopContent } from "../../domain/sop-content";
import { getJsonCached, invalidateApiCache } from "../../lib/api-cache";
import { ContentBlocks, SopContentEditor } from "../sops/SopContentView";
import "../../styles/workflow.css";

interface ReviewItem { id: string; title: string; summary: string; sourceSpace: string; teamName: string; reason: string; requestedBy: string; requestedAt: string; workflowState: string; organizationWide: boolean; }
interface Draft { title: string; problem: string; summary: string; steps: string[]; warnings: string[]; }
interface ReviewDetail { id: string; draft: Draft; sourceContent?: SopContent | null; organizationWide: boolean; sourceMessages: Array<{ provider_message_id: string; author_display_name: string; source_markdown: string; sent_at: string }> }

export function ReviewPage() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [editSourceContent, setEditSourceContent] = useState<SopContent | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [organizationWide, setOrganizationWide] = useState(true);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = await getJsonCached<{ items: ReviewItem[] }>("/api/reviews"); setItems(payload.items); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selectedIssue = searchParams.get("issue");
  useEffect(() => {
    const requestedItem = searchParams.get("item");
    if (state === "ready" && requestedItem) {
      const item = items.find(({ id }) => id === requestedItem);
      if (item) void open(item);
    }
  }, [items, state, searchParams]);

  const close = () => { setSelected(null); setDetail(null); setEdit(null); setEditSourceContent(null); setSaveMessage(""); setOrganizationWide(true); };
  const open = async (item: ReviewItem) => {
    setSelected(item); setDetail(null); setEdit(null); setEditSourceContent(null); setSaveMessage(""); setOrganizationWide(item.organizationWide !== false);
    if (item.workflowState === "processing_failed") return;
    try {
      const loaded = await getJsonCached<ReviewDetail>(`/api/reviews/${item.id}`);
      setDetail(loaded); setEdit({ ...loaded.draft, steps: [...loaded.draft.steps], warnings: [...loaded.draft.warnings] }); setEditSourceContent(loaded.sourceContent ? structuredClone(loaded.sourceContent) : null); setOrganizationWide(loaded.organizationWide !== false);
    } catch { setSaveMessage("This review item could not be opened."); }
  };
  const dirty = Boolean(detail && edit && (JSON.stringify(detail.draft) !== JSON.stringify(edit) || JSON.stringify(detail.sourceContent || null) !== JSON.stringify(editSourceContent)));
  const saveDraft = async (): Promise<boolean> => {
    if (!selected || !edit) return false;
    setSaving(true); setSaveMessage("");
    try {
      const response = await fetch(`/api/reviews/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...edit, sourceContent: editSourceContent }) });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Draft edits could not be saved.");
      invalidateApiCache(`/api/reviews/${selected.id}`);
      invalidateApiCache("/api/reviews");
      setDetail((current) => current ? { ...current, draft: { ...edit, steps: [...edit.steps], warnings: [...edit.warnings] }, sourceContent: editSourceContent } : current);
      setSaveMessage("Edits saved as a new audited draft version."); return true;
    } catch (error) { setSaveMessage(error instanceof Error ? error.message : "Draft edits could not be saved."); return false; }
    finally { setSaving(false); }
  };
  const moderate = async (action: "approve" | "reject", label?: "verified" | "unresolved") => {
    if (!selected) return;
    if (dirty && !await saveDraft()) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/reviews/${selected.id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, organizationWide }) });
      if (!response.ok) throw new Error();
      invalidateApiCache("/api/reviews"); invalidateApiCache("/api/library"); close(); await load();
    } finally { setSaving(false); }
  };
  const update = (field: keyof Draft, value: string | string[]) => setEdit((current) => current ? { ...current, [field]: value } : current);

  return <div className="page review-page"><header className="page-heading"><div><span className="eyebrow">Moderator workspace</span><h1>Review queue</h1><p>Compare, edit, and approve every generated draft against its original conversation thread.</p></div></header>
    {selectedIssue && <div className="review-banner processing-issue-banner"><ShieldCheck size={20} /><p><strong>Processing issue recorded safely.</strong> This capture did not generate a review draft or change an approved document. Re-run the exact Webex capture command after correcting the underlying issue.</p></div>}
    {state === "loading" && <div className="empty-state"><LoaderCircle className="spin" size={24} /><p>Loading durable review items…</p></div>}{state === "error" && <div className="empty-state"><h2>Review queue unavailable</h2><button className="primary-button" onClick={() => void load()}>Try again</button></div>}{state === "ready" && items.length === 0 && <div className="empty-state panel"><ShieldCheck size={24} /><h2>No drafts are waiting</h2><p>New bot captures will appear here automatically.</p></div>}
    <section className="review-list">{items.map((item) => <article className="review-row interactive-card" key={item.id} role="button" tabIndex={0} onClick={() => void open(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void open(item); } }}><div className="row-meta"><span className="tag">{item.reason.replaceAll("_", " ")}</span><span>{item.teamName}</span><span>{item.organizationWide !== false ? "Everyone" : "Team private"}</span></div><h2>{item.title}</h2><p>{item.sourceSpace}</p><div className="review-row-footer"><span>{new Date(item.requestedAt).toLocaleString()}</span><span className="card-action">Review source &amp; draft <ArrowRight size={15} /></span></div></article>)}</section>
    {selected && <div className="review-dialog-backdrop" role="presentation" onMouseDown={close}><section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">{selected.teamName}</span><h2 id="review-title">{edit?.title || selected.title}</h2><p>{selected.sourceSpace} · Requested by {selected.requestedBy}</p></div><button className="icon-button" onClick={close} aria-label="Close review"><X size={20} /></button></header>
      {selected.workflowState === "processing_failed" ? <div className="empty-state"><h2>Draft generation failed safely</h2><p>The original conversation remains stored, but no draft was published.</p></div> : !detail || !edit ? <div className="empty-state"><LoaderCircle className="spin" size={22} /><p>Loading source and draft…</p></div> : <div className="review-compare"><article><span>{detail.sourceContent ? "Original procedure" : "Original conversation thread"}</span>{detail.sourceContent ? <ContentBlocks blocks={detail.sourceContent.blocks} /> : <><h3>{detail.sourceMessages.length} Webex messages</h3>{detail.sourceMessages.map((message) => <div className="source-review-message" key={message.provider_message_id}><strong>{message.author_display_name}</strong><p>{message.source_markdown}</p></div>)}</>}</article><article className="draft-editor"><span>Editable review draft</span><label>Title<input value={edit.title} onChange={(event) => update("title", event.target.value)} /></label>{editSourceContent ? <SopContentEditor content={editSourceContent} onChange={setEditSourceContent} /> : <><label>Problem<textarea rows={3} value={edit.problem} onChange={(event) => update("problem", event.target.value)} /></label><label>Suggested summary<textarea rows={6} value={edit.summary} onChange={(event) => update("summary", event.target.value)} /></label><label>Actions needed <small>One action per line</small><textarea rows={6} value={edit.steps.join("\n")} onChange={(event) => update("steps", event.target.value.split("\n").map((line) => line.trim()).filter(Boolean))} /></label><label>Warnings <small>One warning per line</small><textarea rows={3} value={edit.warnings.join("\n")} onChange={(event) => update("warnings", event.target.value.split("\n").map((line) => line.trim()).filter(Boolean))} /></label></>}<div className="review-visibility"><span className="review-visibility-icon">{organizationWide ? <Building2 size={18} /> : <LockKeyhole size={18} />}</span><div><strong>{organizationWide ? "Available to everyone after approval" : `Private to ${selected.teamName}`}</strong><label><input type="checkbox" checked={!organizationWide} onChange={(event) => setOrganizationWide(!event.target.checked)} /> Keep this document private to the assigned team</label></div></div>{saveMessage && <p className="draft-save-message" role="status">{saveMessage}</p>}</article></div>}
      <footer><div><Database size={15} /><span>Edits and moderation are versioned and audited.</span></div><button disabled={saving || !detail || !dirty} onClick={() => void saveDraft()}><Save size={15} /> {saving ? "Saving…" : dirty ? "Save edits" : "Saved"}</button>{detail?.sourceContent ? <><button disabled={saving || !detail} onClick={() => void moderate("reject")}>Don&apos;t publish</button><button className="primary-button" disabled={saving || !detail} onClick={() => void moderate("approve", "verified")}>Publish</button></> : <><button disabled={saving || !detail} onClick={() => void moderate("reject")}>Reject draft</button><button disabled={saving || !detail} onClick={() => void moderate("approve", "unresolved")}>Publish unresolved</button><button className="primary-button" disabled={saving || !detail} onClick={() => void moderate("approve", "verified")}>Approve resolved issue</button></>}</footer></section></div>}
  </div>;
}
