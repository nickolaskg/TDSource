import { ArrowRight, Check, Download, FileSpreadsheet, FileText, Info, LoaderCircle, Pencil, Plus, ShieldCheck, Sparkles, Trash2, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { SOP_ACCEPT, SOP_LIMITS, sopFileError, sopMarkdown, type SopDraft, type SopResult } from "../../domain/sop";
import { invalidateApiCache } from "../../lib/api-cache";
import { useSopSession } from "./sopSession";
import { readSopResponse } from "./response";
import { OriginalFile, SopContentView } from "./SopContentView";
import { sopUploadForm } from "./content-review";
import "./sops.css";
import "../../styles/workflow.css";

interface Configuration { aiAvailable?: boolean; provider?: "gemini" | "ollama"; model?: string; providerTimeoutSeconds?: number; available: boolean; message: string; teams: Array<{ teamId: string; teamName: string }> }
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

export function SopPage() {
  const navigate = useNavigate();
  const { resultFiles, setResultFiles, suggestEdits, setSuggestEdits, files, setFiles, title, setTitle, teamId, setTeamId, notes, setNotes, result, setResult, editing, setEditing } = useSopSession();
  const [config, setConfig] = useState<Configuration | null>(null);
  const [configError, setConfigError] = useState("");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [highlightedFile, setHighlightedFile] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const submitRef = useRef(false);

  useEffect(() => {
    // A Create SOP visit is a new workspace. Keep the draft visible while this
    // page is mounted, but never revive it after leaving and returning.
    setResult(null); setResultFiles([]); setFiles([]); setTitle(""); setNotes(""); setSuggestEdits(false); setEditing(false);
  }, [setFiles, setNotes, setResult, setResultFiles, setSuggestEdits, setTitle, setEditing]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/sops/config", { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        const data = await readSopResponse<Configuration>(response, "SOP setup could not be loaded. Try again.");
        setConfig(data); setTeamId((current) => data.teams.some((team) => team.teamId === current) ? current : data.teams[0]?.teamId || ""); setConfigError("");
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setConfigError(cause instanceof Error ? cause.message : "SOP setup could not be loaded."); });
    return () => controller.abort();
  }, [retry, setTeamId]);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const configuredTimeout = config?.providerTimeoutSeconds;
  const timeoutMinutes = Math.ceil((typeof configuredTimeout === "number" && Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 180) / 60);
  const generatedAt = result?.generatedAt;
  useEffect(() => { if (generatedAt) draftRef.current?.focus(); }, [generatedAt]);

  function addFiles(incoming: File[]) {
    if (busy) return;
    const next = [...files];
    for (const file of incoming) if (!next.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) next.push(file);
    const validation = sopFileError(next);
    if (validation) { setError(validation); return; }
    setFiles(next); setError("");
    const added = next[next.length - 1];
    if (added) {
      const key = `${added.name}-${added.size}-${added.lastModified}`;
      setHighlightedFile(key);
      window.setTimeout(() => setHighlightedFile((current) => current === key ? "" : current), 1800);
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const validation = sopFileError(files);
    if (validation) { setError(validation); return; }
    if (result && !window.confirm("Generating a new draft will replace the current draft and its edits. Download it first if you want to keep it. Continue?")) return;
    const controller = new AbortController(); requestRef.current = controller;
    setElapsedSeconds(0); setBusy(true); setError("");
    const form = sopUploadForm(files, teamId, title, notes, suggestEdits);
    try {
      const response = await fetch("/api/sops/generate", { method: "POST", body: form, credentials: "same-origin", signal: controller.signal });
      const data = await readSopResponse<SopResult>(response, "The SOP could not be generated. Try again.");
      setResult(data); setResultFiles(files); setEditing(false); setSubmitMessage(""); setSubmitError("");
    } catch (cause) {
      setError(controller.signal.aborted ? "Generation canceled. Your selected documents and notes are still here." : cause instanceof Error ? cause.message : "The SOP could not be generated. Try again.");
    } finally { setBusy(false); requestRef.current = null; }
  }

  async function submitForReview() {
    if (!result || submitRef.current || submitMessage) return;
    submitRef.current = true;
    setSubmitting(true); setSubmitError("");
    try {
      const response = await fetch("/api/sops/submit-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(result),
      });
      const data = await readSopResponse<{ message?: string; documentId?: string }>(response, "The SOP could not be submitted for review. Your draft is still here.");
      invalidateApiCache("/api/reviews");
      invalidateApiCache("/api/dashboard");
      setSubmitMessage(data.message || "SOP submitted for review.");
      navigate(data.documentId ? `/review?item=${encodeURIComponent(data.documentId)}` : "/review");
    } catch (cause) {
      submitRef.current = false;
      setSubmitError(cause instanceof Error ? cause.message : "The SOP could not be submitted for review. Your draft is still here.");
    } finally { setSubmitting(false); }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([sopMarkdown(result)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${result.draft.title.replace(/[^a-z0-9-]+/gi, "-").slice(0, 80) || "sop"}-draft.md`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const updateDraft = (change: Partial<SopDraft>) => setResult((current) => current ? { ...current, draft: { ...current.draft, ...change } } : current);
  const updateStep = (index: number, field: "title" | "instruction", value: string) => {
    if (result) updateDraft({ steps: result.draft.steps.map((step, stepIndex) => stepIndex === index ? { ...step, [field]: value } : step) });
  };
  return <div className={`page sop-page ${busy ? "is-generating" : ""}`}>
    <header className="page-heading"><div><span className="eyebrow">Moderator workspace</span><h1>{result ? "Review SOP draft" : "Standard operating procedures"}</h1><p>{result ? "Check the imported procedure against the original source before publishing." : "Import existing procedures while preserving their wording and structure."}</p></div><span className="sop-preview-badge">Local preview</span></header>
    <div className="sop-notice"><Info size={19} aria-hidden="true" /><p><strong>Try it with sample documents.</strong> Extracted document text and notes are sent to the configured AI provider for SOP parsing{config?.model ? ` (${config.provider === "ollama" ? "Ollama" : "Gemini"} · ${config.model})` : ""}. Embedded Office images remain visible for human review; PDF visual parsing requires a compatible provider. Optional wording suggestions are a separate review aid. Use non-sensitive test content only. Generation creates a local draft; select <strong>Submit for review</strong> after checking it to send the draft to the durable moderator queue.</p></div>
    {configError && <div className="sop-error" role="alert">{configError} <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
    {!config && !configError && <p role="status">Checking SOP generation…</p>}
    {config && !config.available && <div className="sop-error" role="status">{config.message}</div>}
    {config?.available && config.aiAvailable === false && <p role="status">Configure an AI provider before uploading SOP documents.</p>}
    {!result && <div className="sop-layout">
      <form className="panel sop-upload-panel" onSubmit={(event) => void generate(event)} aria-busy={busy}>
        <div className="sop-section-heading"><span className="sop-number">1</span><div><h2>Add your source material</h2><p>Combine documents that describe the same procedure.</p></div></div>
        <fieldset disabled={busy || !config?.available} className="sop-fields">
          <div className="sop-field-row"><label className="sop-field">Procedure title <span className="sop-optional">Optional</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={SOP_LIMITS.title} placeholder="e.g. Set up a new team workspace" /></label><label className="sop-field">Review team<select required value={teamId} onChange={(event) => setTeamId(event.target.value)}>{config?.teams.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}</select></label></div>
          <div className={`sop-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (config?.available) addFiles(Array.from(event.dataTransfer.files)); }}>
            <UploadCloud size={32} aria-hidden="true" /><h3>Drop your documents here</h3><p>PDF, Word (.docx), or Excel (.xlsx)</p><button type="button" className="sop-secondary-button" onClick={() => uploadRef.current?.click()}><Plus size={16} /> Choose documents</button>
            <input ref={uploadRef} className="sop-file-input" type="file" multiple accept={SOP_ACCEPT} aria-label="Choose SOP documents" onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
            <small>Up to 5 files · 25 MB per file and per request</small>
          </div>
          {files.length > 0 && <ul className="sop-file-list" aria-label="Selected documents">{files.map((file, index) => <li className={highlightedFile === `${file.name}-${file.size}-${file.lastModified}` ? "is-new-file" : ""} key={`${file.name}-${file.size}-${file.lastModified}`}>
            {file.name.toLowerCase().endsWith(".xlsx") ? <FileSpreadsheet size={21} aria-hidden="true" /> : <FileText size={21} aria-hidden="true" />}<div><strong>{file.name}</strong><small>Source D{index + 1} · {sizeLabel(file.size)}</small></div><button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => { setFiles((current) => current.filter((_, position) => position !== index)); setError(""); }}><X size={17} /></button>
          </li>)}</ul>}
          <label className="sop-field sop-notes">Additional notes <span className="sop-optional">Optional</span><textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={SOP_LIMITS.notes} placeholder="Who is this procedure for? Add prerequisites, important exceptions, or context that is missing from the documents." /><small>{notes.length.toLocaleString()} / {SOP_LIMITS.notes.toLocaleString()} characters</small></label>
          <label className="sop-consent"><input type="checkbox" checked={suggestEdits} disabled={config?.aiAvailable === false} onChange={(event) => setSuggestEdits(event.target.checked)} /><span>Ask AI for optional spelling, grammar, and wording suggestions. Review and accept each change separately.</span></label>
        </fieldset>
        {error && <div className="sop-error" role="alert">{error}</div>}
        <div className="sop-form-footer"><span>{files.length ? `${files.length} document${files.length === 1 ? "" : "s"} · ${sizeLabel(files.reduce((sum, file) => sum + file.size, 0))}` : "Your source documents remain unchanged."}</span><button className="primary-button" disabled={busy || !config?.available || !files.length || !teamId} type="submit">{busy ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />} {busy ? "Importing SOP…" : "Generate SOP draft"}</button></div>
        {busy && <div className="sop-progress" role="status" aria-live="polite"><LoaderCircle size={22} className="spin" aria-hidden="true" /><div><strong>Working on your SOP…</strong><p>Reading the source structure{suggestEdits ? " and preparing optional AI suggestions" : ""}. This may take up to {timeoutMinutes} {timeoutMinutes === 1 ? "minute" : "minutes"}.</p><p aria-live="off">Elapsed: {elapsedSeconds} seconds</p><button type="button" onClick={() => requestRef.current?.abort()}>Cancel generation</button></div></div>}
      </form>
      <aside className="sop-guide"><section className="sop-tip"><ShieldCheck size={20} aria-hidden="true" /><h3>You stay in control</h3><p>Generated procedures remain unpublished until you submit them for moderator review. Reviewers can edit, approve, reject, and choose whether approved knowledge is shared with everyone or kept private to the selected team.</p></section><section className="sop-tip"><FileText size={20} aria-hidden="true" /><h3>Keep visual context</h3><p>Word and Excel retain supported text formatting and images. Some layout and graphics may not transfer. PDF transcription uses AI and must be checked against the original; it does not guarantee completeness.</p></section></aside>
    </div>}
    {result && <section ref={draftRef} tabIndex={-1} className="panel sop-result" aria-labelledby="sop-draft-heading">
      <header className="sop-result-heading"><div><span className="eyebrow">Unpublished · Review required</span><h2 id="sop-draft-heading">Your SOP draft</h2><p>Review the imported content and make any changes before publication. This draft is not yet in the knowledge library.</p></div><div className="sop-result-actions">{!result.content && <button type="button" className="sop-secondary-button" disabled={busy || submitting} onClick={() => setEditing((value) => !value)}>{editing ? <Check size={16} /> : <Pencil size={16} />}{editing ? "Preview draft" : "Edit draft"}</button>}<button type="button" className="primary-button" onClick={download}><Download size={16} />Download draft</button><button type="button" className="primary-button sop-submit-button" disabled={submitting || Boolean(submitMessage)} onClick={() => void submitForReview()}>{submitting ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}{submitting ? "Submitting…" : submitMessage ? "Submitted for review" : "Submit for review"}</button><button type="button" className="sop-secondary-button" disabled={submitting} onClick={() => { setResult(null); setResultFiles([]); setFiles([]); setTitle(""); setNotes(""); setSuggestEdits(false); setEditing(false); submitRef.current = false; setSubmitMessage(""); setSubmitError(""); }}>Create another SOP</button></div>{submitMessage && <p className="sop-submit-message" role="status">{submitMessage}</p>}{submitError && <p className="sop-submit-error" role="alert">{submitError}</p>}</header>
      <fieldset disabled={busy || submitting} className="sop-fields sop-draft-body">
        {result.content ? <SopContentView content={result.content} onChange={(content) => setResult((current) => current ? { ...current, content } : current)} /> : <>
        {editing ? <><label className="sop-field">Title<input value={result.draft.title} onChange={(event) => updateDraft({ title: event.target.value })} maxLength={200} /></label><label className="sop-field">Purpose<textarea rows={3} value={result.draft.summary} onChange={(event) => updateDraft({ summary: event.target.value })} /></label></> : <><h2>{result.draft.title}</h2><p className="sop-summary">{result.draft.summary}</p></>}
        <h3>Before you begin</h3>{editing ? <label className="sop-field">Prerequisites (one per line)<textarea rows={3} value={result.draft.prerequisites.join("\n")} onChange={(event) => updateDraft({ prerequisites: event.target.value.split("\n") })} /></label> : result.draft.prerequisites.length ? <ul>{result.draft.prerequisites.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No prerequisites were identified in the source.</p>}
        <h3>Procedure</h3><ol className="sop-steps">{result.draft.steps.map((step, index) => <li key={index}><span className="sop-number">{index + 1}</span><div>{editing ? <><label className="sop-field">Step {index + 1} title<input value={step.title} onChange={(event) => updateStep(index, "title", event.target.value)} /></label><label className="sop-field">Instructions<textarea rows={3} value={step.instruction} onChange={(event) => updateStep(index, "instruction", event.target.value)} /></label><button type="button" className="sop-text-button" onClick={() => updateDraft({ steps: result.draft.steps.filter((_, position) => position !== index) })}><Trash2 size={14} />Remove step {index + 1}</button></> : <><h4>{step.title}</h4><p>{step.instruction}</p></>}<div className="sop-source-tags">{step.sourceIds.length ? step.sourceIds.map((id) => <a key={id} href={`#sop-source-${id}`}>{id} <ArrowRight size={11} /></a>) : <span>Added during review · Verify against sources</span>}</div></div></li>)}</ol>
        {editing && <button className="sop-secondary-button" type="button" onClick={() => updateDraft({ steps: [...result.draft.steps, { title: "", instruction: "", sourceIds: [] }] })}><Plus size={15} />Add step</button>}
        {(["warnings", "openQuestions"] as const).map((field) => <section key={field} className="sop-draft-callout"><h3>{field === "warnings" ? "Warnings & precautions" : "Questions to resolve"}</h3>{editing ? <label className="sop-field">{field === "warnings" ? "Warnings" : "Questions"} (one per line)<textarea rows={3} value={result.draft[field].join("\n")} onChange={(event) => updateDraft({ [field]: event.target.value.split("\n") })} /></label> : result.draft[field].length ? <ul>{result.draft[field].map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>None identified. Check the source documents during your review.</p>}</section>)}
        </>}
        <section className="sop-sources"><h3>Sources used for this draft</h3><p>Check the original documents before using this procedure. Imported content and AI suggestions remain unpublished.</p>{result.sources.map((source) => <div id={`sop-source-${source.id}`} key={source.id}><strong>{source.id} · {source.name}</strong>{resultFiles.find((file, index) => `D${index + 1}` === source.id && file.name === source.name) && <OriginalFile file={resultFiles.find((file, index) => `D${index + 1}` === source.id && file.name === source.name)!} />}{source.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>)}</section>
      </fieldset>
    </section>}
  </div>;
}
