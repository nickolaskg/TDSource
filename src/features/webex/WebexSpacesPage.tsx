import { AlertCircle, Hash, LoaderCircle, MessageSquareText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface WebexRoom {
  id: string;
  title: string;
  type: "direct" | "group";
  lastActivity?: string;
}

interface WebexMessage {
  id: string;
  text?: string;
  markdown?: string;
  personEmail?: string;
  created?: string;
  parentId?: string;
}

interface WebexList<T> {
  items?: T[];
}

type LoadState = "loading" | "ready" | "reauth" | "error";

function formattedTime(value?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function WebexSpacesPage() {
  const [rooms, setRooms] = useState<WebexRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<WebexRoom | null>(null);
  const [messages, setMessages] = useState<WebexMessage[]>([]);
  const [roomsState, setRoomsState] = useState<LoadState>("loading");
  const [messagesState, setMessagesState] = useState<LoadState>("ready");

  const loadRooms = useCallback(async () => {
    setRoomsState("loading");
    try {
      const response = await fetch("/api/webex/rooms", { credentials: "same-origin" });
      if (response.status === 401) return setRoomsState("reauth");
      if (!response.ok) throw new Error("rooms");
      const payload = await response.json() as WebexList<WebexRoom>;
      const nextRooms = payload.items || [];
      setRooms(nextRooms);
      setRoomsState("ready");
      setSelectedRoom((current) => current || nextRooms[0] || null);
    } catch {
      setRoomsState("error");
    }
  }, []);

  useEffect(() => { void loadRooms(); }, [loadRooms]);

  useEffect(() => {
    if (!selectedRoom) return;
    let active = true;
    setMessagesState("loading");
    fetch(`/api/webex/messages?roomId=${encodeURIComponent(selectedRoom.id)}`, { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) return { reauth: true };
        if (!response.ok) throw new Error("messages");
        return response.json() as Promise<WebexList<WebexMessage>>;
      })
      .then((payload) => {
        if (!active) return;
        if ("reauth" in payload) return setMessagesState("reauth");
        setMessages((payload.items || []).slice().reverse());
        setMessagesState("ready");
      })
      .catch(() => { if (active) setMessagesState("error"); });
    return () => { active = false; };
  }, [selectedRoom]);

  if (roomsState === "reauth") {
    return <div className="page"><section className="empty-state panel"><RefreshCw size={26} /><h1>Reconnect Webex</h1><p>Your current session predates the new room permissions.</p><a className="primary-button" href="/api/auth/webex/start">Grant room access</a></section></div>;
  }

  return (
    <div className="page webex-page">
      <header className="page-heading">
        <div><span className="eyebrow">Live Webex data</span><h1>Webex spaces</h1><p>Browse spaces and recent messages available to your signed-in Webex account.</p></div>
        <button className="primary-button" type="button" onClick={() => void loadRooms()}><RefreshCw size={16} /> Refresh</button>
      </header>
      <section className="webex-browser panel">
        <aside className="space-list" aria-label="Webex spaces">
          {roomsState === "loading" && <div className="inline-status"><LoaderCircle className="spin" size={18} /> Loading spaces…</div>}
          {roomsState === "error" && <div className="inline-status error"><AlertCircle size={18} /> Spaces could not be loaded.</div>}
          {roomsState === "ready" && rooms.length === 0 && <div className="inline-status">No available spaces were returned.</div>}
          {rooms.map((room) => (
            <button key={room.id} type="button" className={selectedRoom?.id === room.id ? "space-row selected" : "space-row"} onClick={() => setSelectedRoom(room)}>
              <Hash size={16} /><span><strong>{room.title || "Untitled space"}</strong><small>{room.lastActivity ? `Active ${formattedTime(room.lastActivity)}` : room.type}</small></span>
            </button>
          ))}
        </aside>
        <div className="message-pane">
          <div className="message-pane-heading"><MessageSquareText size={18} /><div><strong>{selectedRoom?.title || "Select a space"}</strong><small>{selectedRoom ? "Latest 50 messages" : "Choose a Webex space to inspect its messages"}</small></div></div>
          <div className="message-list">
            {messagesState === "loading" && <div className="inline-status"><LoaderCircle className="spin" size={18} /> Loading messages…</div>}
            {messagesState === "reauth" && <div className="inline-status error"><AlertCircle size={18} /> Reconnect Webex to read messages.</div>}
            {messagesState === "error" && <div className="inline-status error"><AlertCircle size={18} /> Messages could not be loaded.</div>}
            {messagesState === "ready" && selectedRoom && messages.length === 0 && <div className="inline-status">No recent messages were returned.</div>}
            {messages.map((message) => (
              <article className={message.parentId ? "webex-message thread-reply" : "webex-message"} key={message.id}>
                <div><strong>{message.personEmail || "Webex user"}</strong><time>{formattedTime(message.created)}</time></div>
                <p>{message.text || message.markdown || "Attachment or rich-content message"}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <p className="data-boundary"><AlertCircle size={14} /> Diagnostic view only. Capture by replying in the source thread with the exact TDS bot command.</p>
    </div>
  );
}
