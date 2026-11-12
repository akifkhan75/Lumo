import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as domain from './index';

/**
 * ADR-0009 makes this package's purity its whole value: pure, no I/O, no clock,
 * zero runtime dependencies. "Pure" held only by convention is a promise that the
 * first contributor to reach for `Date.now()` breaks without noticing, so it is
 * checked here, mechanically, against the shipped source.
 *
 * Time is injected (`at`, `now`), and a clock read inside a machine would make
 * the phone and the server disagree about the same event sequence.
 */

const root = join(__dirname, '..');
const shipped = readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

/** Source with comments removed, so prose about "no Date.now" does not trip the check. */
const code = (file: string) =>
  readFileSync(join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const FORBIDDEN: [string, RegExp][] = [
  // Matches USING a clock (new Date, Date.now, Date(), Date.UTC), not the word:
  // 'Date Check-In' is the label of a session template.
  ['a clock (Date)', /\bnew\s+Date\b|\bDate\s*[.(]/],
  ['a clock (performance)', /\bperformance\b/],
  ['randomness', /Math\.random/],
  ['timers (setTimeout)', /\bsetTimeout\b/],
  ['timers (setInterval)', /\bsetInterval\b/],
  ['the network (fetch)', /\bfetch\s*\(/],
  ['the network (XMLHttpRequest)', /\bXMLHttpRequest\b/],
  ['the environment (process)', /\bprocess\b/],
  ['a require() call', /\brequire\s*\(/],
  ['a dynamic import()', /\bimport\s*\(/],
  ['a Node built-in', /['"`]node:/],
  ['global state (globalThis)', /\bglobalThis\b/],
  ['console output', /\bconsole\./],
  ['an Error subclass', /\bextends\s+Error\b/],
  ['a package import (not relative)', /from\s+['"](?!\.\.?\/)[^'"]+['"]/],
];

describe('the package is pure', () => {
  it('has source files to check', () => {
    expect(shipped.length).toBeGreaterThanOrEqual(12);
  });

  describe.each(shipped)('%s', (file) => {
    it.each(FORBIDDEN)('does not use %s', (_what, pattern) => {
      expect(code(file)).not.toMatch(pattern);
    });
  });

  it('declares no runtime dependencies at all', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
  });

  it('compiles for ES2020 with no ambient types, so impure globals do not even typecheck', () => {
    // The shared base tsconfig sets no target and compiles to ES5, which broke a
    // class extending Error in @lumo/api-client's shipped build. Do not inherit that.
    const tsconfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"target":\s*"ES2020"/);
    expect(tsconfig).toMatch(/"lib":\s*\["ES2020"\]/);
    expect(tsconfig).toMatch(/"types":\s*\[\]/);
  });

  it('enforces the 100% coverage gate it was promised (ADR-0009)', () => {
    const config = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
    for (const metric of ['branches', 'lines', 'functions', 'statements']) {
      expect(config).toMatch(new RegExp(`${metric}:\\s*100`));
    }
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.test).toContain('--coverage');
  });
});

describe('the public surface', () => {
  it('exposes the machines, the ledger data, escalation, idempotency, replay and hazard policy', () => {
    for (const name of [
      'SESSION_MACHINE', 'INCIDENT_MACHINE', 'ATTEMPT_MACHINE', 'apply', 'replay',
      'CHANNEL_CAPABILITIES', 'rollupIncident', 'stepLadder', 'validatePolicy', 'describePolicy', 'policyFromTemplate',
      'idempotencyKey', 'sha256Hex', 'HAZARD_TTL_DAYS', 'HAZARD_CONFIRMATION_FLOOR', 'LOCATING_TIMEBOX_MS',
    ]) {
      expect((domain as Record<string, unknown>)[name], name).toBeDefined();
    }
  });
});
