import { PROFILES } from './profiles';
import type { RegionProfile } from './types';
import { enablementIssues } from './validation';

/**
 * Which markets are switched on, and the boot-time assertion that guards it
 * (ADR-0011: "asserted at boot, not enforced by process").
 *
 * THE GATE SCOPE. The assertion applies to the profiles in the configured ENABLED
 * set — not to every profile Lumo knows. Both reference profiles are drafts with a
 * pending legal review, so asserting over everything would stop the API from
 * starting at all, for every developer, for months. Enabling a market is the act
 * that must be gated; merely knowing about one is not.
 *
 * ENABLEMENT IS NOT VISIBILITY. This decides whether Lumo provides SERVICE in a
 * market (alerts, journeys). It does NOT decide whether a person sees an emergency
 * number: those come from any known profile (see resolve.ts), because a gate that
 * hid 911 from someone in the US would be a defect, not a safeguard.
 */

export type Environment = 'production' | 'development' | 'test';

/**
 * - `live`              — complete and approved; may serve real users.
 * - `internal-testing`  — a draft enabled outside production so the system can be
 *                         built and tested against it. Never reachable in production.
 */
export type EnabledMode = 'live' | 'internal-testing';

export interface RegistryOptions {
  readonly profiles?: readonly RegionProfile[];
  /** Profile ids to switch on. Empty is allowed: nothing is served. */
  readonly enabled: readonly string[];
  readonly environment: Environment;
}

export interface RegionRegistry {
  readonly profiles: readonly RegionProfile[];
  readonly enabled: readonly { readonly id: string; readonly mode: EnabledMode }[];
  profileFor(country: string | null | undefined): RegionProfile | null;
  isEnabled(id: string): boolean;
  modeOf(id: string): EnabledMode | null;
}

/**
 * Throws, listing every problem, if the configuration is not allowed. A plain
 * Error on purpose: this is a refusal to start, not something to recover from.
 */
export function createRegionRegistry(options: RegistryOptions): RegionRegistry {
  const profiles = options.profiles ?? PROFILES;
  const problems: string[] = [];

  const ids = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.id)) problems.push(`Profile "${p.id}" is defined twice`);
    ids.add(p.id);
  }

  const enabled: { id: string; mode: EnabledMode }[] = [];
  for (const raw of options.enabled) {
    const id = raw.trim().toUpperCase();
    if (enabled.some((e) => e.id === id)) continue;
    const profile = profiles.find((p) => p.id === id);
    if (!profile) {
      problems.push(`Cannot enable "${id}": there is no such profile (known: ${[...ids].join(', ') || 'none'})`);
      continue;
    }
    if (profile.status === 'disabled') {
      problems.push(`Cannot enable "${id}": the profile is disabled`);
      continue;
    }
    const issues = enablementIssues(profile);
    if (issues.length === 0) {
      enabled.push({ id, mode: 'live' });
    } else if (options.environment === 'production') {
      problems.push(
        `Cannot enable "${id}" in production: ${issues.length} problem(s) — ` +
          issues.map((i) => `${i.code} (${i.path})`).join('; '),
      );
    } else {
      // Outside production a draft may be enabled so work can proceed against it,
      // and it is marked so it can never be mistaken for a live market.
      enabled.push({ id, mode: 'internal-testing' });
    }
  }

  if (problems.length > 0) {
    throw new Error(`Region configuration refused:\n- ${problems.join('\n- ')}`);
  }

  return {
    profiles,
    enabled,
    profileFor: (country) => (country ? (profiles.find((p) => p.id === country.toUpperCase()) ?? null) : null),
    isEnabled: (id) => enabled.some((e) => e.id === id.toUpperCase()),
    modeOf: (id) => enabled.find((e) => e.id === id.toUpperCase())?.mode ?? null,
  };
}

/** Parse a comma-separated ENABLED_REGIONS value. Blank and absent both mean none. */
export function parseEnabledRegions(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s !== '');
}
