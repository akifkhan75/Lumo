#!/usr/bin/env node
/**
 * PLAT-9 — no unproven success claims in client UI.
 *
 * Lumo's first invariant is that it never tells someone help is coming when it
 * is not. That invariant regresses the moment somebody adds a reassuring
 * toast, and a reviewer will not reliably catch it: the copy reads well, the
 * screen looks finished, and the lie is invisible unless you happen to know
 * which parts of the response chain exist.
 *
 * So it is checked. This script fails when client source asserts an outcome
 * the system cannot currently prove: that a contact was notified, that
 * services were called, that a location was shared, that evidence was saved.
 *
 * It is not a style rule. A failure here means a screen is about to claim
 * something untrue to a person in danger.
 *
 * Escape hatch: put `lumo-verified-claim: <why>` in a comment on the matching
 * line or the three lines above it. That is for copy backed by a real
 * NotificationAttempt state from the Verified Delivery Ledger. It records who
 * decided the claim is true and on what evidence; it is not a mute button.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['apps/mobile', 'apps/web'];
const SKIP_SEGMENTS = new Set([
  'node_modules', 'coverage', 'dist', 'build', '.expo', 'android', 'ios', '__tests__', '.next',
]);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const ALLOW_MARKER = 'lumo-verified-claim';
const ALLOW_LOOKBACK = 3;

/**
 * Each rule is phrased to catch an assertion, not a description. "Contacts
 * will be notified when this is built" is fine; "Contacts notified" is not.
 */
const RULES = [
  { id: 'help-coming',     re: /help is (on the way|coming)/i,                               why: 'claims help is en route' },
  { id: 'services-called', re: /(emergency )?services (have been |has been |are |were )?(contacted|notified|alerted|called|dispatched)/i, why: 'claims emergency services were contacted' },
  { id: 'authorities',     re: /authorities (have been |has been |were )?(contacted|notified|alerted)/i, why: 'claims authorities were contacted' },
  { id: 'contacts-told',   re: /(your )?contacts (have been |has been |were |are being )?(notified|alerted|messaged|contacted)/i, why: 'claims trusted contacts were reached' },
  { id: 'notifying',       re: /notifying (your |nearby )?(contacts|volunteers|emergency)/i, why: 'claims a notification is in flight' },
  { id: 'alert-sent',      re: /alert (has been |was )?sent/i,                               why: 'claims an alert was delivered' },
  { id: 'location-shared', re: /(your )?location (has been |is being |is now being )(shared|sent|broadcast)/i, why: 'claims a location was shared' },
  { id: 'emergency-call',  re: /emergency calling/i,                                         why: 'implies a call is being placed' },
  { id: 'recording-saved', re: /(recording|evidence|video|audio) (has been |was )?(saved|uploaded|backed up|secured)/i, why: 'claims evidence was stored' },
  { id: 'alarm-active',    re: /(loud )?alarm active/i,                                      why: 'claims an alarm is sounding' },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // apps/web does not exist until Phase 1
  }
  for (const entry of entries) {
    if (SKIP_SEGMENTS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (EXTENSIONS.some(ext => entry.endsWith(ext))) {
      yield full;
    }
  }
}

// Comment-only lines are prose about the code, not copy shown to anyone.
// This file and the docs discuss these phrases constantly.
const COMMENT_ONLY = /^\s*(\/\/|\/\*|\*|#)/;

const findings = [];

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, scanDir))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (COMMENT_ONLY.test(line)) return;
      const context = lines.slice(Math.max(0, i - ALLOW_LOOKBACK), i + 1).join('\n');
      if (context.includes(ALLOW_MARKER)) return;
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          findings.push({
            file: relative(ROOT, file),
            line: i + 1,
            rule: rule.id,
            why: rule.why,
            text: line.trim().slice(0, 140),
          });
        }
      }
    });
  }
}

if (findings.length === 0) {
  console.log('no-fake-success: clean — no unproven success claims found.');
  process.exit(0);
}

console.error(`\nno-fake-success: ${findings.length} unproven success claim(s).\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.why}`);
  console.error(`    ${f.text}\n`);
}
console.error(
  'Each of these tells a user something Lumo cannot currently prove.\n' +
  'Either change the copy to state what actually happened, or — if it is\n' +
  'backed by a verified NotificationAttempt state — annotate it with\n' +
  `"${ALLOW_MARKER}: <why it is true>" and say who verified it.\n`,
);
process.exit(1);
