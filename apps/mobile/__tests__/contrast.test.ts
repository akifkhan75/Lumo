import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrast on the colours the safety screens actually use (docs/design/ACCESSIBILITY.md: 4.5:1 for text, 3:1 for components). Colours live in
 * style strings and cannot be read off a rendered tree, so this does two things: it checks the ratio of the pairs that matter, from the
 * same hex values the styles use, and it forbids the colour that was found to fail. It is not a full audit (that needs the real screens in
 * both themes on a device; the app is light-only today): it is the floor, and it stops a known-bad colour returning.
 */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe('the pairs on the safety path', () => {
  const TEXT: [string, string, string][] = [
    ['SOS text on its background', '#ffffff', '#475569'],
    ['the call button', '#ffffff', '#dc2626'],
    ['the failed screen', '#ffffff', '#7f1d1d'],
    ['practice button text', '#312e81', '#ffffff'],
    ['practice banner', '#111827', '#fde047'],
    ['journey chip, selected', '#ffffff', '#1e3a8a'],
    ['sharing strip', '#1e3a8a', '#eff6ff'],
    ['settings description', '#6b7280', '#ffffff'],
    ['bottom navigation label', '#4b5563', '#ffffff'],
    ['the add-contact and sign-in links', '#047857', '#ffffff'],
  ];
  it.each(TEXT)('%s reads at 4.5:1 or better', (_n, fg, bg) => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5));

  const COMPONENTS: [string, string, string][] = [
    ['a switch that is on', '#047857', '#ffffff'],
    ['a switch that is off', '#767577', '#ffffff'],
    ['the SOS button\'s border on its red', '#ffffff', '#dc2626'],
  ];
  it.each(COMPONENTS)('%s reads at 3:1 or better', (_n, fg, bg) => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3));
});

describe('a colour found to fail does not come back', () => {
  const root = join(__dirname, '..');
  const files = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (['node_modules', '__tests__', 'android', 'ios', 'coverage'].includes(f) ? [] : files(p)) : /\.(tsx?|ts)$/.test(f) ? [p] : []; });
  it('#10b981 (2.5:1 on white) is not used for text or a switch', () => {
    expect(ratio('#10b981', '#ffffff')).toBeLessThan(3); // the reason
    const offenders = [...files(join(root, 'components')), join(root, 'App.styled.ts'), join(root, 'App.tsx')].filter(f => /#10b981/i.test(readFileSync(f, 'utf8'))).map(f => f.replace(root + '/', ''));
    expect(offenders).toEqual([]);
  });
});
