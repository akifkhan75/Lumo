import { Module } from '@nestjs/common';
import { TrustedContactsModule } from '../trusted-contacts/trusted-contacts.module';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [TrustedContactsModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
