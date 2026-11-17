import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { TrustedContactsModule } from '../trusted-contacts/trusted-contacts.module';
import { PUSH_PROVIDER } from './push/push-provider';
import { ExpoPush } from './push/expo-push';
import { NotificationReceiptController } from './notification-receipt.controller';
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
  imports: [TrustedContactsModule, DevicesModule],
  controllers: [TwilioWebhookController, NotificationReceiptController],
  providers: [
    LedgerService,
    NotificationQueue,
    DispatchService,
    SendWorker,
    { provide: SMS_PROVIDER, useFactory: () => new TwilioSms() },
    { provide: VOICE_PROVIDER, useFactory: () => new TwilioVoice() },
    { provide: PUSH_PROVIDER, useFactory: () => new ExpoPush() },
  ],
  exports: [DispatchService, LedgerService, NotificationQueue],
})
export class NotificationsModule {}
