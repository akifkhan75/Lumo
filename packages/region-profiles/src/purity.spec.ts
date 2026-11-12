import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as pkg from './index';

/**
 * This package must run unchanged on a phone and on a server, and its answers must
 * be a function of its inputs alone: the same fix, the same clock, the same answer.
 * Time is injected (`now`); there is no geocoding, because approximating a place
 * from coordinates gives wrong numbers near boundaries.
 */

const root = join(__dirname, '..');
const shipped = readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const shippedDeep = [...shipped, ...readdirSync(join(__dirname, 'profiles')).map((f) => `profiles/${f}`)];

const code = (file: string) =>
  readFileSync(join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const FORBIDDEN: [string, RegExp][] = [
  ['a clock', /\bnew\s+Date\b|\bDate\s*[.(]/],
  ['performance timing', /\bperformance\b/],
  ['randomness', /Math\.random/],
  ['timers', /\bset(Timeout|Interval)\b/],
  ['the network', /\bfetch\s*\(|\bXMLHttpRequest\b/],
  ['the environment', /\bprocess\b|\bglobalThis\b/],
  ['require() or dynamic import()', /\brequire\s*\(|\bimport\s*\(/],
  ['a Node built-in', /['"`]node:/],
  ['console output', /\bconsole\./],
  ['an Error subclass', /\bextends\s+Error\b/],
  // The only package it may import is the shared vocabulary.
  ['a package other than @lumo/safety-domain', /from\s+['"](?!\.\.?\/|@lumo\/safety-domain['"])[^'"]+['"]/],
  // No coordinate→place guesswork.
  ['geocoding by bounding box', /\b(bbox|boundingBox|bounds?|polygon|haversine)\b/i],
];

describe('the package is pure', () => {
  it('has source files to check', () => {
    expect(shippedDeep.length).toBeGreaterThanOrEqual(9);
  });

  describe.each(shippedDeep)('%s', (file) => {
    it.each(FORBIDDEN)('does not use %s', (_what, pattern) => {
      expect(code(file)).not.toMatch(pattern);
    });
  });

  it('depends only on the shared vocabulary', () => {
    const pj = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(Object.keys(pj.dependencies)).toEqual(['@lumo/safety-domain']);
    expect(pj.peerDependencies).toBeUndefined();
  });

  it('compiles for ES2020 with no ambient types, and its tests are held to 100%', () => {
    const tsconfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"target":\s*"ES2020"/);
    expect(tsconfig).toMatch(/"types":\s*\[\]/);
    const vitest = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
    for (const m of ['branches', 'lines', 'functions', 'statements']) expect(vitest).toMatch(new RegExp(`${m}:\\s*100`));
  });

  it('exposes the registry, the resolver, the validation and both profiles', () => {
    for (const n of ['createRegionRegistry', 'resolveRegion', 'emergencyNumbersFor', 'recordingRuleFor', 'enablementIssues', 'PK', 'US', 'GLOBAL_DEFAULT', 'CURRENT_FIX_MAX_AGE_MS']) {
      expect((pkg as Record<string, unknown>)[n], n).toBeDefined();
    }
  });
});
