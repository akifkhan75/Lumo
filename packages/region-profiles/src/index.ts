/**
 * @lumo/region-profiles — everything market-specific, as data (ADR-0011, PLAT-1).
 *
 * No market-specific value may be hard-coded anywhere else in the repo: an emergency
 * number, a currency, a consent rule, a retention window all resolve through here.
 * Pure: no I/O, no clock (time is injected), and no geocoding.
 */
export * from './types';
export * from './validation';
export * from './registry';
export * from './resolve';
export * from './profiles';
