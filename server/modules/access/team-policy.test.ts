import { describe, expect, it } from "vitest";
import { canReviseSharedKnowledge, canSeePendingReview, resolveCaptureReviewTeam } from "./team-policy.js";

describe("team-scoped capture routing", () => {
  it("routes default-team staff into the default review queue", () => {
    expect(resolveCaptureReviewTeam("team-a", [{ teamId: "team-a", role: "moderator" }], [])).toBe("team-a");
  });

  it("routes shared-team staff to the default team only with an active grant", () => {
    const actor = [{ teamId: "team-b", role: "admin" }] as const;
    expect(resolveCaptureReviewTeam("team-a", actor, ["team-b"])).toBe("team-a");
    expect(resolveCaptureReviewTeam("team-a", actor, [])).toBeNull();
  });

  it("silently denies basic users even when their team has a sharing grant", () => {
    expect(resolveCaptureReviewTeam("team-a", [{ teamId: "team-b", role: "basic" }], ["team-b"])).toBeNull();
  });
});

describe("pending review and published revision segmentation", () => {
  const grants = [
    { teamId: "team-a", role: "basic" as const },
    { teamId: "team-b", role: "moderator" as const },
  ];

  it("does not expose another team's pending queue", () => {
    expect(canSeePendingReview("team-a", grants)).toBe(false);
    expect(canSeePendingReview("team-b", grants)).toBe(true);
  });

  it("allows only recipient-team staff to revise shared knowledge", () => {
    expect(canReviseSharedKnowledge("team-b", grants)).toBe(true);
    expect(canReviseSharedKnowledge("team-a", grants)).toBe(false);
  });
});
