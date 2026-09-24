import { blockText, type SopContent } from "../../../src/domain/sop-content.js";

export const RAG_TARGET_CHUNK_CHARACTERS = 2400;

export interface PublishedKnowledgeVersion {
  title: string;
  problem?: string | null;
  summary?: string | null;
  steps?: readonly string[] | null;
  warnings?: readonly string[] | null;
  sourceContent?: SopContent | null;
}

export interface KnowledgeChunkDraft {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  sourceLocator: {
    section: string;
    heading?: string;
    step?: number;
    blockIds?: string[];
    part?: number;
  };
}

interface Unit {
  section: string;
  heading?: string;
  step?: number;
  blockIds?: string[];
  text: string;
}

function clean(value: string | null | undefined): string {
  return (value || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function splitBounded(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
    const whitespace = window.lastIndexOf(" ");
    const cut = sentence >= Math.floor(limit * 0.55) ? sentence + (window[sentence] === "." ? 1 : 0)
      : whitespace >= Math.floor(limit * 0.55) ? whitespace : limit;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function sourceUnits(content: SopContent): Unit[] {
  const units: Unit[] = [];
  let heading = "Original procedure";
  for (const block of content.blocks) {
    if (block.type === "image" && !clean(block.alt)) continue;
    const text = clean(blockText(block));
    if (!text) continue;
    if (block.type === "heading") {
      heading = text;
      units.push({ section: "source", heading, blockIds: [block.id], text: `## ${heading}` });
      continue;
    }
    const prefix = block.type === "list-item" ? `${block.marker || (block.ordered ? "1." : "-")} `
      : block.type === "image" ? "Image: " : "";
    units.push({ section: "source", heading, blockIds: [block.id], text: `${prefix}${text}` });
  }
  return units;
}

function versionUnits(version: PublishedKnowledgeVersion): Unit[] {
  const units: Unit[] = [];
  const add = (section: string, value: string | null | undefined) => {
    const text = clean(value);
    if (text) units.push({ section, text: `## ${section}\n${text}` });
  };
  add("Title", version.title);
  add("Problem", version.problem);
  add("Summary", version.summary);
  (version.steps || []).forEach((value, index) => {
    const text = clean(value);
    if (text) units.push({ section: "Steps", step: index + 1, text: `## Step ${index + 1}\n${text}` });
  });
  (version.warnings || []).forEach((value, index) => {
    const text = clean(value);
    if (text) units.push({ section: "Warnings", step: index + 1, text: `## Warning ${index + 1}\n${text}` });
  });
  if (version.sourceContent) units.push(...sourceUnits(version.sourceContent));
  return units;
}

/** Build stable, source-addressable chunks without depending on a provider tokenizer. */
export function buildKnowledgeChunks(version: PublishedKnowledgeVersion, maxCharacters = RAG_TARGET_CHUNK_CHARACTERS): KnowledgeChunkDraft[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 200) throw new Error("RAG chunk size must be an integer of at least 200 characters");
  const drafts: Omit<KnowledgeChunkDraft, "chunkIndex" | "tokenCount">[] = [];
  const units = versionUnits(version);
  const packed: Unit[] = [];
  for (const unit of units) {
    const previous = packed.at(-1);
    const canPackSource = unit.section === "source" && previous?.section === "source" && previous.heading === unit.heading
      && previous.text.length + unit.text.length + 2 <= maxCharacters;
    if (canPackSource && previous) {
      previous.text += `\n\n${unit.text}`;
      previous.blockIds = [...(previous.blockIds || []), ...(unit.blockIds || [])];
    } else packed.push({ ...unit, blockIds: unit.blockIds ? [...unit.blockIds] : undefined });
  }
  for (const unit of packed) {
    const pieces = splitBounded(unit.text, maxCharacters);
    pieces.forEach((content, index) => drafts.push({
      content,
      sourceLocator: {
        section: unit.section,
        ...(unit.heading ? { heading: unit.heading } : {}),
        ...(unit.step ? { step: unit.step } : {}),
        ...(unit.blockIds ? { blockIds: unit.blockIds } : {}),
        ...(pieces.length > 1 ? { part: index + 1 } : {}),
      },
    }));
  }
  return drafts.map((draft, chunkIndex) => ({ ...draft, chunkIndex, tokenCount: Math.max(1, Math.ceil(draft.content.length / 4)) }));
}
