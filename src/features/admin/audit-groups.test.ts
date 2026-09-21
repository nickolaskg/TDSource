import { describe, expect, it } from "vitest";
import { groupAuditEventsByDate } from "./audit-groups";

describe("audit history date groups", () => {
  it("keeps events from each local calendar day in one ordered group", () => {
    const groups = groupAuditEventsByDate([
      { id: "newer", occurred_at: "2026-09-02T14:00:00" },
      { id: "same-day", occurred_at: "2026-09-02T09:00:00" },
      { id: "older", occurred_at: "2026-09-01T16:00:00" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].events.map(({ id }) => id)).toEqual(["newer", "same-day"]);
    expect(groups[1].events.map(({ id }) => id)).toEqual(["older"]);
  });
});
