import { Module } from '@nestjs/common';
import { LocationService } from './location.service';

/** No controller yet — see LocationService. The session (1.10) and incident (1.8) flows call it. */
@Module({ providers: [LocationService], exports: [LocationService] })
export class LocationModule {}
