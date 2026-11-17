import { Module } from '@nestjs/common';
import { EscalationModule } from '../escalation/escalation.module';
import { LocationModule } from '../location/location.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmergencyCredentialService } from './emergency-credential.service';
import { IncidentAuthGuard } from './incident-auth.guard';
import { EmergencyTokenController, IncidentHistoryController, IncidentResponseController, IncidentsController } from './incidents.controller';
import { IncidentHistoryService } from './incident-history.service';
import { IncidentService } from './incident.service';
import { PracticeService } from './practice.service';
import { TrustedContactsModule } from '../trusted-contacts/trusted-contacts.module';

@Module({
  imports: [NotificationsModule, LocationModule, EscalationModule, TrustedContactsModule],
  controllers: [IncidentsController, IncidentResponseController, IncidentHistoryController, EmergencyTokenController],
  providers: [IncidentService, IncidentHistoryService, PracticeService, EmergencyCredentialService, IncidentAuthGuard],
  exports: [IncidentService],
})
export class IncidentsModule {}
