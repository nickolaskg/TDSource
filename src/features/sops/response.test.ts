import { describe, expect, it } from "vitest";
import { readSopResponse } from "./response";

describe("SOP response handling", () => {
  it("returns successful JSON", async () => {
    await expect(readSopResponse(Response.json({ available: true }), "Fallback")).resolves.toEqual({ available: true });
  });
  it("preserves actionable API error messages", async () => {
    await expect(readSopResponse(Response.json({ message: "Gemini is temporarily busy. Try again." }, { status: 503 }), "Fallback")).rejects.toThrow("Gemini is temporarily busy. Try again.");
  });
  it.each([408, 504, 524])("explains non-JSON timeout responses (%s) without exposing HTML or parse errors", async (status) => {
    await expect(readSopResponse(new Response("<html>private gateway diagnostic</html>", { status }), "Fallback")).rejects.toThrow("The request timed out. Your selected documents and notes are still here. Try again.");
  });
  it.each([[401, "session has expired"], [403, "permission"], [413, "too large"], [429, "request limit"], [502, "temporarily unavailable"]])("uses a status-specific fallback for %s", async (status, message) => {
    await expect(readSopResponse(new Response("", { status: Number(status) }), "Fallback")).rejects.toThrow(String(message));
  });
  it("handles malformed successful responses and empty API messages safely", async () => {
    await expect(readSopResponse(new Response("<html>Unexpected page</html>"), "The SOP could not be generated.")).rejects.toThrow("The SOP could not be generated.");
    await expect(readSopResponse(Response.json(null), "Fallback")).rejects.toThrow("Fallback");
    await expect(readSopResponse(Response.json({ message: " " }, { status: 400 }), "Fallback")).rejects.toThrow("Fallback");
  });
});
