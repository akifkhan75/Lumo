import type { Journey } from '@lumo/types';
import { alertsMayStartAt, contactsTried, durationLabel, endedText, graceLabel, KIND_OPTIONS, kindOption, phaseOf, planLines } from '../services/journeyCopy';

const T = new Date('2026-11-20T21:00:00').getTime();
const c = (name: string, agreed = true) => ({ name, agreed });

describe('planLines: the plan is shown BEFORE it runs, in "will try" words', () => {
  it('asks the person first, then names who is tried, in order, after the template\'s grace', () => {
    const lines = planLines('walk_home', T, [c('Maya'), c('Dad'), c('Mum')]);
    expect(lines[0]).toMatch(/will ask you if you are OK\. Only you are asked\./);
    expect(lines[1]).toContain('3 minutes after that');
    expect(lines[1]).toContain('will try to alert Maya, then Dad'); // two contacts for a walk home; Mum is not tried
    expect(lines[1]).not.toContain('Mum');
  });
  it('the grace follows the kind', () => {
    expect(planLines('outdoor', T, [c('A')])[1]).toContain('1 hour');
    expect(planLines('date', T, [c('A')])[1]).toContain('5 minutes');
    expect(planLines('travel', T, [c('A')])[1]).toContain('30 minutes');
  });
  it('says plainly that contacts are not told about the journey itself', () => {
    expect(planLines('walk_home', T, [c('A')]).join(' ')).toContain('not told about the journey itself');
  });
  it('a contact who has not agreed is not named as someone who will be tried, and is called out', () => {
    const lines = planLines('walk_home', T, [c('Maya', false), c('Dad')]);
    expect(lines[1]).toContain('Dad');
    expect(lines[1]).not.toContain('Maya');
    expect(lines.join(' ')).toContain("Maya hasn't agreed, so would not be alerted");
  });
  it('with nobody agreed it says nobody could be alerted instead of pretending', () => {
    const lines = planLines('walk_home', T, [c('Maya', false)]);
    expect(lines.join(' ')).toContain('nobody could be alerted');
    expect(lines.join(' ')).not.toContain('will try to alert');
  });
  it('never promises: no "will be notified" or "help is"', () => {
    for (const k of KIND_OPTIONS) expect(planLines(k.kind, T, [c('A'), c('B')]).join(' ').toLowerCase()).not.toMatch(/will be notified|help is|safe/);
  });
});

describe('the copy helpers', () => {
  it('every kind has lengths, and the default is the first', () => {
    for (const k of KIND_OPTIONS) { expect(k.minutes.length).toBeGreaterThan(0); expect(kindOption(k.kind).minutes[0]).toBe(k.minutes[0]); }
  });
  it('contactsTried follows the template', () => { expect(contactsTried('walk_home')).toBe(2); });
  it.each([[15, '15 min'], [60, '1 hour'], [120, '2 hours'], [90, '1 h 30 min']])('durationLabel(%s)', (m, t) => expect(durationLabel(m)).toBe(t));
  it.each([[30, '30 seconds'], [180, '3 minutes'], [60, '1 minute'], [3600, '1 hour'], [7200, '2 hours']])('graceLabel(%s)', (s, t) => expect(graceLabel(s)).toBe(t));
  it('alertsMayStartAt is the end of the grace, and null with no deadline', () => {
    expect(alertsMayStartAt({ checkInDueAt: new Date(T).toISOString(), plan: { graceSeconds: 180, contacts: [] } })).toBe(T + 180_000);
    expect(alertsMayStartAt({ checkInDueAt: null, plan: { graceSeconds: 180, contacts: [] } })).toBeNull();
  });
  it.each([
    ['ACTIVE', false, 'running'], ['CREATED', false, 'running'], ['CHECK_IN_DUE', true, 'asking'], ['GRACE', true, 'asking'],
    ['ESCALATING', false, 'alerted'], ['ALERTED', false, 'alerted'], ['CLOSED', false, 'ended'], ['CANCELLED', false, 'ended'], ['SUSPENDED', false, 'other'],
  ] as const)('phaseOf(%s, needsAnswer=%s) = %s', (state, needsAnswer, phase) => expect(phaseOf({ state, needsAnswer } as Pick<Journey, 'state' | 'needsAnswer'>)).toBe(phase));
  it('a cancelled journey says nobody was told', () => expect(endedText('CANCELLED')).toContain('Nobody was told'));
});
