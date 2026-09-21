import { blockText, type SopContent } from "../../domain/sop-content";

export function resolveSuggestion(content: SopContent, index: number, accept: boolean): SopContent {
  const suggestion = content.suggestions[index];
  if (!suggestion) return content;
  return {
    ...content,
    blocks: content.blocks.map((block) => accept && block.id === suggestion.blockId && ["heading", "paragraph", "list-item"].includes(block.type) && blockText(block) === suggestion.original
      ? { ...block, runs: [{ text: suggestion.replacement }] } : block),
    suggestions: content.suggestions.filter((_, position) => position !== index),
  };
}

export function sopUploadForm(files: File[], teamId: string, title: string, notes: string, suggestEdits: boolean): FormData {
  const form = new FormData();
  form.set("teamId", teamId); form.set("title", title); form.set("notes", notes); form.set("sampleConfirmed", "true");
  if (suggestEdits) form.set("suggestEdits", "true");
  files.forEach((file) => form.append("files", file, file.name));
  return form;
}
