function fallbackMessage(status: number, fallback: string): string {
  if ([408, 504, 524].includes(status)) return "The request timed out. Your selected documents and notes are still here. Try again.";
  if (status === 401) return "Your session has expired. Sign in again before retrying.";
  if (status === 403) return "You no longer have permission to perform this action. Check your team access.";
  if (status === 413) return "The upload was too large. Choose smaller documents and try again.";
  if (status === 429) return "The service is busy or its request limit was reached. Wait a moment and try again.";
  if (status >= 500) return "The service is temporarily unavailable. Your selected documents and notes are still here. Try again shortly.";
  return fallback;
}

export async function readSopResponse<T>(response: Response, fallback: string): Promise<T> {
  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    throw new Error(fallbackMessage(response.status, fallback));
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message.trim() : "";
    throw new Error(message || fallbackMessage(response.status, fallback));
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(fallback);
  return data as T;
}
