import { KnowledgeLifecycle } from "./KnowledgeLifecycle";
import { Archive, Building2, ChevronDown, FileText, Filter, LoaderCircle, LockKeyhole, Pencil, Save, Search, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { KnowledgeDocumentSummary } from "../../domain/document";
import type { SopContent } from "../../domain/sop-content";
import { getJsonCached, invalidateApiCache } from "../../lib/api-cache";
import { ContentBlocks } from "../sops/SopContentView";
import "./library.css";

interface PublishedDraft { title: string; problem: string; summary: string; steps: string[]; warnings: string[] }
type EditableLabel = "verified" | "unresolved";
type LibraryLabelFilter = "all" | KnowledgeDocumentSummary["label"];
const knowledgeLabels: KnowledgeDocumentSummary["label"][] = ["verified", "unresolved", "outdated", "deprecated"];
interface LibraryDetail { id: string; label: KnowledgeDocumentSummary["label"]; sourceSpace: string; updatedAt: string; transcriptVisible: boolean; canManage: boolean; canManageVisibility: boolean; organizationWide: boolean; originallyApprovedBy: string | null; lastUpdatedBy: string | null; draft: PublishedDraft; sourceContent?: SopContent | null; sourceMessages: Array<{ provider_message_id: string; author_display_name: string; source_markdown: string }> }

export function PublishedDocumentContent({ detail }: { detail: Pick<LibraryDetail, "draft" | "sourceContent"> }) {
  if (detail.sourceContent) return <section className="published-source-content"><span>Original procedure</span><ContentBlocks blocks={detail.sourceContent.blocks} /></section>;
  return <><section><span>Problem</span><p>{detail.draft.problem}</p></section><section><span>Approved summary</span><p>{detail.draft.summary}</p></section>{detail.draft.steps.length > 0 && <section><span>Actions needed</span><ol>{detail.draft.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></section>}{detail.draft.warnings.length > 0 && <section className="published-warnings"><span>Warnings</span>{detail.draft.warnings.map((warning) => <p key={warning}>{warning}</p>)}</section>}</>;
}

const labelText = (label: string) => label === "verified" ? "Resolved issue" : label === "unresolved" ? "Unresolved" : label.replaceAll("_", " ");

export function LibraryPage({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const [searchParams] = useSearchParams(); const requestedQuery = searchParams.get("q") || ""; const [query, setQuery] = useState(requestedQuery); const [labelFilter, setLabelFilter] = useState<LibraryLabelFilter>("all"); const [sortNewest, setSortNewest] = useState(true);
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]); const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set()); const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KnowledgeDocumentSummary | null>(null); const [detail, setDetail] = useState<LibraryDetail | null>(null); const [edit, setEdit] = useState<PublishedDraft | null>(null);
  const [editLabel, setEditLabel] = useState<EditableLabel>("unresolved");
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");

  const [includeHistorical, setIncludeHistorical] = useState(false); const [revision, setRevision] = useState(0);
  const refreshLifecycle = () => { invalidateApiCache("/api/library"); setRevision((value) => value + 1); setSelected(null); setDetail(null); setEdit(null); setEditing(false); };
  useEffect(() => setQuery(requestedQuery), [requestedQuery]);
  useEffect(() => { let active = true; setLoading(true); setDocuments([]); void getJsonCached<{ items?: KnowledgeDocumentSummary[]; favoriteIds?: string[] }>(`/api/library${includeHistorical ? "?includeHistorical=true" : ""}`, 0).then((payload) => { if (active) { setDocuments(payload.items || []); setFavoriteIds(new Set(payload.favoriteIds || [])); } }).catch(() => { if (active) setMessage("The knowledge library could not be loaded."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [includeHistorical, revision]);
  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelected(null); setDetail(null); setEdit(null); setEditing(false); setMessage("");
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selected]);
  const close = () => { setSelected(null); setDetail(null); setEdit(null); setEditing(false); setMessage(""); };
  const open = async (document: KnowledgeDocumentSummary) => {
    setSelected(document); setDetail(null); setEdit(null); setEditing(false); setMessage("");
    try {
      const loaded = await getJsonCached<LibraryDetail>(`/api/library/${document.id}`, 0);
      setDetail(loaded); setEdit({ ...loaded.draft, steps: [...loaded.draft.steps], warnings: [...loaded.draft.warnings] }); setEditLabel(loaded.label === "verified" ? "verified" : "unresolved");
    } catch { setMessage("This published document could not be opened."); }
  };
  const toggleFavorite = async (documentId: string) => {
    const enabled = !favoriteIds.has(documentId); setMessage("");
    setFavoriteIds((current) => { const next = new Set(current); if (enabled) next.add(documentId); else next.delete(documentId); return next; });
    const response = await fetch(`/api/favorites/${documentId}`, { method: enabled ? "PUT" : "DELETE", headers: { accept: "application/json" } });
    if (!response.ok) { setFavoriteIds((current) => { const next = new Set(current); if (enabled) next.delete(documentId); else next.add(documentId); return next; }); setMessage("Favorite could not be saved. Please try again."); }
    else { invalidateApiCache("/api/library"); setMessage(enabled ? "Added to favorites." : "Removed from favorites."); }
  };
  const update = (field: keyof PublishedDraft, value: string | string[]) => setEdit((current) => current ? { ...current, [field]: value } : current);
  const savePublished = async () => {
    if (!selected || !edit) return; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/library/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...edit, label: editLabel }) });
      const result = await response.json() as { message?: string }; if (!response.ok) throw new Error(result.message || "Changes could not be saved.");
      invalidateApiCache("/api/library");
      const updatedAt = new Date().toISOString();
      setDetail((current) => current ? { ...current, label: editLabel, updatedAt, draft: { ...edit, steps: [...edit.steps], warnings: [...edit.warnings] } } : current);
      setDocuments((current) => current.map((document) => document.id === selected.id ? { ...document, label: editLabel, title: edit.title, summary: edit.summary, updatedAt } : document));
      setSelected((current) => current ? { ...current, label: editLabel, title: edit.title, summary: edit.summary, updatedAt } : current);
      setEditing(false); setMessage("Published document updated as a new audited version.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Changes could not be saved."); }
    finally { setBusy(false); }
  };
  const archivePublished = async () => {
    if (!selected || !window.confirm(`Archive “${selected.title}”? It will leave the library but remain recoverable in Supabase.`)) return;
    setBusy(true); const response = await fetch(`/api/library/${selected.id}`, { method: "DELETE", headers: { accept: "application/json" } });
    if (response.ok) { invalidateApiCache("/api/library"); setDocuments((current) => current.filter(({ id }) => id !== selected.id)); setFavoriteIds((current) => { const next = new Set(current); next.delete(selected.id); return next; }); close(); }
    else setMessage("The document could not be archived."); setBusy(false);
  };
  const permanentlyDelete = async () => {
    if (!selected || !window.confirm(`Permanently delete “${selected.title}”? This removes its versions, source transcript, favorites, search data, and stored SOP images. This cannot be undone.`)) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/library/${selected.id}/permanent`, { method: "DELETE", headers: { accept: "application/json" } });
    if (response.ok) { invalidateApiCache("/api/library"); setDocuments((current) => current.filter(({ id }) => id !== selected.id)); setFavoriteIds((current) => { const next = new Set(current); next.delete(selected.id); return next; }); close(); }
    else { const result = await response.json().catch(() => null) as { message?: string } | null; setMessage(result?.message || "The document could not be permanently deleted."); }
    setBusy(false);
  };
  const toggleOrganizationWide = async () => {
    if (!selected || !detail) return;
    setBusy(true); setMessage("");
    const visible = !detail.organizationWide;
    const response = await fetch(`/api/library/${selected.id}/organization-visibility`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visible }) });
    if (response.ok) { invalidateApiCache("/api/library"); setDetail((current) => current ? { ...current, organizationWide: visible } : current); setMessage(visible ? "This document is now available to everyone." : "This document is now private to its assigned team and approved sharing groups."); }
    else setMessage("Organization-wide visibility could not be changed.");
    setBusy(false);
  };
  const availableLabels = useMemo(() => knowledgeLabels.filter((label) => documents.some((document) => document.label === label)), [documents]);
  useEffect(() => { if (labelFilter !== "all" && !availableLabels.includes(labelFilter)) setLabelFilter("all"); }, [availableLabels, labelFilter]);
  const visibleDocuments = useMemo(() => documents.filter((document) => !favoritesOnly || favoriteIds.has(document.id)).filter((document) => labelFilter === "all" || document.label === labelFilter).filter((document) => `${document.title} ${document.summary}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sortNewest ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt) : Date.parse(a.updatedAt) - Date.parse(b.updatedAt)), [documents, favoriteIds, favoritesOnly, labelFilter, query, sortNewest]);

  return <div className="page library-page"><header className="page-heading"><div><span className="eyebrow">Approved, access-controlled guidance</span><h1>{favoritesOnly ? "Favorites" : "Knowledge library"}</h1><p>Open and search approved answers available through your teams.</p></div></header>
    <section className="search-panel"><label className="library-search"><Search size={20} aria-hidden="true" /><input aria-label="Search published titles and summaries" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search published titles and summaries" /></label><label className="library-filter"><Filter size={17} aria-hidden="true" /><span>Label</span><select aria-label="Filter by label" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value as LibraryLabelFilter)}><option value="all">All labels</option>{availableLabels.map((label) => <option key={label} value={label}>{labelText(label)}</option>)}</select></label></section>
    <label className="library-history-toggle"><input type="checkbox" checked={includeHistorical} onChange={(event) => setIncludeHistorical(event.target.checked)} /> <span>Include outdated and deprecated guidance <small>(historical reference)</small></span></label>
    <div className="library-toolbar"><p><strong>{visibleDocuments.length}</strong> published documents</p><label className="library-sort"><span>Sort by</span><select aria-label="Sort documents by updated date" value={sortNewest ? "newest" : "oldest"} onChange={(event) => setSortNewest(event.target.value === "newest")}><option value="newest">Updated recently</option><option value="oldest">Updated oldest</option></select><ChevronDown size={14} aria-hidden="true" /></label></div>
    {message && !selected && <p className="library-message" role="status">{message}</p>}{loading && <div className="empty-state"><LoaderCircle className="spin" size={24} /><p>Loading approved knowledge…</p></div>}<section className="document-list" aria-live="polite">{visibleDocuments.map((document) => <article className="document-card interactive-card" key={document.id}><button type="button" className="document-open-button" onClick={() => void open(document)} aria-label={`Open ${document.title}`}><div className="document-icon"><FileText size={21} /></div><div className="document-body"><div className="document-topline"><span className={`label label-${document.label}`}>{labelText(document.label)}</span><span>{document.sourceSpace}</span></div><h2>{document.title}</h2><p>{document.summary}</p><div className="document-footer"><div className="category-list">{document.teamNames.map((team) => <span key={team}>{team}</span>)}</div><div className="document-security">{!document.transcriptVisible && <span><LockKeyhole size={13} /> Transcript hidden</span>}<time>{new Date(document.updatedAt).toLocaleDateString()}</time></div></div></div></button><button type="button" className="favorite-button" aria-pressed={favoriteIds.has(document.id)} aria-label={`${favoriteIds.has(document.id) ? "Remove from" : "Add to"} favorites`} onClick={() => void toggleFavorite(document.id)}><Star size={20} fill={favoriteIds.has(document.id) ? "currentColor" : "none"} /></button></article>)}{!loading && visibleDocuments.length === 0 && <div className="empty-state"><Search size={24} /><h2>{favoritesOnly ? "No favorites yet" : "No published knowledge yet"}</h2><p>{favoritesOnly ? "Favorite an approved document to keep it here." : "Approved review items will appear here."}</p></div>}</section>
    {selected && <div className="review-dialog-backdrop" role="presentation" onMouseDown={close}><section className="review-dialog library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">{labelText(detail?.label || selected.label)} knowledge</span><h2 id="library-title">{edit?.title || selected.title}</h2><p>{selected.sourceSpace} · Updated {new Date(selected.updatedAt).toLocaleDateString()}</p></div><button type="button" className="icon-button" onClick={close} aria-label="Close document"><X size={20} /></button></header>
      {!detail || !edit ? <div className="empty-state">{!message && <LoaderCircle className="spin" size={22} />}<p>{message || "Loading published document…"}</p></div> : <>{detail.canManage && <div className="document-management">{!detail.sourceContent && <button type="button" onClick={() => setEditing((value) => !value)} disabled={busy || detail.label === "outdated" || detail.label === "deprecated"}><Pencil size={15} />{editing ? "Cancel editing" : "Edit document"}</button>}{detail.canManageVisibility && <button type="button" onClick={() => void toggleOrganizationWide()} disabled={busy}><Building2 size={15} />{detail.organizationWide ? "Make team private" : "Share with everyone"}</button>}<button type="button" className="danger-button" onClick={() => void archivePublished()} disabled={busy}><Archive size={15} />Archive document</button><button type="button" className="danger-button" onClick={() => void permanentlyDelete()} disabled={busy}><Trash2 size={15} />Permanently delete</button></div>}<KnowledgeLifecycle key={detail.id} documentId={detail.id} label={detail.label} canManage={detail.canManage} replacements={documents.filter((item) => item.label === "verified" || item.label === "unresolved")} onChanged={refreshLifecycle} onOpenReplacement={(id) => { const replacement = documents.find((item) => item.id === id); if (replacement) void open(replacement); }} />{message && <p className="library-message dialog-message" role="status">{message}</p>}{editing ? <div className="published-editor draft-editor"><label>Issue status<select value={editLabel} onChange={(event) => setEditLabel(event.target.value as EditableLabel)}><option value="verified">Resolved issue</option><option value="unresolved">Unresolved</option></select></label><label>Title<input value={edit.title} onChange={(event) => update("title", event.target.value)} /></label><label>Problem<textarea rows={3} value={edit.problem} onChange={(event) => update("problem", event.target.value)} /></label><label>Approved summary<textarea rows={6} value={edit.summary} onChange={(event) => update("summary", event.target.value)} /></label><label>Actions needed <small>One action per line</small><textarea rows={6} value={edit.steps.join("\n")} onChange={(event) => update("steps", event.target.value.split("\n").map((line) => line.trim()).filter(Boolean))} /></label><label>Warnings <small>One warning per line</small><textarea rows={3} value={edit.warnings.join("\n")} onChange={(event) => update("warnings", event.target.value.split("\n").map((line) => line.trim()).filter(Boolean))} /></label><button type="button" className="primary-button" onClick={() => void savePublished()} disabled={busy}><Save size={16} />{busy ? "Saving…" : "Save new version"}</button></div> : <div className="published-document"><div className="document-attribution"><span>Originally approved by <strong>{detail.originallyApprovedBy || "TDS reviewer"}</strong></span><span>Last updated by <strong>{detail.lastUpdatedBy || detail.originallyApprovedBy || "TDS reviewer"}</strong></span>{detail.organizationWide && <span className="organization-badge"><Building2 size={13} />Available to everyone</span>}</div><PublishedDocumentContent detail={detail} />{detail.transcriptVisible && detail.sourceMessages.length > 0 && <details><summary>Original conversation thread ({detail.sourceMessages.length} messages)</summary>{detail.sourceMessages.map((source) => <div className="source-review-message" key={source.provider_message_id}><strong>{source.author_display_name}</strong><p>{source.source_markdown}</p></div>)}</details>}</div>}</>}
    </section></div>}
  </div>;
}
