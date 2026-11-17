/**
 * What an SMS says. The honesty scanner covers this file (PLAT-9).
 *
 * Until incidents (1.8) and the web page (1.11) exist there is no live-location link and no
 * guidance to put here, so the only body is deliberately small. It says what the sender asked
 * Lumo to do and nothing about what will happen next; it never says help is coming.
 */
export function alertBody(senderName: string): string {
  return `${senderName} asked Lumo to alert you. This is an automated message and replies are not read.`;
}
