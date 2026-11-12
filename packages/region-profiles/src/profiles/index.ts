import type { RegionProfile } from '../types';
import { PK } from './pk';
import { US } from './us';

/** Every profile Lumo knows. Whether any of them is ENABLED is the registry's business. */
export const PROFILES: readonly RegionProfile[] = [PK, US];

export { PK, US };
export { GLOBAL_DEFAULT } from './global-default';
