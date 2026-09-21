import { describe, expect, it } from "vitest";
import { parseCaptureCommand } from "./command.js";

describe("parseCaptureCommand", () => {
  it.each(["@TDS document", "  @tds UPDATE  "])("accepts exact commands: %s", (value) => {
    expect(parseCaptureCommand(value, "TDS")).not.toBeNull();
  });

  it.each(["@TDS document now", "please @TDS update", "@Other document", "@TDS capture"])(
    "rejects command variants outside the approved syntax: %s",
    (value) => expect(parseCaptureCommand(value, "TDS")).toBeNull(),
  );
});

