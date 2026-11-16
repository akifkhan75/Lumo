import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/**
 * Phone numbers become E.164 before they are stored (docs/specs/TRUSTED_CONTACTS.md).
 *
 * A number written locally ("0300 1234567") means nothing without a country, and
 * GUESSING one reaches a stranger. So the country comes from the user's region profile,
 * and with none the number must start with "+". No default is ever assumed.
 *
 * Validity is the library's: a number that cannot exist in its country is refused, not
 * stored, because an unreachable contact is a failure the user must hear about now, not
 * in an emergency.
 */

export type PhoneResult =
  | { readonly ok: true; readonly e164: string }
  | { readonly ok: false; readonly reason: 'NEEDS_COUNTRY' | 'INVALID' };

export function toE164(raw: string, defaultCountry?: string | null): PhoneResult {
  const input = raw.trim();
  const international = input.startsWith('+');
  if (!international && !defaultCountry) return { ok: false, reason: 'NEEDS_COUNTRY' };

  const parsed = parsePhoneNumberFromString(input, international ? undefined : (defaultCountry as CountryCode));
  if (!parsed || !parsed.isValid()) return { ok: false, reason: 'INVALID' };
  return { ok: true, e164: parsed.number };
}

/** Countries Lumo has a region profile for. Anything else gets no default country. */
const KNOWN_COUNTRIES = new Set(['PK', 'US']);

/** Region profile ids are ISO country codes (PK, US); anything else yields no country. */
export function countryOfRegionProfile(regionProfileId: string | null | undefined): string | null {
  const id = regionProfileId?.trim().toUpperCase();
  return id && KNOWN_COUNTRIES.has(id) ? id : null;
}
