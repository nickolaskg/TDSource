import { afterEach, describe, expect, it, vi } from "vitest";
import { clearApiCache, getJsonCached, invalidateApiCache } from "./api-cache.js";

afterEach(() => {
  clearApiCache();
  vi.unstubAllGlobals();
});

describe("in-memory API response cache", () => {
  it("deduplicates concurrent and recent successful GET requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [1] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      getJsonCached<{ items: number[] }>("/api/library"),
      getJsonCached<{ items: number[] }>("/api/library"),
    ]);
    const third = await getJsonCached<{ items: number[] }>("/api/library");

    expect(first).toEqual({ items: [1] });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after matching data is invalidated", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getJsonCached("/api/reviews");
    invalidateApiCache("/api/reviews");
    await getJsonCached("/api/reviews");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
