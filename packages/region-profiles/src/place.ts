import type { SubdivisionCode } from './types';

/**
 * Turning what a reverse geocoder returns into a country and subdivision the region
 * resolver can use (docs/specs/LOCATION.md).
 *
 * The platform geocoder returns NAMES, and documents no format for its `region`
 * field — a state may come back as "California", "CA", or something else, and the
 * form can differ between Android and iOS. Only the country code is dependable. So:
 *
 * - the COUNTRY comes from `isoCountryCode`;
 * - the SUBDIVISION comes from an EXPLICIT, EXACT-MATCH table below, after trimming,
 *   lower-casing and stripping diacritics;
 * - anything not in the table is UNKNOWN. It is never fuzzy-matched, never "closest
 *   guess". An unknown subdivision costs a regional number the label "possible"; a
 *   wrong one sends someone to a number that does not answer where they are.
 *
 * The table is keyed by country, so "Punjab" means Pakistan's only when the country
 * is Pakistan (India has a Punjab too). Every entry is an unverified hypothesis until
 * operations confirm it (KNOWN_ISSUES KI-52).
 */

export interface GeocodeResult {
  readonly isoCountryCode?: string | null;
  /** "The state or province associated with the address" — format unspecified. */
  readonly region?: string | null;
}

export interface ResolvedPlace {
  readonly country: string | null;
  readonly subdivision: SubdivisionCode | null;
}

const normalise = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type NameTable = Readonly<Record<string, SubdivisionCode>>;

/** Name or code → ISO 3166-2 subdivision code, per country. Keys are written already normalised. */
const US_STATES: [string, string][] = [
  ['alabama', 'AL'], ['alaska', 'AK'], ['arizona', 'AZ'], ['arkansas', 'AR'], ['california', 'CA'],
  ['colorado', 'CO'], ['connecticut', 'CT'], ['delaware', 'DE'], ['district of columbia', 'DC'],
  ['florida', 'FL'], ['georgia', 'GA'], ['hawaii', 'HI'], ['idaho', 'ID'], ['illinois', 'IL'],
  ['indiana', 'IN'], ['iowa', 'IA'], ['kansas', 'KS'], ['kentucky', 'KY'], ['louisiana', 'LA'],
  ['maine', 'ME'], ['maryland', 'MD'], ['massachusetts', 'MA'], ['michigan', 'MI'], ['minnesota', 'MN'],
  ['mississippi', 'MS'], ['missouri', 'MO'], ['montana', 'MT'], ['nebraska', 'NE'], ['nevada', 'NV'],
  ['new hampshire', 'NH'], ['new jersey', 'NJ'], ['new mexico', 'NM'], ['new york', 'NY'],
  ['north carolina', 'NC'], ['north dakota', 'ND'], ['ohio', 'OH'], ['oklahoma', 'OK'], ['oregon', 'OR'],
  ['pennsylvania', 'PA'], ['rhode island', 'RI'], ['south carolina', 'SC'], ['south dakota', 'SD'],
  ['tennessee', 'TN'], ['texas', 'TX'], ['utah', 'UT'], ['vermont', 'VT'], ['virginia', 'VA'],
  ['washington', 'WA'], ['west virginia', 'WV'], ['wisconsin', 'WI'], ['wyoming', 'WY'],
];

const PK_PROVINCES: [string, string][] = [
  ['punjab', 'PB'], ['sindh', 'SD'], ['khyber pakhtunkhwa', 'KP'], ['balochistan', 'BA'],
  ['baluchistan', 'BA'], ['islamabad capital territory', 'IS'], ['islamabad', 'IS'],
  ['gilgit baltistan', 'GB'], ['azad jammu and kashmir', 'JK'], ['azad kashmir', 'JK'],
];

const SUBDIVISION_NAMES: Readonly<Record<string, NameTable>> = {
  // A US state also arrives as its two-letter postal code; both forms are listed.
  US: Object.fromEntries([...US_STATES, ...US_STATES.map(([, code]): [string, string] => [code.toLowerCase(), code])]),
  PK: Object.fromEntries(PK_PROVINCES),
};

export function placeFromGeocode(geocode: GeocodeResult | null | undefined): ResolvedPlace {
  const raw = geocode?.isoCountryCode?.trim().toUpperCase();
  const country = raw && /^[A-Z]{2}$/.test(raw) ? raw : null;
  if (country === null) return { country: null, subdivision: null };

  const region = geocode?.region ? normalise(geocode.region) : '';
  const subdivision = region === '' ? null : (SUBDIVISION_NAMES[country]?.[region] ?? null);
  return { country, subdivision };
}
