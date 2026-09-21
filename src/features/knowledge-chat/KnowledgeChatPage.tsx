import { AlertCircle, ArrowUp, BookOpen, LoaderCircle, MessageSquareText, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import "./knowledge-chat.css";

interface Citation {
  id?: string;
  title: string;
  excerpt?: string;
  url?: string;
  source?: string;
}

interface ChatResponse {
  answer?: string;
  citations?: Array<Citation | string>;
  sources?: Citation[];
  message?: string;
}

export function KnowledgeChatPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    setAnswer(null);
    setCitations([]);
    try {
      const response = await fetch("/api/knowledge-chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      const payload = await response.json() as ChatResponse;
      if (!response.ok) throw new Error(payload.message || "The knowledge answer could not be generated.");
      if (!payload.answer?.trim()) throw new Error("No answer was returned. Try a more specific question.");
      setAnswer(payload.answer);
      // The API returns rich `sources`; keep a citation fallback for older responses.
      setCitations(payload.sources || (Array.isArray(payload.citations) ? payload.citations.flatMap((citation) => typeof citation === "object" ? [citation] : []) : []));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The knowledge answer could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setQuestion(""); setAnswer(null); setCitations([]); setError(""); };

  return (
    <div className="page knowledge-chat-page">
      <header className="page-heading knowledge-chat-heading">
        <div>
          <span className="eyebrow">Answers from approved knowledge</span>
          <h1>Knowledge chat</h1>
          <p>Ask a question and get a grounded answer from the documents you can access.</p>
        </div>
        {(answer || error) && <button className="secondary-button" type="button" onClick={reset}><RotateCcw size={16} /> New question</button>}
      </header>

      <section className={`panel knowledge-chat-composer ${busy ? "is-loading" : ""}`} aria-busy={busy}>
        <div className="panel-heading">
          <div><h2>Ask the knowledge base</h2><p>Answers use published, non-deprecated guidance and include source references.</p></div>
          <MessageSquareText size={21} aria-hidden="true" />
        </div>
        <form onSubmit={submit}>
          <label htmlFor="knowledge-question">Your question</label>
          <textarea id="knowledge-question" aria-describedby="knowledge-question-help" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Example: How do I create a CCWR quote for Dell EMC?" rows={4} disabled={busy} />
          <div className="knowledge-chat-form-footer">
            <span id="knowledge-question-help">Use specific terms for the best result.</span>
            <button className="primary-button" type="submit" disabled={busy || !question.trim()}>{busy ? <><LoaderCircle className="spin" size={17} /> Searching knowledge…</> : <>Ask question <ArrowUp size={17} /></>}</button>
          </div>
        </form>
      </section>

      {error && <div className="knowledge-chat-alert" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {busy && <div className="knowledge-chat-status" role="status" aria-live="polite"><LoaderCircle className="spin" size={20} /><span>Searching approved knowledge and preparing an answer…</span></div>}

      {answer && <section className="knowledge-chat-result" aria-live="polite">
        <article className="panel knowledge-answer">
          <div className="knowledge-result-heading"><div><span className="eyebrow">Grounded answer</span><h2>Here’s what we found</h2></div><BookOpen size={21} aria-hidden="true" /></div>
          <div className="knowledge-answer-copy">{answer.split(/\n{2,}/).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>)}</div>
        </article>
        <aside className="panel knowledge-sources" aria-label="Answer sources">
          <div className="panel-heading"><div><span className="eyebrow">Source references</span><h2>Sources</h2><p>{citations.length ? `${citations.length} source${citations.length === 1 ? "" : "s"}` : "No source references returned"}</p></div></div>
          {citations.length > 0 ? <ol>{citations.map((citation, index) => <li key={citation.id || `${citation.title}-${index}`}><BookOpen size={16} /><div><strong>{citation.url ? <a href={citation.url}>{citation.title}</a> : citation.title}</strong>{citation.source && <small>{citation.source}</small>}{citation.excerpt && <p>{citation.excerpt}</p>}</div></li>)}</ol> : <p className="knowledge-no-sources">The answer did not include source references.</p>}
        </aside>
      </section>}
    </div>
  );
}
