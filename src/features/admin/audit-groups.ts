export interface DatedAuditEvent {
  id: string;
  occurred_at: string;
}

export interface AuditDateGroup<T extends DatedAuditEvent> {
  key: string;
  date: Date;
  events: T[];
}

function localDateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function groupAuditEventsByDate<T extends DatedAuditEvent>(events: T[]): AuditDateGroup<T>[] {
  const groups = new Map<string, AuditDateGroup<T>>();
  for (const event of events) {
    const occurredAt = new Date(event.occurred_at);
    const key = localDateKey(occurredAt);
    const existing = groups.get(key);
    if (existing) existing.events.push(event);
    else groups.set(key, { key, date: new Date(occurredAt.getFullYear(), occurredAt.getMonth(), occurredAt.getDate()), events: [event] });
  }
  return [...groups.values()];
}

export function formatAuditGroupDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
