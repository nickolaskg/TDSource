import { describe, expect, it } from "vitest";
import { isApprovedEmail } from "./email-domain.js";

describe("isApprovedEmail", () => {
  it("accepts the complete approved domain case-insensitively", () => {
    expect(isApprovedEmail("Person@TDSYNNEX.COM", ["tdsynnex.com"])).toBe(true);
  });

  it.each(["person@sub.tdsynnex.com", "person@tdsynnex.com.example", "tdsynnex.com"])(
    "rejects subdomains, lookalikes, and invalid addresses: %s",
    (email) => expect(isApprovedEmail(email, ["tdsynnex.com"])).toBe(false),
  );
});

