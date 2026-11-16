import { Module } from '@nestjs/common';
import { ContactInviteController, PublicConsentController } from './contact-consent.controller';
import { ContactConsentService } from './contact-consent.service';
import { TrustedContactsService } from './trusted-contacts.service';

/**
 * Contacts are still written through settings (and reconciled there). What is added in
 * milestone 1.6 is the consent flow: a link per contact, and the public page the contact
 * opens to agree or withdraw. See docs/specs/TRUSTED_CONTACTS.md.
 */
@Module({
  controllers: [ContactInviteController, PublicConsentController],
  providers: [TrustedContactsService, ContactConsentService],
  exports: [TrustedContactsService, ContactConsentService],
})
export class TrustedContactsModule {}
