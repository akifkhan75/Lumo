import { Module } from '@nestjs/common';
import { TrustedContactsService } from './trusted-contacts.service';

/**
 * No controller yet, on purpose. Per-contact endpoints arrive with the consent
 * invite flow (milestone 1.6), where "create a contact" also means "ask them to
 * agree" — and an endpoint that creates one without asking would be the wrong one
 * to ship first. Settings is the only caller for now.
 */
@Module({
  providers: [TrustedContactsService],
  exports: [TrustedContactsService],
})
export class TrustedContactsModule {}
