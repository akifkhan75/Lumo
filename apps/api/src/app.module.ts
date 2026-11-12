import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { DangerZonesModule } from './danger-zones/danger-zones.module';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    // KI-22: the API had no rate limiting at all. Login was free to brute
    // force and the AI endpoints were free to run up a bill.
    //
    // These ceilings are deliberately generous because nothing on the
    // emergency path may ever be throttled. When the escalation endpoints
    // land in Phase 1 they are exempted explicitly with @SkipThrottle, not by
    // keeping the limit loose enough to miss them.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'long', ttl: 60_000, limit: 120 },
    ]),
    PrismaModule,
    SettingsModule,
    DangerZonesModule,
    AuthModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
