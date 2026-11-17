import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrustedContactsModule } from '../trusted-contacts/trusted-contacts.module';
import { EscalationPolicyController } from './escalation-policy.controller';
import { EscalationService } from './escalation.service';

@Module({
  imports: [NotificationsModule, TrustedContactsModule],
  controllers: [EscalationPolicyController],
  providers: [EscalationService],
  exports: [EscalationService],
})
export class EscalationModule {}
