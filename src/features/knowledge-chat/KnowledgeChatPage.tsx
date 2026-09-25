import { AlertCircle, ArrowUp, BookOpen, ChevronDown, ChevronUp, LoaderCircle, MessageSquareText, Plus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import "./knowledge-chat.css";

interface Citation { id?: string; title: string; excerpt?: string; url?: string; source?: string; }
interface ChatResponse { answer?: string; citations?: Array<Citation | string>; sources?: Citation[]; message?: string; }
interface ChatMessage { id: string; role: "user" | "assistant"; content: string; sources?: Citation[]; }
interface SavedConversation { savedAt: string; messages: ChatMessage[]; }

const previousConversationKey = "tds-knowledge-chat-previous";

function messageId(role: ChatMessage["role"]): string { return `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function readPreviousConversation(): SavedConversation | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(previousConversationKey) || "null") as SavedConversation | null;
    if (!value || !Array.isArray(value.messages) || !value.messages.some(({ role }) => role === "assistant")) return null;
    return value;
  } catch { return null; }
}

function saveConversation(messages: ChatMessage[]): SavedConversation | null {
  if (!messages.some(({ role }) => role === "assistant")) return null;
  const conversation = { savedAt: new Date().toISOString(), messages };
  try { window.sessionStorage.setItem(previousConversationKey, JSON.stringify(conversation)); } catch { /* The active chat still works when session storage is unavailable. */ }
  return conversation;
}

function MessageText({ content }: { content: string }) {
  return <div className="knowledge-message-copy">{content.split(/\n{2,}/).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>)}</div>;
}

function MessageSources({ sources = [] }: { sources?: Citation[] }) {
  if (!sources.length) return null;
  return <div className="knowledge-message-sources"><span>Sources</span><ul>{sources.map((source, index) => <li key={source.id || `${source.title}-${index}`}><BookOpen size={14} />{source.url ? <a href={source.url}>{source.title}</a> : source.title}</li>)}</ul></div>;
}

export function KnowledgeChatPage() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [previous, setPrevious] = useState<SavedConversation | null>(() => readPreviousConversation());
  const [showPrevious, setShowPrevious] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => () => { saveConversation(messagesRef.current); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || busy) return;
    const userMessage: ChatMessage = { id: messageId("user"), role: "user", content: prompt };
    const priorMessages = messages;
    setMessages([...priorMessages, userMessage]);
    setQuestion(""); setBusy(true); setError("");
    try {
      const response = await fetch("/api/knowledge-chat", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ message: prompt, history: priorMessages.map(({ role, content }) => ({ role, content })) }),
      });
      const payload = await response.json() as ChatResponse;
      if (!response.ok) throw new Error(payload.message || "The knowledge answer could not be generated.");
      if (!payload.answer?.trim()) throw new Error("No answer was returned. Try a more specific question.");
      const sources = payload.sources || (Array.isArray(payload.citations) ? payload.citations.flatMap((citation) => typeof citation === "object" ? [citation] : []) : []);
      setMessages((current) => [...current, { id: messageId("assistant"), role: "assistant", content: payload.answer!.trim(), sources }]);
    } catch (cause) {
      setMessages(priorMessages); setQuestion(prompt);
      setError(cause instanceof Error ? cause.message : "The knowledge answer could not be generated.");
    } finally { setBusy(false); }
  };

  const newChat = () => {
    const saved = saveConversation(messages);
    if (saved) setPrevious(saved);
    setMessages([]); setQuestion(""); setError(""); setShowPrevious(false);
  };

  const previousTitle = previous?.messages.find(({ role }) => role === "user")?.content || "Previous conversation";
  const previousQuestions = previous?.messages.filter(({ role }) => role === "user").length || 0;

  return <div className="page knowledge-chat-page">
    <header className="page-heading knowledge-chat-heading"><div><span className="eyebrow">Answers from approved knowledge</span><h1>Knowledge chat</h1><p>Ask follow-up questions while you stay on this page. Every answer is checked against the documents you can access.</p></div>{messages.length > 0 && <button className="secondary-button" type="button" onClick={newChat}><Plus size={16} /> New chat</button>}</header>

    <section className="knowledge-conversation" aria-live="polite" aria-label="Current knowledge conversation">
      {messages.length === 0 && <div className="knowledge-chat-welcome"><MessageSquareText size={24} aria-hidden="true" /><div><h2>Ask the knowledge base</h2><p>Start with a question about published, non-deprecated guidance. You can ask follow-up questions after the first answer.</p></div></div>}
      {messages.map((message) => <article className={`knowledge-message knowledge-message-${message.role}`} key={message.id}><div className="knowledge-message-label">{message.role === "user" ? "You" : "Knowledge assistant"}</div><MessageText content={message.content} /><MessageSources sources={message.sources} /></article>)}
      {busy && <div className="knowledge-chat-status" role="status"><LoaderCircle className="spin" size={20} /><span>Searching approved knowledge and preparing an answer…</span></div>}
    </section>

    {error && <div className="knowledge-chat-alert" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}

    <form className="knowledge-chat-composer" onSubmit={submit} aria-busy={busy}>
      <label htmlFor="knowledge-question">Ask a question</label>
      <div className="knowledge-composer-row"><textarea id="knowledge-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={messages.length ? "Ask a follow-up question…" : "How do I create a CCWR quote for Dell EMC?"} rows={2} disabled={busy} /><button className="primary-button" type="submit" aria-label="Send question" disabled={busy || !question.trim()}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={18} />}</button></div>
      <span className="knowledge-composer-help">Answers use approved knowledge and include sources when available.</span>
    </form>

    {previous && <section className="panel previous-conversation-card"><button type="button" onClick={() => setShowPrevious((visible) => !visible)} aria-expanded={showPrevious}><div><span className="eyebrow">Previous conversation</span><strong>{previousTitle}</strong><small>{previousQuestions} question{previousQuestions === 1 ? "" : "s"} · Saved for this browser session</small></div>{showPrevious ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</button>{showPrevious && <div className="previous-conversation-transcript">{previous.messages.map((message) => <article className={`knowledge-message knowledge-message-${message.role}`} key={message.id}><div className="knowledge-message-label">{message.role === "user" ? "You" : "Knowledge assistant"}</div><MessageText content={message.content} /><MessageSources sources={message.sources} /></article>)}</div>}</section>}
  </div>;
}
