export interface SopRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean }
export interface SopBlock {
  id: string; sourceId: string; type: "heading" | "paragraph" | "list-item" | "table" | "image";
  runs?: SopRun[]; level?: number; ordered?: boolean; marker?: string; rows?: SopRun[][][]; src?: string; assetKey?: string; alt?: string;
}
export interface SopSuggestion { blockId: string; original: string; replacement: string; reason: string }
export interface SopContent { blocks: SopBlock[]; suggestions: SopSuggestion[]; limitations: string[] }

export function blockText(block: SopBlock): string {
  if (block.type === "table") return (block.rows || []).map((row) => row.map((cell) => cell.map((run) => run.text).join("")).join("\t")).join("\n");
  if (block.type === "image") return block.alt || "Embedded image";
  return (block.runs || []).map((run) => run.text).join("");
}
function escaped(text: string): string { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_[\]{}|])/g, "\\$1"); }
function markdownRuns(runs: SopRun[] = []): string {
  return runs.map((run) => { let text = escaped(run.text); if (run.bold) text = `**${text}**`; if (run.italic) text = `*${text}*`; if (run.underline) text = `<u>${text}</u>`; return text; }).join("");
}
export function contentMarkdown(content: SopContent): string {
  const blocks = content.blocks.map((block) => {
    const text = markdownRuns(block.runs);
    if (block.type === "image") return block.src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(block.src) ? `![${escaped(block.alt || "Embedded image")}](${block.src})` : "[Image unavailable]";
    if (block.type === "heading") return `${"#".repeat(Math.max(1, Math.min(6, block.level || 1)))} ${block.marker ? `${escaped(block.marker)} ` : ""}${text}`;
    if (block.type === "list-item") return `${"  ".repeat(Math.max(0, Math.min(8, block.level || 0)))}${block.marker || (block.ordered ? "1." : "-")} ${text}`;
    if (block.type === "table") {
      const rows = block.rows || []; const width = Math.max(0, ...rows.map((row) => row.length));
      if (!width) return "";
      // Empty headers avoid promoting the first source row to a header it never had.
      const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
      return [line(Array(width).fill("")), line(Array(width).fill("---")), ...rows.map((row) => line(Array.from({ length: width }, (_, i) => markdownRuns(row[i]).replace(/\n/g, "<br>"))))].join("\n");
    }
    return text;
  });
  return ["> Unpublished source document. Review before use.", ...blocks, ...(content.limitations.length ? ["## Extraction limitations", ...content.limitations.map((item) => `- ${escaped(item)}`)] : [])].join("\n\n") + "\n";
}
