import { describe, expect, it } from 'vitest';
import { placeFromGeocode } from './place';

describe('placeFromGeocode: names in, codes out — and unknown stays unknown', () => {
  describe('country', () => {
    it('comes from isoCountryCode, upper-cased', () => {
      expect(placeFromGeocode({ isoCountryCode: 'pk', region: 'Punjab' }).country).toBe('PK');
      expect(placeFromGeocode({ isoCountryCode: ' US ', region: 'California' }).country).toBe('US');
    });
    it.each([[undefined], [null], [''], ['  '], ['USA'], ['U'], ['12']])('%j is no country', (isoCountryCode) => {
      expect(placeFromGeocode({ isoCountryCode, region: 'California' })).toEqual({ country: null, subdivision: null });
    });
    it('a missing geocode is no place at all', () => {
      expect(placeFromGeocode(null)).toEqual({ country: null, subdivision: null });
      expect(placeFromGeocode(undefined)).toEqual({ country: null, subdivision: null });
    });
  });

  describe('Pakistan', () => {
    it.each([
      ['Punjab', 'PB'], ['punjab', 'PB'], ['  PUNJAB ', 'PB'], ['Sindh', 'SD'], ['Khyber Pakhtunkhwa', 'KP'],
      ['Khyber-Pakhtunkhwa', 'KP'], ['Balochistan', 'BA'], ['Baluchistan', 'BA'], ['Islamabad', 'IS'],
      ['Islamabad Capital Territory', 'IS'], ['Gilgit-Baltistan', 'GB'], ['Azad Jammu and Kashmir', 'JK'], ['Azad Kashmir', 'JK'],
    ])('"%s" is %s', (region, code) => {
      expect(placeFromGeocode({ isoCountryCode: 'PK', region })).toEqual({ country: 'PK', subdivision: code });
    });
  });

  describe('United States', () => {
    it('maps a state given as a name', () => {
      expect(placeFromGeocode({ isoCountryCode: 'US', region: 'California' }).subdivision).toBe('CA');
      expect(placeFromGeocode({ isoCountryCode: 'US', region: 'New Hampshire' }).subdivision).toBe('NH');
      expect(placeFromGeocode({ isoCountryCode: 'US', region: 'District of Columbia' }).subdivision).toBe('DC');
    });
    it('maps a state given as a postal code — the platform does not say which form it uses', () => {
      expect(placeFromGeocode({ isoCountryCode: 'US', region: 'CA' }).subdivision).toBe('CA');
      expect(placeFromGeocode({ isoCountryCode: 'US', region: 'wa' }).subdivision).toBe('WA');
    });
    it('covers all fifty states and DC, each name and code mapping to itself', () => {
      const codes = new Set<string>();
      for (const name of ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming']) {
        const code = placeFromGeocode({ isoCountryCode: 'US', region: name }).subdivision;
        expect(code, name).not.toBeNull();
        expect(placeFromGeocode({ isoCountryCode: 'US', region: code as string }).subdivision).toBe(code);
        codes.add(code as string);
      }
      expect(codes.size).toBe(51);
    });
    it('strips diacritics', () => {
      expect(placeFromGeocode({ isoCountryCode: 'US', region: 'Cálifornia' }).subdivision).toBe('CA');
    });
  });

  describe('unknown stays unknown — it is never guessed', () => {
    it.each([
      ['PK', 'Punjab Province'], ['PK', 'Panjab'], ['PK', 'Pun'], ['US', 'Calif.'], ['US', 'Californa'], ['US', 'Cal'],
      ['US', 'Puerto Rico'], ['US', ''], ['PK', '   '],
    ])('%s / "%s"', (isoCountryCode, region) => {
      expect(placeFromGeocode({ isoCountryCode, region }).subdivision).toBeNull();
    });
    it('a missing region is unknown', () => {
      expect(placeFromGeocode({ isoCountryCode: 'PK' }).subdivision).toBeNull();
      expect(placeFromGeocode({ isoCountryCode: 'PK', region: null }).subdivision).toBeNull();
    });
    it("a name is only read against ITS country: India's Punjab is not Pakistan's", () => {
      expect(placeFromGeocode({ isoCountryCode: 'IN', region: 'Punjab' })).toEqual({ country: 'IN', subdivision: null });
    });
    it('a country with no table has no subdivisions, but is still a country', () => {
      expect(placeFromGeocode({ isoCountryCode: 'GB', region: 'England' })).toEqual({ country: 'GB', subdivision: null });
    });
    it('a US state name is not read as a Pakistani one, or the reverse', () => {
      expect(placeFromGeocode({ isoCountryCode: 'PK', region: 'California' }).subdivision).toBeNull();
      expect(placeFromGeocode({ isoCountryCode: 'US', region: 'Sindh' }).subdivision).toBeNull();
    });
  });
});
