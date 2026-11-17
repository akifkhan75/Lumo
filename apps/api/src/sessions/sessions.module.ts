import { Module } from '@nestjs/common';
import { IncidentsModule } from '../incidents/incidents.module';
import { LocationModule } from '../location/location.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrustedContactsModule } from '../trusted-contacts/trusted-contacts.module';
import { SessionsController } from './sessions.controller';
import { SessionService } from './session.service';

@Module({
  imports: [IncidentsModule, NotificationsModule, LocationModule, TrustedContactsModule],
  controllers: [SessionsController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionsModule {}
