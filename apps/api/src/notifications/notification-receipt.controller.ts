import { Body, Controller, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Step } from './ledger.service';

export class ReceiptDto {
  @IsIn(['delivered', 'acknowledged'])
  kind!: 'delivered' | 'acknowledged';
}

/**
 * The DEVICE's report (docs/specs/NOTIFICATIONS.md). The only evidence that a push reached a
 * handset — a push service's receipt means only that it accepted the message — and the way a
 * contact says "I'm responding".
 *
 * Only the account LINKED to the attempt's recipient (the contact who claimed their invite) may
 * report, and only on a push attempt. Everything else — an unknown attempt, someone else's, a
 * different channel, a contact no longer linked — is the SAME 404, so the endpoint cannot be used
 * to find out which attempts exist or who a contact is.
 */
@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationReceiptController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  @Post(':attemptId/receipt')
  @HttpCode(200)
  async receipt(@Request() req: any, @Param('attemptId', new ParseUUIDPipe()) attemptId: string, @Body() body: ReceiptDto) {
    const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId } });
    const contact = attempt?.channel === 'push'
      ? await this.prisma.trustedContact.findFirst({ where: { id: attempt.recipientId, removedAt: null, linkedUserId: req.user.id } })
      : null;
    if (!attempt || !contact) throw new NotFoundException();

    // The device has the message, so the service must have accepted it, whatever we recorded.
    const inferAccepted: Step = { event: 'PROVIDER_ACCEPTED', by: 'system', reason: 'INFERRED_FROM_DEVICE', onlyFrom: 'QUEUED' };
    const steps: Step[] =
      body.kind === 'delivered'
        ? [inferAccepted, { event: 'RECEIPT_DELIVERED', by: 'contact', evidence: 'device', reason: 'DEVICE_RECEIPT' }]
        : [inferAccepted, { event: 'ACK', by: 'contact', reason: 'CONTACT_RESPONDING' }];
    const out = await this.ledger.apply(attempt.id, steps);
    // A duplicate or late report is normal and harmless: say what happened, never an error.
    return { recorded: out.applied };
  }
}
