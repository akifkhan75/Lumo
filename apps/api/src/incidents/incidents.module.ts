import { Module } from '@nestjs/common';
import { EscalationModule } from '../escalation/escalation.module';
import { LocationModule } from '../location/location.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmergencyCredentialService } from './emergency-credential.service';
import { IncidentAuthGuard } from './incident-auth.guard';
import { EmergencyTokenController, IncidentResponseController, IncidentsController } from './incidents.controller';
import { IncidentService } from './incident.service';

@Module({
  imports: [NotificationsModule, LocationModule, EscalationModule],
  controllers: [IncidentsController, IncidentResponseController, EmergencyTokenController],
  providers: [IncidentService, EmergencyCredentialService, IncidentAuthGuard],
  exports: [IncidentService],
})
export class IncidentsModule {}
