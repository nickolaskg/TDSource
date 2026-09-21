import { z } from "zod";
import { sopMarkdown, type SopResult } from "../../../src/domain/sop.js";
import { blockText, type SopBlock, type SopContent, type SopRun } from "../../../src/domain/sop-content.js";

const text = z.string().trim().min(1).max(8000);
const sourceSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  kind: z.enum(["pdf", "docx", "xlsx", "notes"]),
  warnings: z.array(text).max(30),
});
const draftSchema = z.object({
  title: text.max(200),
  summary: text,
  prerequisites: z.array(text).max(30),
  steps: z.array(z.object({ title: text.max(200), instruction: text, sourceIds: z.array(z.string().trim().min(1).max(100)).min(1).max(10) })).max(50),
  warnings: z.array(text).max(30),
  openQuestions: z.array(text).max(30),
});
const runSchema = z.object({ text: z.string().max(8000), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional() });
const blockSchema = z.object({
  id: z.string().max(200), sourceId: z.string().max(100), type: z.enum(["heading", "paragraph", "list-item", "table", "image"]),
  runs: z.array(runSchema).max(500).optional(), level: z.number().int().optional(), ordered: z.boolean().optional(), marker: z.string().max(20).optional(),
  rows: z.array(z.array(z.array(runSchema).max(100)).max(100)).max(100).optional(), src: z.string().max(200).optional(), alt: z.string().max(1000).optional(),
});
const contentSchema = z.object({ blocks: z.array(blockSchema).max(1000), suggestions: z.array(z.object({ blockId: z.string().max(200), original: text, replacement: text, reason: text })).max(500), limitations: z.array(text).max(100) });
const submissionSchema = z.object({ teamId: z.string().trim().min(1).max(100), generatedAt: z.string().datetime(), draft: draftSchema, sources: z.array(sourceSchema).min(1).max(10), content: contentSchema.optional() });

function importedSteps(content: SopContent): z.infer<typeof draftSchema>["steps"] {
  return content.blocks.map((block, index) => {
    const instruction = blockText(block).trim();
    if (!instruction) return null;
    const title = block.type === "heading" ? instruction : `Imported procedure step ${index + 1}`;
    return { title: title.slice(0, 200), instruction: instruction.slice(0, 8000), sourceIds: [block.sourceId] };
  }).filter((step): step is NonNullable<typeof step> => step !== null).slice(0, 50);
}

export interface ValidatedSopSubmission {
  teamId: string;
  generatedAt: string;
  draft: z.infer<typeof draftSchema>;
  sources: z.infer<typeof sourceSchema>[];
  sourceProviderId: string;
  sourceSpaceProviderId: string;
  sourceMarkdown: string;
}

function stripBinary(content: SopContent): SopContent {
  const blocks: SopBlock[] = content.blocks.map((block) => ({
    ...block,
    runs: block.runs?.map((run): SopRun => ({ text: run.text, bold: run.bold, italic: run.italic, underline: run.underline })),
    src: undefined,
  }));
  return { blocks, suggestions: content.suggestions, limitations: content.limitations };
}

export function validateSopSubmission(value: unknown): ValidatedSopSubmission {
  const parsed = submissionSchema.parse(value);
  const sourceIds = new Set(parsed.sources.map(({ id }) => id));
  const steps = parsed.draft.steps.length ? parsed.draft.steps : parsed.content ? importedSteps(parsed.content) : [];
  if (!steps.length || sourceIds.size !== parsed.sources.length || steps.some((step) => step.sourceIds.some((id) => !sourceIds.has(id)))) throw new Error("Invalid source reference");
  const draft = { ...parsed.draft, steps };
  const result: SopResult = { ...parsed, draft, content: parsed.content ? stripBinary(parsed.content) : undefined };
  const uploadId = crypto.randomUUID();
  return {
    teamId: parsed.teamId,
    generatedAt: parsed.generatedAt,
    draft,
    sources: parsed.sources,
    sourceProviderId: `upload:${uploadId}`,
    sourceSpaceProviderId: `upload:${uploadId}`,
    sourceMarkdown: sopMarkdown(result),
  };
}
