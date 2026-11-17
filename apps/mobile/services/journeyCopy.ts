import { TEMPLATE_DEFAULTS } from '@lumo/safety-domain';
import type { Journey, SessionKindName } from '@lumo/types';

/**
 * What the journey screens say (docs/specs/JOURNEYS.md). Pure: no clock, no I/O.
 *
 * The rule is the product's: say what Lumo WILL TRY to do, never that it has done or will do it; ask the person first and say so;
 * and be plain that contacts are not told about a journey, only about a check-in that goes unanswered (KI-102).
 */

export interface KindOption {
  readonly kind: SessionKindName;
  readonly label: string;
  readonly blurb: string;
  /** Offered lengths, in minutes. The first is the default. */
  readonly minutes: readonly number[];
}

export const KIND_OPTIONS: readonly KindOption[] = [
  { kind: 'walk_home', label: 'Walk home', blurb: 'Short, and quick to follow up.', minutes: [15, 30, 45, 60] },
  { kind: 'ride', label: 'Ride', blurb: 'A taxi, a lift or a bus.', minutes: [15, 30, 45, 60] },
  { kind: 'date', label: 'Date', blurb: 'Gives you a little longer before anyone is tried.', minutes: [120, 180, 240, 360] },
  { kind: 'travel', label: 'Travel', blurb: 'Long, and tolerant of lost signal.', minutes: [120, 240, 480, 720] },
  { kind: 'outdoor', label: 'Outdoors', blurb: 'Hours without signal are expected.', minutes: [120, 240, 480, 1440] },
  { kind: 'custom', label: 'Custom', blurb: 'A timer you set.', minutes: [15, 30, 60, 120] },
];

export const kindOption = (kind: SessionKindName): KindOption => KIND_OPTIONS.find(o => o.kind === kind) ?? KIND_OPTIONS[5];

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h)} h ${minutes % 60} min`;
}

export function graceLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} minute${m === 1 ? '' : 's'}` : `${m / 60} hour${m === 60 ? '' : 's'}`;
}

export const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export interface ContactInfo { readonly name: string; readonly agreed: boolean }

/** How many contacts the template tries, in order. */
export const contactsTried = (kind: SessionKindName): number => TEMPLATE_DEFAULTS[kind].contactSteps;

/**
 * The plan, BEFORE it runs (RES-4): what happens if the check-in is missed. Plain words, in order. "Will try to", never a promise.
 */
export function planLines(kind: SessionKindName, arriveAtMs: number, contacts: readonly ContactInfo[]): string[] {
  const grace = TEMPLATE_DEFAULTS[kind].graceSeconds;
  const agreed = contacts.filter(c => c.agreed);
  const tried = agreed.slice(0, contactsTried(kind));
  const lines = [`At ${clock(arriveAtMs)} Lumo will ask you if you are OK. Only you are asked.`];
  if (tried.length === 0) {
    lines.push('No contact has agreed yet, so nobody could be alerted. Ask someone to agree first.');
  } else {
    lines.push(`If you have not answered ${graceLabel(grace)} after that, Lumo will try to alert ${tried.map(c => c.name).join(', then ')}.`);
  }
  lines.push('Your contacts are not told about the journey itself, only if a check-in goes unanswered.');
  const left = contacts.filter(c => !c.agreed);
  if (left.length > 0 && tried.length > 0) lines.push(`${left.map(c => c.name).join(', ')} ${left.length === 1 ? "hasn't" : "haven't"} agreed, so would not be alerted.`);
  return lines;
}

/** "Lumo may start alerting your contacts at about 9:44 PM": the end of the grace, an estimate by this phone's clock. */
export function alertsMayStartAt(j: Pick<Journey, 'checkInDueAt' | 'plan'>): number | null {
  return j.checkInDueAt ? new Date(j.checkInDueAt).getTime() + j.plan.graceSeconds * 1000 : null;
}

export type Phase = 'running' | 'asking' | 'alerted' | 'ended' | 'other';
export function phaseOf(j: Pick<Journey, 'state' | 'needsAnswer'>): Phase {
  if (j.needsAnswer) return 'asking';
  switch (j.state) {
    case 'ACTIVE': case 'CREATED': return 'running';
    case 'ESCALATING': case 'ALERTED': return 'alerted';
    case 'ARRIVED': case 'CLOSED': case 'CANCELLED': case 'EXPIRED': return 'ended';
    default: return 'other'; // SUSPENDED
  }
}

export const endedText = (state: Journey['state']): string =>
  state === 'CANCELLED' ? 'Journey cancelled. Nobody was told.' : state === 'EXPIRED' ? 'This journey ran out of time.' : "Journey ended. You've arrived.";
