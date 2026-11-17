/**
 * Pull an invite token out of whatever the person pasted (docs/specs/TRUSTED_CONTACTS.md): the full link they were sent
 * (`https://host/api/v1/contacts/invites/<token>`, possibly with `/accept` after it), the app link (`lumo://claim/<token>`),
 * the bare token, or a message that CONTAINS the link (the invitation arrives as a message, and people paste all of it).
 * Pure. Returns null for anything that cannot be one, so nothing malformed is ever sent; the server still decides whether
 * the token is real.
 */
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const IN_LINK = /(?:invites|claim)\/([A-Za-z0-9_-]{32,128})(?![A-Za-z0-9_-])/;

export function inviteTokenFrom(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (TOKEN.test(text)) return text;
  return IN_LINK.exec(text)?.[1] ?? null;
}
