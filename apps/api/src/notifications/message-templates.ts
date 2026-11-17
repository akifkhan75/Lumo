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

export function alertBody(senderName: string): string {
  return `${senderName} asked Lumo to alert you. This is an automated message and replies are not read.`;
}
