/**
 * What counts as "the same number" or "the same address" when deciding whether an
 * edit changed WHO would be reached.
 *
 * Formatting is not identity. "+1 (555) 123-4567" and "+15551234567" are one
 * person, and re-saving a form that tidied the spacing must not throw away a
 * consent the contact gave. A different number is a different person, and must.
 */

/** Keeps a leading "+" and the digits; drops spaces, brackets, dots and dashes. */
export function normalisePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function normaliseEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
