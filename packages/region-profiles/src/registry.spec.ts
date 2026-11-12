import { describe, expect, it } from 'vitest';
import { PK, PROFILES, US } from './profiles';
import { createRegionRegistry, parseEnabledRegions } from './registry';
import { approvedProfile } from './testing/fixtures';

describe('createRegionRegistry — the boot-time gate (ADR-0011)', () => {
  describe('an empty enabled set is allowed: nothing is served, and the API still starts', () => {
    it.each(['production', 'development', 'test'] as const)('in %s', (environment) => {
      const r = createRegionRegistry({ enabled: [], environment });
      expect(r.enabled).toEqual([]);
      expect(r.isEnabled('PK')).toBe(false);
    });
  });

  describe('production refuses anything that is not complete AND approved', () => {
    it('refuses the real drafts, naming every problem', () => {
      expect(() => createRegionRegistry({ enabled: ['PK'], environment: 'production' })).toThrow(/Cannot enable "PK" in production/);
      try {
        createRegionRegistry({ enabled: ['PK', 'US'], environment: 'production' });
        expect.unreachable();
      } catch (e) {
        const m = (e as Error).message;
        expect(m).toContain('"PK"');
        expect(m).toContain('"US"'); // both are reported, not just the first
        expect(m).toContain('LEGAL_REVIEW_PENDING');
      }
    });

    it('a COMPLETE profile with a pending legal review is still refused', () => {
      const p = approvedProfile({ legalReviewStatus: 'pending' });
      expect(() => createRegionRegistry({ profiles: [p], enabled: ['ZZ'], environment: 'production' })).toThrow(/LEGAL_REVIEW_PENDING/);
    });

    it('accepts a profile that is complete and approved, as live', () => {
      const r = createRegionRegistry({ profiles: [approvedProfile()], enabled: ['ZZ'], environment: 'production' });
      expect(r.enabled).toEqual([{ id: 'ZZ', mode: 'live' }]);
      expect(r.modeOf('ZZ')).toBe('live');
    });
  });

  describe('outside production a draft may be enabled — and is marked so it can never pass for live', () => {
    it.each(['development', 'test'] as const)('in %s', (environment) => {
      const r = createRegionRegistry({ enabled: ['PK', 'US'], environment });
      expect(r.enabled).toEqual([{ id: 'PK', mode: 'internal-testing' }, { id: 'US', mode: 'internal-testing' }]);
      expect(r.modeOf('PK')).toBe('internal-testing');
    });
    it('an approved profile is live even outside production', () => {
      const r = createRegionRegistry({ profiles: [approvedProfile()], enabled: ['ZZ'], environment: 'development' });
      expect(r.modeOf('ZZ')).toBe('live');
    });
  });

  describe('the gate applies to the ENABLED set, not to every profile that exists', () => {
    it('knowing about two unapproved drafts does not stop the API starting in production', () => {
      expect(() => createRegionRegistry({ enabled: [], environment: 'production' })).not.toThrow();
    });
    it('only the enabled profile is held to the gate', () => {
      const r = createRegionRegistry({ profiles: [approvedProfile(), PK], enabled: ['ZZ'], environment: 'production' });
      expect(r.enabled.map((e) => e.id)).toEqual(['ZZ']);
      expect(r.profileFor('PK')).toBe(PK); // still known, still resolvable
    });
  });

  describe('refusals that hold in every environment', () => {
    it('an unknown profile id', () => {
      expect(() => createRegionRegistry({ enabled: ['XX'], environment: 'test' })).toThrow(/no such profile \(known: PK, US\)/);
    });
    it('a disabled profile', () => {
      const p = approvedProfile({ status: 'disabled' });
      expect(() => createRegionRegistry({ profiles: [p], enabled: ['ZZ'], environment: 'development' })).toThrow(/profile is disabled/);
    });
    it('a profile defined twice', () => {
      expect(() => createRegionRegistry({ profiles: [PK, PK], enabled: [], environment: 'test' })).toThrow(/"PK" is defined twice/);
    });
    it('says "none" when there are no profiles to name', () => {
      expect(() => createRegionRegistry({ profiles: [], enabled: ['PK'], environment: 'test' })).toThrow(/known: none/);
    });
  });

  it('ids are case-insensitive and de-duplicated', () => {
    const r = createRegionRegistry({ enabled: ['pk', ' PK ', 'us'], environment: 'test' });
    expect(r.enabled.map((e) => e.id)).toEqual(['PK', 'US']);
    expect(r.isEnabled('pk')).toBe(true);
    expect(r.modeOf('us')).toBe('internal-testing');
  });

  it('answers for markets that are not enabled', () => {
    const r = createRegionRegistry({ enabled: ['PK'], environment: 'test' });
    expect(r.isEnabled('US')).toBe(false);
    expect(r.modeOf('US')).toBeNull();
  });

  describe('profileFor', () => {
    const r = createRegionRegistry({ enabled: [], environment: 'test' });
    it('finds a profile by country, ignoring case', () => {
      expect(r.profileFor('pk')).toBe(PK);
      expect(r.profileFor('US')).toBe(US);
    });
    it('returns null for an unknown, blank or missing country', () => {
      for (const c of ['GB', '', null, undefined]) expect(r.profileFor(c)).toBeNull();
    });
  });

  it('uses the profiles Lumo ships when none are given', () => {
    expect(createRegionRegistry({ enabled: [], environment: 'test' }).profiles).toBe(PROFILES);
  });
});

describe('parseEnabledRegions', () => {
  it('splits, trims and upper-cases', () => {
    expect(parseEnabledRegions(' pk, us ,,')).toEqual(['PK', 'US']);
  });
  it('blank, missing and null all mean none', () => {
    for (const v of ['', '  ', undefined, null]) expect(parseEnabledRegions(v)).toEqual([]);
  });
});
