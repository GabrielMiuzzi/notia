export function formatFinanceLoadedDate(createdAt?: string | null): string | null {
  const value = createdAt?.trim();
  if (!value) return null;

  const timestamp = /^\d+$/.test(value)
    ? Number(value) * (value.length <= 10 ? 1000 : 1)
    : Number.NaN;
  const date = Number.isFinite(timestamp)
    ? new Date(timestamp)
    : parseStoredUtcTimestamp(value);
  if (Number.isNaN(date.getTime())) return null;

  return [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()]
    .map((part, index) => index === 2 ? String(part).padStart(4, "0") : String(part).padStart(2, "0"))
    .join("/");
}

function parseStoredUtcTimestamp(value: string): Date {
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const isoValue = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized}T00:00:00Z`
    : hasTimezone ? normalized : `${normalized}Z`;
  return new Date(isoValue);
}
