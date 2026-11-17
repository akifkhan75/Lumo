import { Module } from '@nestjs/common';
import { IncidentsModule } from '../incidents/incidents.module';
import { LocationModule } from '../location/location.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrustedContactsModule } from '../trusted-contacts/trusted-contacts.module';
import { JourneyLinksController, PublicJourneyController } from './journey-links.controller';
import { JourneyLinkService } from './journey-link.service';
import { SessionsController } from './sessions.controller';
import { SessionService } from './session.service';

@Module({
  imports: [IncidentsModule, NotificationsModule, LocationModule, TrustedContactsModule],
  controllers: [SessionsController, JourneyLinksController, PublicJourneyController],
  providers: [SessionService, JourneyLinkService],
  exports: [SessionService],
})
export class SessionsModule {}
