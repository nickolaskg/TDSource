import { describe, expect, it } from "vitest";
import { redactForLlm } from "./redact.js";

describe("redactForLlm", () => {
  it("keeps the source input immutable and emits typed placeholders", () => {
    const source = "Quote #QT-48219 maps to PO number PO-99127.";
    const result = redactForLlm(source);
    expect(source).toContain("QT-48219");
    expect(result.sanitizedText).toBe("[QUOTE_NUMBER_1] maps to [PO_NUMBER_1].");
  });
});

