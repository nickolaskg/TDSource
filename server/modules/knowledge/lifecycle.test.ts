import { describe, expect, it, vi } from "vitest";
import { isCurrentKnowledge, libraryLifecycleFilter, mutateKnowledgeLifecycle, parseLifecycleAction } from "./lifecycle.js";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
function request(body: unknown) { return new Request("https://tds.test/api/library/" + id + "/lifecycle", { method: "POST", body: JSON.stringify(body) }); }
describe("current knowledge eligibility", () => {
  it("fails closed for deprecated, outdated, null and unknown labels", () => {
    for (const label of ["deprecated", "outdated", null, undefined, "pending", ""]) expect(isCurrentKnowledge(label)).toBe(false);
    expect(isCurrentKnowledge("verified")).toBe(true); expect(isCurrentKnowledge("unresolved")).toBe(true);
  });
  it("filters current labels unless historical access is explicitly requested", () => {
    expect(libraryLifecycleFilter(false)).toBe("&knowledge_label=in.(verified,unresolved)");
    expect(libraryLifecycleFilter(true)).toBe("");
  });
});
describe("lifecycle action validation", () => {
  it("requires bounded reasons and known actions", () => {
    for (const value of [null, {}, { action: "flag", reason: " " }, { action: "flag", reason: "a".repeat(2001) }, { action: "restore", reason: "x" }]) expect(parseLifecycleAction(value)).toBeNull();
    expect(parseLifecycleAction({ action: "flag", reason: " Updated procedure " })?.reason).toBe("Updated procedure");
  });
  it("requires flag identity only for decisions and validates all IDs", () => {
    expect(parseLifecycleAction({ action: "approve", reason: "x" })).toBeNull();
    expect(parseLifecycleAction({ action: "flag", reason: "x", requestId })).toBeNull();
    expect(parseLifecycleAction({ action: "approve", reason: "x", requestId })?.requestId).toBe(requestId);
    expect(parseLifecycleAction({ action: "deprecate", reason: "x", replacementId: "oops&select=*" })).toBeNull();
    expect(parseLifecycleAction({ action: "flag", reason: "x", replacementId: other })).toBeNull();
  });
});
describe("lifecycle mutation boundary", () => {
  it("allows a Basic reader to report without changing the label directly", async () => {
    const db = vi.fn().mockResolvedValue(requestId);
    const response = await mutateKnowledgeLifecycle(request({ action: "flag", reason: "obsolete" }), id, { userId: other, readIds: [id], reviseIds: [], db });
    expect(response.status).toBe(200); expect(db).toHaveBeenCalledTimes(1);
    expect(JSON.parse(db.mock.calls[0][1].body)).toMatchObject({ p_action: "flag", p_user_id: other });
  });
  it.each(["deprecate", "outdate", "approve", "reject"])("denies Basic-user %s without database writes", async (action) => {
    const db = vi.fn(); const response = await mutateKnowledgeLifecycle(request({ action, reason: "obsolete", ...(action === "approve" || action === "reject" ? { requestId } : {}) }), id, { userId: other, readIds: [id], reviseIds: [], db });
    expect(response.status).toBe(403); expect(db).not.toHaveBeenCalled();
  });
  it("hides inaccessible documents even from staff in another team", async () => {
    const db = vi.fn(); const response = await mutateKnowledgeLifecycle(request({ action: "deprecate", reason: "obsolete" }), id, { userId: other, readIds: [], reviseIds: [], db });
    expect(response.status).toBe(404); expect(db).not.toHaveBeenCalled();
  });
  it.each([id, other])("rejects self or inaccessible replacements %s", async (replacementId) => {
    const db = vi.fn(); const response = await mutateKnowledgeLifecycle(request({ action: "deprecate", reason: "obsolete", replacementId }), id, { userId: other, readIds: [id], reviseIds: [id], db });
    expect(response.status).toBe(400); expect(db).not.toHaveBeenCalled();
  });
  it("passes authorized decisions atomically with actor and request IDs", async () => {
    const db = vi.fn().mockResolvedValue(id); const response = await mutateKnowledgeLifecycle(request({ action: "approve", reason: "confirmed", requestId, replacementId: other }), id, { userId: other, readIds: [id, other], reviseIds: [id], db });
    expect(response.status).toBe(200); expect(JSON.parse(db.mock.calls[0][1].body)).toMatchObject({ p_action: "approve", p_request_id: requestId, p_replacement_id: other });
  });
  it("returns a safe failure without provider details", async () => {
    const db = vi.fn().mockRejectedValue(new Error("secret database connection value")); const response = await mutateKnowledgeLifecycle(request({ action: "flag", reason: "obsolete" }), id, { userId: other, readIds: [id], reviseIds: [], db });
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("secret");
  });
});
