import { useEffect, useState, type ReactNode } from "react";
import type { SopResult } from "../../domain/sop";
import { SopSessionContext } from "./sopSession";

export function SopSessionProvider({ children }: { children: ReactNode }) {
  const [resultFiles, setResultFiles] = useState<File[]>([]);
  const [suggestEdits, setSuggestEdits] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<SopResult | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!files.length && !title && !notes && !result) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [files.length, title, notes, result]);
  return <SopSessionContext.Provider value={{ resultFiles, setResultFiles, suggestEdits, setSuggestEdits, files, setFiles, title, setTitle, teamId, setTeamId, notes, setNotes, result, setResult, editing, setEditing }}>{children}</SopSessionContext.Provider>;
}

