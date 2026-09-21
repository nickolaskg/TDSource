import { describe, expect, it } from "vitest";
import { canAccessReviewQueue, canAdministerTeams } from "./access.js";

describe("review queue access", () => {
  it("denies Standard Users", () => {
    expect(canAccessReviewQueue([{ role: "basic" }])).toBe(false);
  });

  it("allows Moderators and Admins", () => {
    expect(canAccessReviewQueue([{ role: "moderator" }])).toBe(true);
    expect(canAccessReviewQueue([{ role: "admin" }])).toBe(true);
  });
});

describe("team administration access", () => {
  it("allows Admins but not Moderators or Standard Users", () => {
    expect(canAdministerTeams([{ role: "basic" }])).toBe(false);
    expect(canAdministerTeams([{ role: "moderator" }])).toBe(false);
    expect(canAdministerTeams([{ role: "admin" }])).toBe(true);
  });
});
