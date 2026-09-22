import { Fragment, useEffect, useState, type ReactNode } from "react";
import { blockText, type SopBlock, type SopContent, type SopRun } from "../../domain/sop-content";
import { resolveSuggestion } from "./content-review";

function Runs({ runs = [] }: { runs?: SopRun[] }) {
  return runs.map((run, index) => {
    let text: ReactNode = run.text;
    if (run.bold) text = <strong>{text}</strong>;
    if (run.italic) text = <em>{text}</em>;
    if (run.underline) text = <u>{text}</u>;
    return <Fragment key={index}>{text}</Fragment>;
  });
}

function safeImageSource(src?: string): string | undefined {
  return src && (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(src) || /^\/api\/sop-assets\/[0-9a-f-]+\/[0-9a-f-]+\/[^/]+$/i.test(src)) ? src : undefined;
}

function Block({ block }: { block: SopBlock }) {
  if (block.type === "heading") {
    const Heading = `h${Math.max(2, Math.min(6, block.level || 2))}` as "h2" | "h3" | "h4" | "h5" | "h6";
    return <Heading id={`sop-block-${block.id}`}>{block.marker && `${block.marker} `}<Runs runs={block.runs} /></Heading>;
  }
  if (block.type === "table") return <div className="sop-table-scroll" tabIndex={0} role="region" aria-label={`Table from ${block.sourceId}`}><table><tbody>{block.rows?.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}><Runs runs={cell} /></td>)}</tr>)}</tbody></table></div>;
  if (block.type === "image") { const src = safeImageSource(block.src); return <figure>{src ? <img src={src} alt={block.alt || `Image from ${block.sourceId}`} /> : <p>Image unavailable. Check the original document.</p>}{block.alt && <figcaption>{block.alt}</figcaption>}</figure>; }
  return <p id={`sop-block-${block.id}`}><Runs runs={block.runs} /></p>;
}

function List({ blocks }: { blocks: SopBlock[] }) {
  const level = blocks[0].level || 0;
  const ListTag = blocks[0].ordered ? "ol" : "ul";
  const items: ReactNode[] = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    let end = index + 1;
    while (end < blocks.length && (blocks[end].level || 0) > level) end++;
    items.push(<li key={block.id} id={`sop-block-${block.id}`} style={block.marker ? { listStyleType: "none" } : undefined}>{block.marker && <span className="sop-import-marker">{block.marker} </span>}<Runs runs={block.runs} />{end > index + 1 && <ContentBlocks blocks={blocks.slice(index + 1, end)} />}</li>);
    index = end;
  }
  return <ListTag>{items}</ListTag>;
}

export function ContentBlocks({ blocks }: { blocks: SopBlock[] }) {
  const children: ReactNode[] = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    if (block.type !== "list-item") { children.push(<Block key={block.id} block={block} />); index++; continue; }
    let end = index + 1;
    const level = block.level || 0;
    while (end < blocks.length && blocks[end].type === "list-item" && blocks[end].sourceId === block.sourceId && (blocks[end].level || 0) >= level && ((blocks[end].level || 0) > level || !!blocks[end].ordered === !!block.ordered)) end++;
    children.push(<List key={block.id} blocks={blocks.slice(index, end)} />);
    index = end;
  }
  return <>{children}</>;
}

export function SopContentEditor({ content, onChange }: { content: SopContent; onChange: (content: SopContent) => void }) {
  const updateRun = (blockIndex: number, runIndex: number, text: string) => onChange({ ...content, blocks: content.blocks.map((block, index) => index !== blockIndex ? block : { ...block, runs: block.runs?.map((run, position) => position === runIndex ? { ...run, text } : run) }) });
  const updateCellRun = (blockIndex: number, rowIndex: number, cellIndex: number, runIndex: number, text: string) => onChange({ ...content, blocks: content.blocks.map((block, index) => index !== blockIndex ? block : { ...block, rows: block.rows?.map((row, rowPosition) => rowPosition !== rowIndex ? row : row.map((cell, cellPosition) => cellPosition !== cellIndex ? cell : cell.map((run, runPosition) => runPosition === runIndex ? { ...run, text } : run))) }) });
  const updateAlt = (blockIndex: number, alt: string) => onChange({ ...content, blocks: content.blocks.map((block, index) => index === blockIndex ? { ...block, alt } : block) });
  return <div className="sop-content-editor">
    {content.blocks.map((block, blockIndex) => <section key={block.id} className="sop-content-editor-block">
      <span>{block.type.replace("-", " ")}</span>
      {block.type === "image" ? <label>Image description<input value={block.alt || ""} maxLength={1000} onChange={(event) => updateAlt(blockIndex, event.target.value)} /></label>
        : block.type === "table" ? block.rows?.map((row, rowIndex) => <div className="sop-content-editor-row" key={rowIndex}>{row.map((cell, cellIndex) => <div key={cellIndex}>{cell.map((run, runIndex) => <textarea aria-label={`Table row ${rowIndex + 1} column ${cellIndex + 1} text ${runIndex + 1}`} key={runIndex} value={run.text} maxLength={8000} rows={2} onChange={(event) => updateCellRun(blockIndex, rowIndex, cellIndex, runIndex, event.target.value)} />)}</div>)}</div>)
          : block.runs?.map((run, runIndex) => <textarea aria-label={`${block.type} text ${runIndex + 1}`} key={runIndex} value={run.text} maxLength={8000} rows={block.type === "heading" ? 1 : 3} onChange={(event) => updateRun(blockIndex, runIndex, event.target.value)} />)}
    </section>)}
  </div>;
}

export function OriginalFile({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return <span className="sop-original-links">{url && <><a href={url} target="_blank" rel="noreferrer">Open original {file.name}</a><a href={url} download={file.name}>Download original</a></>}</span>;
}

export function SopContentView({ content, onChange }: { content: SopContent; onChange: (content: SopContent) => void }) {
  return <div className="sop-imported-content">
    <p><strong>{content.blocks.length} imported blocks.</strong> This count describes imported content, not verified accuracy or completeness. Compare every section and exception with the originals. PDF transcription can omit or misread content.</p>
    {content.limitations.length > 0 && <section className="sop-draft-callout"><h3>Import limitations</h3><ul>{content.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    <ContentBlocks blocks={content.blocks} />
    <section className="sop-suggestions"><h3>Optional AI wording suggestions</h3><p>Imported wording stays unchanged until you accept an individual suggestion. Accepting replaces only that text block and removes its inline emphasis; lists and other blocks remain unchanged.</p>
      {!content.suggestions.length && <p>No pending suggestions.</p>}
      {content.suggestions.map((suggestion, index) => {
        const block = content.blocks.find((item) => item.id === suggestion.blockId);
        const canAccept = block && ["heading", "paragraph", "list-item"].includes(block.type) && blockText(block) === suggestion.original;
        return <section className="sop-draft-callout" key={`${suggestion.blockId}-${index}`}><h4>Suggestion {index + 1}</h4><p><strong>Before:</strong> {suggestion.original}</p><p><strong>After:</strong> {suggestion.replacement}</p><p><strong>Reason:</strong> {suggestion.reason}</p>{!canAccept && <p>The source block has changed or cannot be edited here. Reject this suggestion.</p>}<button type="button" className="sop-secondary-button" disabled={!canAccept} onClick={() => onChange(resolveSuggestion(content, index, true))}>Accept suggestion {index + 1}</button> <button type="button" className="sop-secondary-button" onClick={() => onChange(resolveSuggestion(content, index, false))}>Reject suggestion {index + 1}</button></section>;
      })}
    </section>
  </div>;
}

