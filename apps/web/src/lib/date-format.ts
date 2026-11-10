const dateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeZone: "UTC",
});

export function formatDateTime(value: string | number | Date): string {
  return `${dateTimeFormatter.format(new Date(value))} UTC`;
}

export function formatDate(value: string | number | Date): string {
  return dateFormatter.format(new Date(value));
}

export function textSnippet(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}
