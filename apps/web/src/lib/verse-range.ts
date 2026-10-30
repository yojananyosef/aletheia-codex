export interface VerseRange {
  from: number;
  to: number;
}

function parsePositiveInteger(value: string | null): number | null {
  if (value === null) return null;

  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;

  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Reads the optional `from`/`to` query parameters without knowing the chapter.
 * `from` alone means a single verse; `to` alone starts at verse 1.
 */
export function requestedVerseRange(
  params: URLSearchParams,
): VerseRange | null {
  const from = parsePositiveInteger(params.get("from"));
  const to = parsePositiveInteger(params.get("to"));

  if (from === null && to === null) return null;

  let start = from ?? 1;
  let end = to ?? start;
  if (start > end) [start, end] = [end, start];

  return { from: start, to: end };
}

/**
 * Clamps a requested range to the verses that actually exist in the chapter.
 */
export function parseVerseRange(
  params: URLSearchParams,
  lastVerse: number,
): VerseRange | null {
  if (!Number.isSafeInteger(lastVerse) || lastVerse < 1) return null;

  const requested = requestedVerseRange(params);
  if (!requested) return null;

  let from = Math.min(Math.max(requested.from, 1), lastVerse);
  let to = Math.min(Math.max(requested.to, 1), lastVerse);
  if (from > to) [from, to] = [to, from];

  return { from, to };
}
