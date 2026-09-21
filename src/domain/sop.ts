import { contentMarkdown, type SopContent } from "./sop-content.js";
export const SOP_LIMITS = {
  files: 5,
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 25 * 1024 * 1024,
  notes: 6000,
  title: 160,
} as const;

export const SOP_ACCEPT = ".pdf,.docx,.xlsx";

export interface SopSource {
  id: string;
  name: string;
  kind: "pdf" | "docx" | "xlsx" | "notes";
  warnings: string[];
}

export interface SopStep {
  title: string;
  instruction: string;
  sourceIds: string[];
}

export interface SopDraft {
  title: string;
  summary: string;
  prerequisites: string[];
  steps: SopStep[];
  warnings: string[];
  openQuestions: string[];
}

export interface SopResult {
  content?: SopContent;
  draft: SopDraft;
  sources: SopSource[];
  teamId: string;
  generatedAt: string;
}

export function sopFileError(files: readonly { name: string; size: number }[]): string | null {
  if (!files.length) return "Add at least one PDF, Word (.docx), or Excel (.xlsx) document.";
  if (files.length > SOP_LIMITS.files) return "Choose up to 5 documents for one procedure.";
  for (const file of files) {
    if (!/\.(pdf|docx|xlsx)$/i.test(file.name)) return `${file.name}: use PDF, .docx, or .xlsx. Convert older or macro-enabled Office files first.`;
    if (!file.size) return `${file.name} is empty. Choose a document with content.`;
    if (file.size > SOP_LIMITS.fileBytes) return `${file.name} exceeds the 25 MB file limit.`;
  }
  if (files.reduce((total, file) => total + file.size, 0) > SOP_LIMITS.totalBytes) return "This local preview accepts up to 25 MB of documents per request. Split the procedure into smaller uploads.";
  return null;
}

export function sopMarkdown(result: SopResult): string {
  const { draft, sources } = result;
  if (result.content) return [
    `# ${draft.title}`,
    "> Unpublished imported draft. Verify accuracy and completeness against the original documents before use.",
    contentMarkdown(result.content),
    "## Source documents",
    ...sources.map((source) => `- ${source.id}: ${source.name}${source.warnings.map((warning) => `\n  - Source limitation: ${warning}`).join("")}`),
  ].join("\n\n") + "\n";
  const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  return [
    `# ${draft.title}`,
    "> Unpublished AI draft. Verify every step against the source documents before use.",
    draft.summary,
    "## Before you begin", bullets(draft.prerequisites) || "No prerequisites identified in the source.",
    "## Procedure",
    draft.steps.map((step, index) => `### ${index + 1}. ${step.title}\n\n${step.instruction}\n\nSources: ${step.sourceIds.join(", ")}`).join("\n\n"),
    "## Warnings", bullets(draft.warnings) || "No warnings identified in the source.",
    "## Questions to resolve", bullets(draft.openQuestions) || "None identified. A human review is still required.",
    "## Source documents", bullets(sources.map((source) => `${source.id}: ${source.name}${source.warnings.map((warning) => `\n  - Source limitation: ${warning}`).join("")}`)),
  ].join("\n\n") + "\n";
}



