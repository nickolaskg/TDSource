export function extractEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  return normalized.slice(at + 1);
}

export function isApprovedEmail(email: string, approvedDomains: readonly string[]): boolean {
  const domain = extractEmailDomain(email);
  return domain !== null && approvedDomains.some((approved) => domain === approved.toLowerCase());
}

