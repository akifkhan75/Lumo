import { Global, Module } from '@nestjs/common';
import { getRegionRegistry } from '../config/env';

/** Injection token for the RegionRegistry (it is an interface, so it has no class to inject). */
export const REGION_REGISTRY = 'REGION_REGISTRY';

/**
 * Built when the module is created, so a market that is not allowed to be enabled
 * stops the API from starting instead of failing on the first request. Global, as
 * several modules will need it (sessions, notifications, evidence).
 */
@Global()
@Module({
  providers: [{ provide: REGION_REGISTRY, useFactory: () => getRegionRegistry() }],
  exports: [REGION_REGISTRY],
})
export class RegionsModule {}
