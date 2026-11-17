import { Module } from '@nestjs/common';
import { TrustedContactsModule } from '../trusted-contacts/trusted-contacts.module';
import { DispatchService } from './dispatch.service';
import { LedgerService } from './ledger.service';
import { NotificationQueue } from './queue';
import { SendWorker } from './send-worker';
import { SMS_PROVIDER } from './sms/sms-provider';
import { TwilioSms } from './sms/twilio-sms';
import { TwilioWebhookController } from './twilio-webhook.controller';
import { VOICE_PROVIDER } from './voice/voice-provider';
import { TwilioVoice } from './voice/twilio-voice';

@Module({
  imports: [TrustedContactsModule],
  controllers: [TwilioWebhookController],
  providers: [
    LedgerService,
    NotificationQueue,
    DispatchService,
    SendWorker,
    { provide: SMS_PROVIDER, useFactory: () => new TwilioSms() },
    { provide: VOICE_PROVIDER, useFactory: () => new TwilioVoice() },
  ],
  exports: [DispatchService, LedgerService],
})
export class NotificationsModule {}
