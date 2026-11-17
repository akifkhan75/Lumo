/**
 * What an SMS says. The honesty scanner covers this file (PLAT-9).
 *
 * Until incidents (1.8) and the web page (1.11) exist there is no live-location link and no
 * guidance to put here, so the only body is deliberately small. It says what the sender asked
 * Lumo to do and nothing about what will happen next; it never says help is coming.
 */
/**
 * What a phone call SAYS. Spoken once, by a machine, to someone who may have been woken by it.
 * It names who asked and says nothing about what will happen; "answered" is never treated as
 * understood, and nothing here asks the listener to press anything (a call is not an acknowledgement).
 */
export function voiceScript(senderName: string): string {
  return `This is an automated call from Lumo. ${senderName} asked Lumo to alert you. Please check your messages or call them. This message is automated and cannot take a reply.`;
}

/** The push notification text. Ids and the sender's name only: it crosses third parties and shows on a lock screen. */
export function pushBody(senderName: string): string {
  return `${senderName} asked Lumo to alert you.`;
}

export interface AlertLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
  /** Epoch ms, by the device clock. */
  readonly capturedAt: number;
}

/** Past this age a position is "last known", never "where they are". Mirrors CURRENT_FIX_MAX_AGE_MS. */
const FRESH_MS = 5 * 60 * 1000;

const utcClock = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/**
 * An SMS cannot update, so a position in one must say WHEN it was and how precise, and a stale one must
 * say it is not necessarily where they are now. It is a fact about the past, worded as one.
 */
export function locationLine(loc: AlertLocation, now: number): string {
  const ageMin = Math.max(0, Math.round((now - loc.capturedAt) / 60_000));
  const stale = now - loc.capturedAt > FRESH_MS;
  const where = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
  const how = `${utcClock(loc.capturedAt)}, about ${ageMin} min before this was sent, within ${Math.round(loc.accuracyM)} m`;
  return stale
    ? `Last known location (${how}; they may have moved): ${where}`
    : `Location (${how}): ${where}`;
}

export function alertBody(senderName: string, location: AlertLocation | null = null, now: number = Date.now()): string {
  const base = `${senderName} asked Lumo to alert you.`;
  const where = location ? ` ${locationLine(location, now)}.` : ' Their location was not available.';
  return `${base}${where} This is an automated message and replies are not read.`;
}

/** Telling a contact it ended. Sent only to contacts whose alert actually went. */
export function resolvedBody(senderName: string): string {
  return `${senderName} ended the alert. You do not need to do anything. This is an automated message.`;
}
