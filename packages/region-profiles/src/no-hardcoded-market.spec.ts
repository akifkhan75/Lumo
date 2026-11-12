import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "No market-specific value may be hard-coded anywhere" (ADR-0011, PLAT-1) is a
 * rule that holds only until the first person writes `Linking.openURL('tel:911')`.
 * So it is checked, across the whole repo.
 *
 * What counts as a market-specific value: a dial string with digits, a currency
 * code used as a literal, and an emergency number written as a quoted literal.
 * Where it may live: this package, and tests (which assert against such values).
 *
 * A grep for bare digits would be useless — "15" is also a 15-minute check-in, and
 * "130" a hundred other things — so only the shapes above are matched.
 */

const repo = join(__dirname, '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.expo', '.turbo', 'android', 'ios', '.next', '.git', 'migrations', '__tests__']);
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const IS_TEST = /\.(spec|test|e2e-spec)\.(ts|tsx|js)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXT.test(name) && !IS_TEST.test(name)) yield full;
  }
}

const OWN = join('packages', 'region-profiles') + sep;
const files = ['apps', 'packages']
  .flatMap((d) => [...walk(join(repo, d))])
  .filter((f) => !relative(repo, f).startsWith(OWN));

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

export const RULES: [string, RegExp][] = [
  ['a dial string with digits', /tel:\s*\+?\d/],
  ['an sms: string with digits', /\bsms:\s*\+?\d/],
  ['a currency code as a literal', /['"`](PKR|USD|GBP|EUR|INR|CAD|AUD)['"`]/],
  ['an emergency number as a literal', /['"`](911|999|112|1122|15|115|130)['"`]\s*[,)\]}]?\s*(\/\/.*)?$/m],
];

describe('no market-specific value is hard-coded outside @lumo/region-profiles', () => {
  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(RULES.slice(0, 3))('finds no %s', (_what, pattern) => {
    const hits = files.filter((f) => pattern.test(strip(readFileSync(f, 'utf8')))).map((f) => relative(repo, f));
    expect(hits).toEqual([]);
  });

  it('finds no emergency number written as a quoted literal in dial or alert code', () => {
    // Narrower than a bare-number grep on purpose: only a quoted number that sits
    // beside dialling vocabulary counts.
    const dialContext = /(tel|dial|emergency|police|ambulance)[^\n]{0,80}['"`](911|999|112|1122|115|130)['"`]|['"`](911|999|112|1122|115|130)['"`][^\n]{0,80}(tel|dial|emergency|police|ambulance)/i;
    const hits = files.filter((f) => dialContext.test(strip(readFileSync(f, 'utf8')))).map((f) => relative(repo, f));
    expect(hits).toEqual([]);
  });

  describe('the scanner can actually see a violation (otherwise a pass means nothing)', () => {
    it.each([
      ["Linking.openURL('tel:911')", 0],
      ['Linking.openURL("tel:+15550100")', 0],
      ["window.open('sms:+15550100')", 1],
      ["const currency = 'USD';", 2],
      ["price: `PKR`", 2],
    ] as const)('flags %s', (source, ruleIndex) => {
      expect(RULES[ruleIndex][1].test(strip(source))).toBe(true);
    });
    it('does not flag a bare 15-minute option or an unrelated string', () => {
      for (const source of ["const options = [15, 30, 60];", "label: '15 min'", "Linking.openURL('tel:')", "const dollars = 'USDA';"]) {
        for (const [, pattern] of RULES.slice(0, 3)) expect(pattern.test(strip(source)), source).toBe(false);
      }
    });
  });
});
