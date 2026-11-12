import type {
  Actor as DbActor,
  AttemptState as DbAttemptState,
  Channel as DbChannel,
  ConsentKind as DbConsentKind,
  IncidentMode as DbIncidentMode,
  IncidentState as DbIncidentState,
  SessionKind as DbSessionKind,
  SessionState as DbSessionState,
  TriggerType as DbTriggerType,
} from '@prisma/client';
import type {
  Actor,
  AttemptState,
  Channel,
  ConsentKind,
  IncidentMode,
  IncidentState,
  SessionKind,
  SessionState,
  TriggerType,
} from '@lumo/safety-domain';

/**
 * Compile-time proof that every database enum is EXACTLY the vocabulary
 * @lumo/safety-domain defines. This file emits no code; it exists so a mismatch
 * fails `tsc`.
 *
 * Prisma members are written with the domain's own strings — `push`, not `PUSH`,
 * and no @map — so there is no mapper to forget. The cost of that is that two
 * lists now have to agree, and this is what makes them. Add a state to a machine
 * and forget the migration, or the reverse, and the build breaks here.
 *
 * (The runtime half of the same check — the labels actually present in Postgres —
 * is in test/schema.e2e-spec.ts.)
 */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type MustBeTrue<T extends true> = T;

export type ActorMatches = MustBeTrue<Equal<DbActor, Actor>>;
export type AttemptStateMatches = MustBeTrue<Equal<DbAttemptState, AttemptState>>;
export type ChannelMatches = MustBeTrue<Equal<DbChannel, Channel>>;
export type ConsentKindMatches = MustBeTrue<Equal<DbConsentKind, ConsentKind>>;
export type IncidentModeMatches = MustBeTrue<Equal<DbIncidentMode, IncidentMode>>;
export type IncidentStateMatches = MustBeTrue<Equal<DbIncidentState, IncidentState>>;
export type SessionKindMatches = MustBeTrue<Equal<DbSessionKind, SessionKind>>;
export type SessionStateMatches = MustBeTrue<Equal<DbSessionState, SessionState>>;
export type TriggerTypeMatches = MustBeTrue<Equal<DbTriggerType, TriggerType>>;
