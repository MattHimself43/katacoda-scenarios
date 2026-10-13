import { createHash } from 'node:crypto';

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

/** Deterministic JSON serialization (sorted object keys) for hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashContent(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Returns the UTC instant at which the calendar day containing `now` begins in `timeZone`.
 * Uses Intl only (no tz database dependency beyond what Node ships).
 */
export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  // Guess midnight UTC for that local date, then correct by the zone's offset at that instant.
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) {
    guess = Date.UTC(y, m - 1, d) - timeZoneOffsetMs(new Date(guess), timeZone);
  }
  return new Date(guess);
}

function timeZoneOffsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
