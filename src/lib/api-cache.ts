interface CacheEntry<T> {
  expiresAt: number;
  value?: T;
  inFlight?: Promise<T>;
}

const responseCache = new Map<string, CacheEntry<unknown>>();

export async function getJsonCached<T>(path: string, ttlMs = 15_000): Promise<T> {
  const existing = responseCache.get(path) as CacheEntry<T> | undefined;
  if (existing?.value !== undefined && existing.expiresAt > Date.now()) return existing.value;
  if (existing?.inFlight) return existing.inFlight;

  const inFlight = fetch(path, { credentials: "same-origin" }).then(async (response) => {
    const value = await response.json().catch(() => ({})) as T & { message?: string; code?: string };
    if (!response.ok) throw new Error(value.message || value.code || `Request failed with status ${response.status}`);
    responseCache.set(path, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }).catch((error) => {
    responseCache.delete(path);
    throw error;
  });

  responseCache.set(path, { inFlight, expiresAt: 0 });
  return inFlight;
}

export function invalidateApiCache(pathPrefix: string): void {
  for (const path of responseCache.keys()) {
    if (path.startsWith(pathPrefix)) responseCache.delete(path);
  }
}

export function clearApiCache(): void {
  responseCache.clear();
}
