import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { prepareDocument } from "./documents.js";
import { blockText, contentMarkdown } from "../../../src/domain/sop-content.js";
const png = new Uint8Array([137,80,78,71,13,10,26,10]);
function office(name: string, entries: Record<string, string | Uint8Array>) {
  return new File([new Uint8Array(zipSync(Object.fromEntries(Object.entries({ "[Content_Types].xml": "<Types/>", ...entries }).map(([key, value]) => [key, typeof value === "string" ? strToU8(value) : value]))))], name);
}
const p = (text: string, properties = "") => `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const num = (level: number) => `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="7"/></w:numPr></w:pPr>`;
describe("faithful Office procedure extraction", () => {
  it("retains headings, style-based nested numbering, emphasis, percentages, exceptions, tables and image order", async () => {
    const result = await prepareDocument(office("synthetic.docx", {
      "word/document.xml": `<w:document><w:body>${p("Quote procedure", '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>')}${p("Choose quote", num(0))}${p("Choose account", '<w:pPr><w:pStyle w:val="NestedStep"/></w:pPr>')}${p("Check account", num(1))}${p("Enter price", num(0))}${p("Verify price", num(1))}<w:p><w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/></w:rPr><w:t>42%</w:t></w:r><w:r><w:t> discount only when approved.</w:t></w:r></w:p>${p("EDU DART exception: use the education workflow.")}<w:p><w:r><w:drawing><a:blip r:embed="rIdPicture"/></w:drawing></w:r></w:p><w:tbl><w:tr><w:tc>${p("Condition")}</w:tc><w:tc>${p("Action")}</w:tc></w:tr><w:tr><w:tc>${p("EDU")}</w:tc><w:tc>${p("DART")}</w:tc></w:tr></w:tbl>${p("Final verification.")}</w:body></w:document>`,
      "word/styles.xml": '<w:styles><w:style w:styleId="NestedStep"><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr></w:style></w:styles>',
      "word/numbering.xml": '<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="rIdPicture" Target="media/image1.png"/></Relationships>',
      "word/media/image1.png": png,
    }), "D1");
    const blocks = result.blocks!;
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks.filter((b) => b.type === "list-item").map((b) => [b.level, b.marker])).toEqual([[0,"1."],[1,"1.a)"],[1,"1.b)"],[0,"2."],[1,"2.a)"]]);
    expect(blocks[6].runs?.[0]).toEqual({ text: "42%", bold: true, italic: true, underline: true });
    expect(blockText(blocks[7])).toBe("EDU DART exception: use the education workflow.");
    expect(blocks[8]).toMatchObject({ type: "image", src: expect.stringMatching(/^data:image\/png;base64,/) });
    expect(blocks[9].rows?.map((row) => row.map((cell) => cell.map((run) => run.text).join("")))).toEqual([["Condition","Action"],["EDU","DART"]]);
    expect(blockText(blocks[10])).toBe("Final verification.");
    expect(blocks.map((b) => b.id)).toEqual(blocks.map((_, i) => `D1-B${i+1}`));
    expect(result.parts.some((part) => "text" in part && part.text.includes("D1-B8") && part.text.includes("EDU DART"))).toBe(true);
    const markdown = contentMarkdown({ blocks, suggestions: [], limitations: result.source.warnings });
    expect(markdown).toContain("1.a)"); expect(markdown).toContain("42%"); expect(markdown).toContain("EDU DART");
  });
  it("keeps raw source wording separate from redacted model evidence", async () => {
    const result = await prepareDocument(office("sample.docx", { "word/document.xml": `<w:document><w:body>${p("Quote number ABC123456")}</w:body></w:document>` }), "D2");
    expect(blockText(result.blocks![0])).toBe("Quote number ABC123456");
    const evidence = result.parts.filter((part) => "text" in part).map((part) => part.text).join("\n");
    expect(evidence).toContain("D2-B1"); expect(evidence).toContain("[QUOTE_NUMBER_1]"); expect(evidence).not.toContain("ABC123456");
  });
  it("never loads external image relationships and reports unsupported placement", async () => {
    const result = await prepareDocument(office("sample.docx", {
      "word/document.xml": `<w:document><w:body>${p("Original wording")}<w:p><w:r><w:drawing><a:blip r:embed="remote"/></w:drawing></w:r></w:p></w:body></w:document>`,
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="remote" Target="https://example.invalid/tracker.png" TargetMode="External"/></Relationships>',
    }), "D1");
    expect(result.blocks?.some((block) => block.src)).toBe(false);
    expect(result.source.warnings.join(" ")).toContain("linked or unsupported image");
  });
  it("keeps sparse spreadsheet columns, cell addresses, shared strings and cached formulas", async () => {
    const result = await prepareDocument(office("sample.xlsx", {
      "xl/workbook.xml": '<workbook><sheets><sheet name="Procedure" r:id="r1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml": '<sst><si><t>EDU DART</t></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>42%</t></is></c></row><row r="5"><c r="A5"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>',
    }), "D3");
    expect(result.blocks![0]).toMatchObject({ type: "heading", runs: [{ text: "Sheet: Procedure" }] });
    const table = result.blocks![1]; expect(table.type).toBe("table"); expect(table.rows![0][1]).toEqual([]);
    expect(blockText(table)).toContain("A1: EDU DART\t\tC1: 42%"); expect(blockText(table)).toContain("A5: 4 (formula: 2+2; cached values may be stale)");
    expect(result.source.warnings.join(" ")).toContain("Number/date formatting");
  });
  it("imports one compatibility branch, decodes numeric entities, and flags omitted notes", async () => {
    const result = await prepareDocument(office("sample.docx", {
      "word/document.xml": '<w:document><w:body><w:p><mc:AlternateContent><mc:Choice><w:r><w:t>42&#37; approved</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>Duplicate fallback</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p></w:body></w:document>',
      "word/footnotes.xml": '<w:footnotes><w:footnote><w:p><w:r><w:t>Additional condition</w:t></w:r></w:p></w:footnote></w:footnotes>',
    }), "D1");
    expect(result.blocks!.map(blockText)).toEqual(["42% approved"]);
    expect(result.source.warnings.join(" ")).toContain("footnotes or endnotes contain additional text");
  });
  it("continues rejecting tracked revisions before extracting blocks", async () => {
    await expect(prepareDocument(office("sample.docx", { "word/document.xml": '<w:document><w:body><w:p><w:del><w:r><w:delText>Obsolete</w:delText></w:r></w:del></w:p></w:body></w:document>' }), "D1")).rejects.toThrow("tracked changes");
  });
  it("escapes source HTML in Markdown and refuses arbitrary image URLs", () => {
    const markdown = contentMarkdown({ blocks: [{ id: "D1-B1", sourceId: "D1", type: "paragraph", runs: [{ text: "<script>bad</script> [link](https://example.invalid)" }] }, { id: "D1-B2", sourceId: "D1", type: "image", src: "https://example.invalid/private", alt: "remote" }], suggestions: [], limitations: [] });
    expect(markdown).not.toContain("<script>"); expect(markdown).not.toContain("](https://example.invalid/private)"); expect(markdown).toContain("[Image unavailable]");
  });
});
