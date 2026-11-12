import type { HazardType, HazardReportSource } from '@prisma/client';
import type { HazardSourceKey, HazardTypeKey } from '@lumo/safety-domain';

/**
 * Compile-time proof that the database enum and the shared policy name exactly
 * the same hazard types and sources. This file emits no code; it exists so a
 * mismatch fails `tsc`.
 *
 * The case it guards: someone adds a member to the Prisma enum and forgets the
 * decay time in @lumo/safety-domain. Without this, the new type has no expiry —
 * and "a report with no expiry becomes a permanent mark on a place" is the exact
 * failure ADR-0010 exists to prevent. With it, the build breaks instead.
 */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type MustBeTrue<T extends true> = T;

export type HazardTypesMatchPrisma = MustBeTrue<Equal<HazardType, HazardTypeKey>>;
export type HazardSourcesMatchPrisma = MustBeTrue<Equal<HazardReportSource, HazardSourceKey>>;
