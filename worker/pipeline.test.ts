import { describe, expect, it } from "vitest";
import { buildKnowledgeContext, rankKnowledge } from "../server/modules/knowledge/chat.js";
import { adminSetupInvitationStatus, canAccessIntegrationSettings, defaultReviewOrganizationWide, documentAssetKeys, durableSessionDeadlines, hasReviewAccess, isOpaqueSessionToken, mergeSourceContentEdit, normalizeAvatarUrl, normalizeBotCommand, normalizedSourceMessages, organizationWideFromReview, sourceContentFromEvidenceMap, sourceContentText, validateGeminiDraft, verifyWebhookSignature, webhookEventId } from "./index.js";

describe("integration settings access", () => {
  it("allows only the designated developer account", () => {
    expect(canAccessIntegrationSettings("nickolas.gettel@tdsynnex.com")).toBe(true);
    expect(canAccessIntegrationSettings(" NICKOLAS.GETTEL@TDSYNNEX.COM ")).toBe(true);
    expect(canAccessIntegrationSettings("admin@tdsynnex.com")).toBe(false);
    expect(canAccessIntegrationSettings(undefined)).toBe(false);
  });
});

describe("permanent document asset cleanup", () => {
  it("uses only unique asset keys returned by the deleted document RPC", () => {
    expect(documentAssetKeys({ assetKeys: ["org/upload/image.png", "org/upload/image.png", null] })).toEqual(["org/upload/image.png"]);
    expect(documentAssetKeys({})).toEqual([]);
  });
});

describe("review publication visibility", () => {
  it("publishes organization-wide by default and honors an explicit private choice", () => {
    expect(organizationWideFromReview(undefined)).toBe(true);
    expect(organizationWideFromReview(true)).toBe(true);
    expect(organizationWideFromReview(false)).toBe(false);
  });

  it("defaults never-published reviews to organization-wide despite legacy stored values", () => {
    expect(defaultReviewOrganizationWide(false, false)).toBe(true);
    expect(defaultReviewOrganizationWide(true, false)).toBe(true);
  });

  it("preserves the visibility of an already-published document during an update", () => {
    expect(defaultReviewOrganizationWide(false, true)).toBe(false);
    expect(defaultReviewOrganizationWide(true, true)).toBe(true);
  });
});

describe("source-faithful presentation", () => {
  const content = { blocks: [{ id: "D1-B1", sourceId: "D1", type: "paragraph", runs: [{ text: "Keep this wording", bold: true }] }], limitations: [] };

  it("returns validated source content stored separately from retrieval text", () => {
    expect(sourceContentFromEvidenceMap({ source: "local_sop_upload", source_content: { ...content, untrusted: "not returned" } })).toEqual({ ...content, suggestions: [] });
  });

  it("accepts only bounded private asset keys", () => {
    expect(sourceContentFromEvidenceMap({ source_content: { ...content, blocks: [{ ...content.blocks[0], type: "image", assetKey: "org/upload/D1-B1.png" }] } })?.blocks[0]).toMatchObject({ assetKey: "org/upload/D1-B1.png" });
    expect(sourceContentFromEvidenceMap({ source_content: { ...content, blocks: [{ ...content.blocks[0], type: "image", assetKey: "../secret.png" }] } })).toBeNull();
  });

  it("omits malformed or binary presentation content", () => {
    expect(sourceContentFromEvidenceMap({ source_content: { ...content, blocks: [{ ...content.blocks[0], src: "data:image/png;base64,AAAA" }] } })).toBeNull();
    expect(sourceContentFromEvidenceMap({ source_content: { blocks: "invalid", limitations: [] } })).toBeNull();
  });

  it("uses approved presentation text for ranking and grounded context", () => {
    const sourceText = sourceContentText(sourceContentFromEvidenceMap({ source_content: content }));
    const ranked = rankKnowledge("wording", [{ id: "doc-1", title: "Procedure", summary: "", problem: "", steps: [], warnings: [], sourceText }]);
    expect(ranked).toHaveLength(1);
    expect(buildKnowledgeContext(ranked)).toContain("Keep this wording");
    expect(sourceContentText(sourceContentFromEvidenceMap({ source_content: { ...content, blocks: [{ ...content.blocks[0], src: "data:image/png;base64,AAAA" }] } }))).toBe("");
  });

  it("allows text edits while preserving structure, formatting, and asset keys", () => {
    const existing = sourceContentFromEvidenceMap({ source_content: { blocks: [
      { id: "text", sourceId: "D1", type: "paragraph", runs: [{ text: "Before", bold: true }] },
      { id: "image", sourceId: "D1", type: "image", alt: "Before", assetKey: "org/upload/image.png" },
    ], suggestions: [], limitations: [] } });
    const edited = mergeSourceContentEdit(existing, { blocks: [
      { id: "text", sourceId: "D1", type: "paragraph", runs: [{ text: "After", bold: true }] },
      { id: "image", sourceId: "D1", type: "image", alt: "After", src: "/api/sop-assets/document/version/image" },
    ] });
    expect(edited?.blocks[0]).toMatchObject({ runs: [{ text: "After", bold: true }] });
    expect(edited?.blocks[1]).toMatchObject({ alt: "After", assetKey: "org/upload/image.png" });
  });

  it("rejects SOP structure, formatting, and asset tampering", () => {
    const existing = sourceContentFromEvidenceMap({ source_content: { blocks: [{ id: "text", sourceId: "D1", type: "paragraph", runs: [{ text: "Before", bold: true }] }], suggestions: [], limitations: [] } });
    expect(mergeSourceContentEdit(existing, { blocks: [{ id: "other", sourceId: "D1", type: "paragraph", runs: [{ text: "After", bold: true }] }] })).toBeNull();
    expect(mergeSourceContentEdit(existing, { blocks: [{ id: "text", sourceId: "D1", type: "paragraph", runs: [{ text: "After", bold: false }] }] })).toBeNull();
    expect(mergeSourceContentEdit(existing, { blocks: [{ id: "text", sourceId: "D1", type: "paragraph", assetKey: "other/image.png", runs: [{ text: "After", bold: true }] }] })).toBeNull();
  });
});

describe("durable user sessions", () => {
  it("recognizes only the fixed-length opaque browser token format", () => {
    expect(isOpaqueSessionToken("a".repeat(64))).toBe(true);
    expect(isOpaqueSessionToken("a".repeat(63))).toBe(false);
    expect(isOpaqueSessionToken(`${"a".repeat(63)}!`)).toBe(false);
  });

  it("uses a seven-day idle window capped by a thirty-day absolute window", () => {
    const day = 24 * 60 * 60 * 1000;
    const deadlines = durableSessionDeadlines(0, 90 * 24 * 60 * 60);
    expect(deadlines.idleExpiresAt).toBe(7 * day);
    expect(deadlines.absoluteExpiresAt).toBe(30 * day);
    expect(deadlines.refreshExpiresAt).toBe(90 * day);
  });

  it("never outlives a shorter refresh credential", () => {
    const day = 24 * 60 * 60 * 1000;
    const deadlines = durableSessionDeadlines(0, 3 * 24 * 60 * 60);
    expect(deadlines.idleExpiresAt).toBe(3 * day);
    expect(deadlines.absoluteExpiresAt).toBe(3 * day);
  });
});

describe("Team Admin setup invitations", () => {
  it("reports terminal invitation states before transient states", () => {
    const future = "2026-09-08T00:00:00Z"; const past = "2026-08-31T00:00:00Z"; const now = Date.parse("2026-09-01T00:00:00Z");
    expect(adminSetupInvitationStatus({ expires_at: future, started_at: null, redeemed_at: null, revoked_at: null }, now)).toBe("pending");
    expect(adminSetupInvitationStatus({ expires_at: future, started_at: future, redeemed_at: null, revoked_at: null }, now)).toBe("setup_started");
    expect(adminSetupInvitationStatus({ expires_at: past, started_at: null, redeemed_at: null, revoked_at: null }, now)).toBe("expired");
    expect(adminSetupInvitationStatus({ expires_at: past, started_at: null, redeemed_at: future, revoked_at: null }, now)).toBe("completed");
  });
});

describe("Webex profile pictures", () => {
  it("accepts only valid HTTPS avatar URLs", () => {
    expect(normalizeAvatarUrl("https://avatar.example.test/person.png")).toBe("https://avatar.example.test/person.png");
    expect(normalizeAvatarUrl("http://avatar.example.test/person.png")).toBeUndefined();
    expect(normalizeAvatarUrl("not a URL")).toBeUndefined();
  });
});

describe("review API role boundary", () => {
  it("denies basic-only users and allows staff", () => {
    expect(hasReviewAccess([{ role: "basic" }])).toBe(false);
    expect(hasReviewAccess([{ role: "moderator" }])).toBe(true);
    expect(hasReviewAccess([{ role: "admin" }])).toBe(true);
  });
});

describe("Webex command normalization", () => {
  it("accepts exact commands after removing provider mention markup", () => {
    expect(normalizeBotCommand({ markdown: "<@personEmail:bot@example.com|TDS> document" }, "TDS")).toBe("document");
    expect(normalizeBotCommand({ text: "TDS update" }, "TDS")).toBe("update");
  });

  it("rejects commands embedded in ordinary prose", () => {
    expect(normalizeBotCommand({ text: "Please ask TDS to document this" }, "TDS")).toBeNull();
  });
});

describe("Webex webhook signatures", () => {
  it("accepts only the matching HMAC-SHA1 signature", async () => {
    const body = JSON.stringify({ id: "event-1" });
    const secret = "test-secret";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
    const signature = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await expect(verifyWebhookSignature(body, signature, secret)).resolves.toBe(true);
    await expect(verifyWebhookSignature(`${body}x`, signature, secret)).resolves.toBe(false);
  });
});

describe("Webex webhook idempotency", () => {
  it("uses each created message id rather than the repeating webhook id", () => {
    const first = { id: "same-webhook", data: { id: "command-1" } };
    const second = { id: "same-webhook", data: { id: "command-2" } };
    expect(webhookEventId(first)).toBe("command-1");
    expect(webhookEventId(second)).toBe("command-2");
  });
});

describe("Gemini evidence validation", () => {
  const draft = { title: "Title", problem: "Problem", summary: "Summary", steps: ["Step"], warnings: [], evidence: { problem: [1], summary: [1], steps: [[2]], warnings: [] } };

  it("accepts evidence that refers to source messages", () => {
    expect(validateGeminiDraft(draft, 2).title).toBe("Title");
  });

  it("rejects evidence outside the immutable snapshot", () => {
    expect(() => validateGeminiDraft(draft, 1)).toThrow(/invalid message/);
  });
});

describe("source message normalization", () => {
  it("excludes bot acknowledgements and exact capture commands", () => {
    const root = { id: "root", roomId: "room", personId: "user-a", text: "How do I reset the test widget?", created: "2026-08-28T10:00:00Z" };
    const replies = [
      { id: "answer", roomId: "room", parentId: "root", personId: "user-b", text: "Use the synthetic reset control.", created: "2026-08-28T10:01:00Z" },
      { id: "command", roomId: "room", parentId: "root", personId: "user-a", text: "@TDS document", created: "2026-08-28T10:02:00Z" },
      { id: "ack", roomId: "room", parentId: "root", personId: "bot", text: "Captured.", created: "2026-08-28T10:03:00Z" },
    ];
    expect(normalizedSourceMessages(root, replies, "room", "TDS", "bot").map(({ id }) => id)).toEqual(["root", "answer"]);
  });
});
