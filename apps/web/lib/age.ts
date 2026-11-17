/**
 * How old a position is, in words. Computed against the SERVER's clock (`asOf`), never the viewer's, so a contact whose phone clock
 * is wrong is not told a stale position is fresh. A position that is old is said to be old: it is never shown as "live".
 */
export type Freshness = 'fresh' | 'aging' | 'stale';

export function ageSeconds(capturedAt: string, asOf: string): number {
  return Math.max(0, Math.round((Date.parse(asOf) - Date.parse(capturedAt)) / 1000));
}

export function describeAge(seconds: number): string {
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 minute ago';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

/** Under 2 minutes is fresh, under 10 is aging, beyond that is stale and is labelled "last known". */
export function freshness(seconds: number): Freshness {
  return seconds < 120 ? 'fresh' : seconds < 600 ? 'aging' : 'stale';
}

export function describeAccuracy(metres: number): string {
  return metres < 1000 ? `within about ${Math.max(5, Math.round(metres / 5) * 5)} m` : `within about ${(metres / 1000).toFixed(1)} km`;
}
