import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { I18nManager } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { IconArrowLeft, IconChevronRight, IconSOS } from '../constants';

/**
 * Right-to-left (docs/design/ACCESSIBILITY.md, docs/specs/REGION_PROFILES.md). Urdu is a default language for the Pakistan profile, so the
 * layout must mirror: a screen built with physical `left`/`right` does not, and a back arrow then points the wrong way. This cannot prove a
 * real layout is right (that needs a device in Urdu), but it stops the commonest cause of a wrong one coming back.
 */
const root = join(__dirname, '..');
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' || f === '__tests__' || f === 'android' || f === 'ios' || f === 'coverage' ? [] : sources(p);
    return /\.(tsx|ts)$/.test(f) && !f.endsWith('.d.ts') ? [p] : [];
  });
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const FORBIDDEN: [string, RegExp][] = [
  ['margin-left / marginLeft', /\bmargin-left\b|\bmarginLeft\b/],
  ['margin-right / marginRight', /\bmargin-right\b|\bmarginRight\b/],
  ['padding-left / paddingLeft', /\bpadding-left\b|\bpaddingLeft\b/],
  ['padding-right / paddingRight', /\bpadding-right\b|\bpaddingRight\b/],
  ['an absolute `left:` position', /(^|[\s{,])left:\s*-?\d/m],
  ['an absolute `right:` position', /(^|[\s{,])right:\s*-?\d/m],
  ['text-align: left / right', /text-align:\s*(left|right)|textAlign:\s*['"](left|right)['"]/],
];

describe('layout that mirrors', () => {
  const files = [...sources(join(root, 'components')), join(root, 'App.tsx'), join(root, 'App.styled.ts'), join(root, 'constants.tsx')];
  it('finds the screens it is meant to check', () => expect(files.length).toBeGreaterThan(20));
  it.each(FORBIDDEN)('no screen uses %s (use start/end, which mirror)', (_name, re) => {
    const offenders = files.filter(f => re.test(code(f))).map(f => f.replace(root + '/', ''));
    expect(offenders).toEqual([]);
  });
});

describe('direction-bearing icons', () => {
  const flip = (el: React.ReactElement) => { let t!: renderer.ReactTestRenderer; act(() => { t = renderer.create(el); }); return JSON.stringify(t.toJSON()); };
  const original = I18nManager.isRTL;
  afterEach(() => { (I18nManager as any).isRTL = original; });

  it('are as drawn in a left-to-right layout', () => {
    (I18nManager as any).isRTL = false;
    expect(flip(<IconArrowLeft />)).not.toContain('scaleX');
    expect(flip(<IconChevronRight />)).not.toContain('scaleX');
  });
  it('are mirrored in a right-to-left layout, so "back" and "forward" still point the right way', () => {
    (I18nManager as any).isRTL = true;
    expect(flip(<IconArrowLeft />)).toContain('"scaleX":-1');
    expect(flip(<IconChevronRight />)).toContain('"scaleX":-1');
  });
  it('and icons that carry no direction are never mirrored', () => {
    (I18nManager as any).isRTL = true;
    expect(flip(<IconSOS />)).not.toContain('scaleX');
  });
});
