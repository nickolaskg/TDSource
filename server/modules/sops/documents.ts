import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { SopSource } from "../../../src/domain/sop.js";
import { blockText, type SopBlock, type SopRun } from "../../../src/domain/sop-content.js";
import type { LlmPart } from "../llm/provider.js";
import { redactForLlm } from "../redaction/redact.js";

export interface PreparedDocument { source: SopSource; parts: LlmPart[]; blocks?: SopBlock[] }

export class SopInputError extends Error {}
const MAX_EXPANDED = 32 * 1024 * 1024;
const MAX_TEXT = 160_000;
const decoder = new TextDecoder();
const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, parseTagValue: false, trimValues: false, processEntities: false });
type XmlNode = Record<string, unknown>;

function xml(bytes: Uint8Array): XmlNode[] {
  const text = decoder.decode(bytes);
  if (bytes.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) {
    throw new SopInputError("An Office document contains unsupported or invalid XML. Export it to PDF and try again.");
  }
  return parser.parse(text) as XmlNode[];
}

function nodesNamed(nodes: XmlNode[], name: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === name) found.push(node);
      else if (Array.isArray(value)) found.push(...nodesNamed(value as XmlNode[], name));
    }
  }
  return found;
}

function textOf(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return (value as XmlNode[]).map((node) => Object.entries(node).map(([key, child]) => {
    if (key === "#text") return String(child).replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, value: string) => { const code = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value); return code <= 0x10ffff ? String.fromCodePoint(code) : "�"; }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    if (key === ":@") return "";
    return textOf(child) + (key === "w:tc" ? "\t" : ["w:p", "w:tr", "w:br", "w:tab"].includes(key) ? "\n" : "");
  }).join("")).join("");
}

// Flattening revisions would make deleted and replacement instructions equally current.
function wordNodes(bytes: Uint8Array): XmlNode[] {
  const nodes = xml(bytes);
  const revision = /^w:(?:ins|del|delText|delInstrText|moveFrom(?:RangeStart|RangeEnd)?|moveTo(?:RangeStart|RangeEnd)?|cellIns|cellDel|cellMerge|numberingChange|\w+PrChange|tblGridChange|customXml(?:Ins|Del|MoveFrom|MoveTo)Range(?:Start|End))$/;
  const pending: XmlNode[] = [...nodes];
  while (pending.length) {
    const node = pending.pop()!;
    for (const [key, value] of Object.entries(node)) {
      if (revision.test(key)) throw new SopInputError("This Word document contains tracked changes. Accept or reject all changes in Word, or export the intended final version to PDF, then upload it again.");
      if (Array.isArray(value)) pending.push(...value as XmlNode[]);
    }
  }
  return nodes;
}
function attribute(node: XmlNode, key: string): string {
  return String((node[":@"] as Record<string, unknown> | undefined)?.[`@_${key}`] || "");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function imageMime(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (decoder.decode(bytes.subarray(0, 4)) === "RIFF" && decoder.decode(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let entries = 0;
  try {
    return unzipSync(bytes, { filter(entry) {
      entries += 1;
      total += entry.originalSize;
      if (entries > 1000 || total > MAX_EXPANDED || entry.originalSize > 8 * 1024 * 1024) throw new SopInputError("This Office file expands beyond the local processing limit. Export it to PDF or split it into smaller files.");
      if (/vbaProject|embeddings\//i.test(entry.name)) throw new SopInputError("Macros and embedded executable objects are not supported. Export this document to PDF.");
      return /^(\[Content_Types\]\.xml|word\/|xl\/)/.test(entry.name);
    } });
  } catch (error) {
    if (error instanceof SopInputError) throw error;
    throw new SopInputError("An Office file could not be opened. Use an unencrypted .docx or .xlsx file, or export to PDF.");
  }
}


function children(node: XmlNode, name: string): XmlNode[] { return Array.isArray(node[name]) ? node[name] as XmlNode[] : []; }
function child(nodes: XmlNode[], name: string): XmlNode | undefined { return nodes.find((node) => name in node); }
function props(nodes: XmlNode[], name: string): XmlNode[] { const node = child(nodes, name); return node ? children(node, name) : []; }
function val(nodes: XmlNode[], name: string): string | undefined { const node = child(nodes, name); return node ? attribute(node, "w:val") : undefined; }
function readPart(entries: Record<string, Uint8Array>, name: string): XmlNode[] { return entries[name] ? xml(entries[name]) : []; }
function relationshipPath(base: string, target: string): string | undefined {
  if (!target || /[\\?#]/.test(target) || /^[a-z]+:/i.test(target) || target.startsWith("//")) return undefined;
  const segments = (target.startsWith("/") ? target.slice(1) : base + target).split("/"); const out: string[] = [];
  for (const segment of segments) { if (segment === "..") { if (!out.length) return undefined; out.pop(); } else if (segment && segment !== ".") out.push(segment); }
  return out.join("/");
}
function formatRun(nodes: XmlNode[], inherited: Omit<SopRun, "text"> = {}): Omit<SopRun, "text"> {
  const result = { ...inherited };
  for (const [tag, key] of [["w:b", "bold"], ["w:i", "italic"], ["w:u", "underline"]] as const) {
    const node = child(nodes, tag);
    if (node) result[key] = !["0", "false", "off", "none"].includes(attribute(node, "w:val"));
  }
  return result;
}
function numberingValue(value: number, format: string): string {
  if (format === "lowerLetter" || format === "upperLetter") { let text = ""; for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text; return format === "lowerLetter" ? text.toLowerCase() : text; }
  if (format === "lowerRoman" || format === "upperRoman") { let text = "", n = value; for (const [number, symbol] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) while (n >= number) { text += symbol; n -= number; } return format === "lowerRoman" ? text.toLowerCase() : text; }
  return String(value);
}
function wordBlocks(entries: Record<string, Uint8Array>, source: SopSource, images: Map<string, string>): SopBlock[] {
  const document = wordNodes(entries["word/document.xml"]);
  const styles = nodesNamed(readPart(entries, "word/styles.xml"), "w:style");
  const defaults = nodesNamed(readPart(entries, "word/styles.xml"), "w:docDefaults")[0];
  const defaultRun = defaults ? formatRun(props(props(children(defaults, "w:docDefaults"), "w:rPrDefault"), "w:rPr")) : {};
  const numbering = readPart(entries, "word/numbering.xml");
  const relationships = nodesNamed(readPart(entries, "word/_rels/document.xml.rels"), "Relationship");
  const blocks: SopBlock[] = [], usedImages = new Set<string>();
  let imageBytes = 0;
  const counters = new Map<string, number[]>();
  const warn = (message: string) => { if (!source.warnings.includes(message)) source.warnings.push(message); };
  const add = (block: Omit<SopBlock, "id" | "sourceId">) => { imageBytes += block.src?.length || 0; if (imageBytes > 32 * 1024 * 1024) throw new SopInputError("Repeated document images exceed the processing limit. Split the document into smaller files."); blocks.push({ ...block, id: source.id + "-B" + (blocks.length + 1), sourceId: source.id }); if (blocks.length > 5000) throw new SopInputError("This document has too many content blocks. Split it into smaller files."); };
  function styleProperties(id: string, kind: "w:pPr" | "w:rPr", seen = new Set<string>()): XmlNode[] {
    if (!id || seen.has(id)) return []; seen.add(id);
    const style = styles.find((node) => attribute(node, "w:styleId") === id); if (!style) return [];
    const contents = children(style, "w:style"); const own = props(contents, kind); const inherited = styleProperties(val(contents, "w:basedOn") || "", kind, seen);
    return [...own, ...inherited.filter((node) => !own.some((item) => Object.keys(item)[0] === Object.keys(node)[0]))];
  }
  function listInfo(paragraph: XmlNode[]): Pick<SopBlock, "level" | "ordered" | "marker"> | undefined {
    const numPr = props(paragraph, "w:numPr"); const numId = val(numPr, "w:numId"); if (!numId || numId === "0") return;
    const level = Math.max(0, Math.min(8, Number(val(numPr, "w:ilvl") || 0)));
    const num = nodesNamed(numbering, "w:num").find((node) => attribute(node, "w:numId") === numId);
    const numContents = num ? children(num, "w:num") : [];
    const abstract = nodesNamed(numbering, "w:abstractNum").find((node) => attribute(node, "w:abstractNumId") === val(numContents, "w:abstractNumId"));
    const levels = abstract ? children(abstract, "w:abstractNum") : [];
    const definition = (depth: number) => {
      const override = nodesNamed(numContents, "w:lvlOverride").find((node) => attribute(node, "w:ilvl") === String(depth));
      const over = override ? children(override, "w:lvlOverride") : [];
      const lvl = child(over, "w:lvl") || nodesNamed(levels, "w:lvl").find((node) => attribute(node, "w:ilvl") === String(depth));
      const detail = lvl ? children(lvl, "w:lvl") : [];
      return { format: val(detail, "w:numFmt") || "decimal", template: val(detail, "w:lvlText") || "%" + (depth + 1) + ".", start: Math.max(0, Math.min(10000, Number(val(over, "w:startOverride") || val(detail, "w:start") || 1))), restart: val(detail, "w:lvlRestart") };
    };
    if (!abstract) warn("A Word numbering definition is missing; confirm the displayed list markers against the original.");
    const info = definition(level); const values = counters.get(numId) || [];
    values[level] = values[level] === undefined ? info.start : values[level] + 1;
    for (let depth = level + 1; depth < 9; depth++) { const restart = definition(depth).restart; if (restart !== "0" && (restart === undefined || Number(restart) === level + 1)) delete values[depth]; }
    counters.set(numId, values);
    if (info.format === "bullet") return { level, ordered: false, marker: info.template || "•" };
    if (!["decimal", "decimalZero", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman", "none"].includes(info.format)) warn("Some custom Word numbering formats are displayed as decimal numbers.");
    return { level, ordered: info.format !== "none", marker: info.format === "none" ? "" : info.template.replace(/%([1-9])/g, (_match, digit: string) => { const depth = Number(digit) - 1; const detail = definition(depth); return numberingValue(values[depth] ?? detail.start, detail.format); }) };
  }
  function image(node: XmlNode) {
    const relationId = attribute(node, "r:embed") || attribute(node, "r:id");
    const relation = relationships.find((item) => attribute(item, "Id") === relationId);
    const target = relation && attribute(relation, "TargetMode") !== "External" ? relationshipPath("word/", attribute(relation, "Target")) : undefined;
    if (!target || !images.has(target)) { warn("A linked or unsupported image could not be embedded. Check the original document."); return; }
    usedImages.add(target); add({ type: "image", src: images.get(target), alt: "Embedded image " + (usedImages.size) });
  }
  function paragraph(node: XmlNode): void {
    const content = children(node, "w:p"); const direct = props(content, "w:pPr"); const styleId = val(direct, "w:pStyle") || "";
    const inherited = styleProperties(styleId, "w:pPr");
    const merged = [...direct, ...inherited.filter((item) => !direct.some((own) => Object.keys(own)[0] === Object.keys(item)[0]))];
    // Number ID and level can independently come from a paragraph style.
    const directNum = props(direct, "w:numPr"), inheritedNum = props(inherited, "w:numPr");
    if (directNum.length && inheritedNum.length) { const index = merged.findIndex((item) => "w:numPr" in item); merged[index] = { "w:numPr": [...directNum, ...inheritedNum.filter((item) => !directNum.some((own) => Object.keys(own)[0] === Object.keys(item)[0]))] }; }
    const outline = val(merged, "w:outlineLvl"); const heading = /heading\s*([1-9])/i.exec(styleId);
    const headingLevel = outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : heading ? Number(heading[1]) : undefined;
    const list = listInfo(merged); const base = formatRun(styleProperties(styleId, "w:rPr"), defaultRun);
    let runs: SopRun[] = [], emitted = false;
    const flush = () => { if (runs.some((run) => run.text.trim())) { add({ type: headingLevel ? "heading" : list && !emitted ? "list-item" : "paragraph", runs, ...(headingLevel ? { level: headingLevel, marker: list?.marker } : !emitted ? list : {}) }); emitted = true; } runs = []; };
    function walk(nodes: XmlNode[], formatting: Omit<SopRun, "text">): void {
      for (const item of nodes) for (const [name, value] of Object.entries(item)) {
        if (name === "w:pPr" || name === "w:rPr" || name === ":@" || name === "w:instrText") continue;
        if (name === "mc:AlternateContent") { const selected = child(value as XmlNode[], "mc:Choice") || child(value as XmlNode[], "mc:Fallback"); if (selected) walk(children(selected, "mc:Choice").length ? children(selected, "mc:Choice") : children(selected, "mc:Fallback"), formatting); }
        else if (name === "w:r") { const rp = props(value as XmlNode[], "w:rPr"); walk(value as XmlNode[], formatRun(rp, formatRun(styleProperties(val(rp, "w:rStyle") || "", "w:rPr"), formatting))); }
        else if (name === "w:t") runs.push({ text: textOf(value), ...formatting });
        else if (name === "w:tab" || name === "w:br" || name === "w:cr") runs.push({ text: name === "w:tab" ? "\t" : "\n", ...formatting });
        else if (name === "a:blip" || name === "v:imagedata") { flush(); image(item); }
        else if (Array.isArray(value)) walk(value as XmlNode[], formatting);
      }
    }
    walk(content, base); flush();
  }
  function walk(nodes: XmlNode[]): void {
    for (const item of nodes) for (const [name, value] of Object.entries(item)) {
      if (name === "mc:AlternateContent") { const selected = child(value as XmlNode[], "mc:Choice") || child(value as XmlNode[], "mc:Fallback"); if (selected) walk(children(selected, "mc:Choice").length ? children(selected, "mc:Choice") : children(selected, "mc:Fallback")); }
      else if (name === "w:p") paragraph(item);
      else if (name === "w:tbl") {
        const tableRows: SopRun[][][] = []; const deferred: SopBlock[] = [];
        for (const row of children(item, "w:tbl").filter((entry) => "w:tr" in entry)) {
          const cells: SopRun[][] = [];
          for (const cell of children(row, "w:tr").filter((entry) => "w:tc" in entry)) {
            const start = blocks.length; walk(children(cell, "w:tc")); const cellBlocks = blocks.splice(start);
            const runs: SopRun[] = [];
            for (const block of cellBlocks) { if (block.type === "image") deferred.push(block); else { if (runs.length) runs.push({ text: "\n" }); if (block.marker) runs.push({ text: block.marker + " " }); runs.push(...(block.runs || [{ text: blockText(block) }])); } }
            cells.push(runs);
          }
          if (cells.length) tableRows.push(cells);
        }
        add({ type: "table", rows: tableRows });
        for (const picture of deferred) add({ type: "image", src: picture.src, alt: picture.alt });
        if (deferred.length) warn("Images inside table cells appear immediately after their table; confirm the original cell placement.");
        if (nodesNamed(value as XmlNode[], "w:gridSpan").length || nodesNamed(value as XmlNode[], "w:vMerge").length) warn("Merged Word table cells are shown as source cells without visual merging.");
      } else if (Array.isArray(value) && name !== "w:sectPr") walk(value as XmlNode[]);
    }
  }
  walk(document);
  for (const [name, src] of images) if (!usedImages.has(name)) { add({ type: "image", src, alt: "Unplaced embedded image" }); warn("An embedded image has no body placement reference and is appended after the document."); }
  for (const name of ["word/footnotes.xml", "word/endnotes.xml"]) if (entries[name] && textOf(xml(entries[name])).trim()) warn("Word footnotes or endnotes contain additional text that is not imported. Review the original document before using this procedure.");
  source.warnings.push("Word page layout, headers, footers, charts and floating-object geometry are not reproduced. Paragraphs, lists, text emphasis and referenced body images follow source order.");
  return blocks;
}
function workbookBlocks(entries: Record<string, Uint8Array>, source: SopSource, images: Map<string, string>): SopBlock[] {
  const strings = entries["xl/sharedStrings.xml"] ? nodesNamed(xml(entries["xl/sharedStrings.xml"]), "si").map((node) => textOf(node.si)) : [];
  const workbook = xml(entries["xl/workbook.xml"]);
  const relationships = nodesNamed(readPart(entries, "xl/_rels/workbook.xml.rels"), "Relationship");
  const blocks: SopBlock[] = [];
  const add = (block: Omit<SopBlock, "id" | "sourceId">) => blocks.push({ ...block, id: source.id + "-B" + (blocks.length + 1), sourceId: source.id });
  for (const sheet of nodesNamed(workbook, "sheet")) {
    const relation = relationships.find((node) => attribute(node, "Id") === attribute(sheet, "r:id"));
    const path = relation && attribute(relation, "TargetMode") !== "External" ? relationshipPath("xl/", attribute(relation, "Target")) : undefined;
    if (!path || !entries[path]) throw new SopInputError("A spreadsheet sheet could not be read. Export the workbook to PDF.");
    add({ type: "heading", level: 2, runs: [{ text: "Sheet: " + attribute(sheet, "name") + (["hidden", "veryHidden"].includes(attribute(sheet, "state")) ? " (hidden in workbook)" : "") }] });
    const rows: SopRun[][][] = []; let width = 0;
    for (const row of nodesNamed(xml(entries[path]), "row")) {
      const cells: SopRun[][] = []; let lastColumn = 0;
      for (const cell of nodesNamed(children(row, "row"), "c")) {
        const coordinate = attribute(cell, "r"), letters = /^[A-Z]+/.exec(coordinate)?.[0];
        const column = letters ? [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) : lastColumn + 1;
        if (column > 1000 || rows.length > 10000) throw new SopInputError("This spreadsheet is too wide or long for a procedure. Split it into smaller sheets.");
        while (cells.length < column - 1) cells.push([]);
        const type = attribute(cell, "t"), content = children(cell, "c"); const value = textOf(props(content, "v")); const formula = textOf(props(content, "f"));
        const displayed = type === "s" ? strings[Number(value)] : type === "inlineStr" ? textOf(props(content, "is")) : value;
        if (type === "s" && displayed === undefined) throw new SopInputError("A spreadsheet text reference is invalid. Export it to PDF.");
        cells.push([{ text: (coordinate ? coordinate + ": " : "") + (displayed || (formula ? "[no cached value]" : "")) + (formula ? " (formula: " + formula + "; cached values may be stale)" : "") }]); lastColumn = column;
      }
      if (cells.length) rows.push(cells);
      width = Math.max(width, cells.length);
      if (rows.length * width > 100000) throw new SopInputError("This spreadsheet expands to too many cells. Split it into smaller sheets.");
    }
    add({ type: "table", rows });
  }
  for (const src of images.values()) add({ type: "image", src, alt: "Spreadsheet embedded image (placement not preserved)" });
  source.warnings.push("Spreadsheet cell coordinates and sheet order are preserved. Number/date formatting, merged cells, drawings and image placement are not reproduced. All sheets are included; formulas are not recalculated and cached values may be stale.");
  return blocks;
}

export async function prepareDocument(file: File, id: string): Promise<PreparedDocument> {
  const kind = file.name.split(".").pop()?.toLowerCase() as "pdf" | "docx" | "xlsx";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source: SopSource = { id, name: file.name, kind, warnings: [] };
  const parts: LlmPart[] = [{ text: `Source ${id}: ${file.name}` }];
  if (kind === "pdf") {
    if (decoder.decode(bytes.subarray(0, 5)) !== "%PDF-") throw new SopInputError(`${file.name} is not a valid PDF.`);
    if (/\/Encrypt\b/.test(decoder.decode(bytes))) throw new SopInputError(`${file.name} is encrypted. Upload an unlocked copy.`);
    parts.push({ inlineData: { mimeType: "application/pdf", data: base64(bytes) } });
    return { source, parts };
  }
  if (!["docx", "xlsx"].includes(kind)) throw new SopInputError("Unsupported document type.");
  const entries = unpack(bytes);
  const main = kind === "docx" ? "word/document.xml" : "xl/workbook.xml";
  if (!entries[main] || !entries["[Content_Types].xml"]) throw new SopInputError(`${file.name} does not match its Office file extension.`);
  if (/macroEnabled|vbaProject/i.test(decoder.decode(entries["[Content_Types].xml"]))) throw new SopInputError("Macro-enabled documents are not supported. Export to PDF.");
  const media = Object.entries(entries).filter(([path]) => /^(word|xl)\/media\//.test(path));
  if (media.length > 20) throw new SopInputError(file.name + " contains more than 20 embedded images. Split it into smaller documents or export to PDF.");
  const images = new Map<string, string>();
  for (const [path, data] of media) {
    const mimeType = imageMime(data);
    if (!mimeType) throw new SopInputError(file.name + " contains an unsupported image format. Export it to PDF to preserve all visuals.");
    images.set(path, "data:" + mimeType + ";base64," + base64(data));
  }
  const blocks = kind === "docx" ? wordBlocks(entries, source, images) : workbookBlocks(entries, source, images);
  const text = blocks.filter((block) => block.type !== "image").map(blockText).join("\n");
  if (text.length > MAX_TEXT) throw new SopInputError(file.name + " has too much text for one procedure. Split it into smaller documents.");
  if (!text.trim() && !media.length) throw new SopInputError(file.name + " contains no readable text or supported images.");
  for (const block of blocks) {
    parts.push({ text: "Source block " + block.id + " (" + block.type + "): " + redactForLlm(blockText(block)).sanitizedText });
    if (block.type === "image" && block.src) { const comma = block.src.indexOf(","); parts.push({ inlineData: { mimeType: block.src.slice(5, block.src.indexOf(";")), data: block.src.slice(comma + 1) } }); }
  }
  parts.push({ text: "Extraction limitations for " + id + ": " + source.warnings.join(" ") });
  return { source, parts, blocks };

}
