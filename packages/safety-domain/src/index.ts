/**
 * @lumo/safety-domain — Lumo's safety logic, in one place.
 *
 * Pure: no I/O, no network, no clock (time is injected), no randomness, and no
 * runtime dependencies. Imported unchanged by apps/api and apps/mobile, so an
 * offline phone and the server cannot disagree about what is legal (ADR-0009,
 * PLAT-7). Effects are declared here and executed by the caller; nothing in this
 * package sends anything.
 */

export * from './types';
export * from './machine';
export * from './capabilities';
export * from './attempt';
export * from './session';
export * from './incident';
export * from './rollup';
export * from './escalation';
export * from './idempotency';
export * from './sha256';
export * from './replay';
export * from './hazard';
