import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { SopResult } from "../../domain/sop";

type Setter<T> = Dispatch<SetStateAction<T>>;
export interface SopSessionState {
  resultFiles: File[]; setResultFiles: Setter<File[]>;
  suggestEdits: boolean; setSuggestEdits: Setter<boolean>;
  files: File[]; setFiles: Setter<File[]>;
  title: string; setTitle: Setter<string>;
  teamId: string; setTeamId: Setter<string>;
  notes: string; setNotes: Setter<string>;
  result: SopResult | null; setResult: Setter<SopResult | null>;
  editing: boolean; setEditing: Setter<boolean>;
}
export const SopSessionContext = createContext<SopSessionState | null>(null);
export function useSopSession() {
  const state = useContext(SopSessionContext);
  if (!state) throw new Error("SOP workspace requires an authenticated session.");
  return state;
}

