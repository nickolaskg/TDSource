export type RedactionKind =
  | "QUOTE_NUMBER"
  | "SERIAL_NUMBER"
  | "CONTRACT_NUMBER"
  | "SUBSCRIPTION_ID"
  | "PO_NUMBER"
  | "SO_NUMBER";

export interface RedactionRule {
  kind: RedactionKind;
  pattern: RegExp;
}

export interface RedactionResult {
  sanitizedText: string;
  counts: Partial<Record<RedactionKind, number>>;
}

export const defaultRedactionRules: readonly RedactionRule[] = [
  { kind: "QUOTE_NUMBER", pattern: /\bquote(?:\s+number|\s*#|\s+no\.?|:)\s*[a-z0-9-]{4,}\b/gi },
  { kind: "SERIAL_NUMBER", pattern: /\bserial(?:\s+number|\s*#|\s+no\.?|:)\s*[a-z0-9-]{4,}\b/gi },
  { kind: "CONTRACT_NUMBER", pattern: /\bcontract(?:\s+number|\s*#|\s+no\.?|:)\s*[a-z0-9-]{4,}\b/gi },
  { kind: "SUBSCRIPTION_ID", pattern: /\bsubscription(?:\s+id|\s*#|:)\s*[a-z0-9-]{4,}\b/gi },
  { kind: "PO_NUMBER", pattern: /\bpo(?:\s+number|\s*#|\s+no\.?|:)\s*[a-z0-9-]{4,}\b/gi },
  { kind: "SO_NUMBER", pattern: /\bso(?:\s+number|\s*#|\s+no\.?|:)\s*[a-z0-9-]{4,}\b/gi },
];

export function redactForLlm(
  sourceText: string,
  rules: readonly RedactionRule[] = defaultRedactionRules,
): RedactionResult {
  const counts: RedactionResult["counts"] = {};
  const indices: Partial<Record<RedactionKind, number>> = {};
  let sanitizedText = sourceText;

  for (const rule of rules) {
    sanitizedText = sanitizedText.replace(rule.pattern, () => {
      const next = (indices[rule.kind] ?? 0) + 1;
      indices[rule.kind] = next;
      counts[rule.kind] = next;
      return `[${rule.kind}_${next}]`;
    });
  }

  return { sanitizedText, counts };
}

