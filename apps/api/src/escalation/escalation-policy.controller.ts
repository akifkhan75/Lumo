import { BadRequestException, Body, Controller, Get, HttpCode, Put, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { CHANNELS, describePolicy, validatePolicy, type EscalationPolicy } from '@lumo/safety-domain';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';
import { EscalationService } from './escalation.service';

class RecipientDto {
  // Circles do not exist yet (KI-66); a contact is the only kind that can be named.
  @IsIn(['contact']) kind!: 'contact';
  @IsString() @IsNotEmpty() id!: string;
}
class StepDto {
  @IsInt() @Min(1) @Max(20) order!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => RecipientDto) recipients!: RecipientDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsIn(CHANNELS as unknown as string[], { each: true }) channels!: (typeof CHANNELS)[number][];
  @IsInt() @Min(10) @Max(86_400) timeoutSeconds!: number;
  @IsBoolean() requireAck!: boolean;
}
export class PolicyDto {
  @IsString() @Length(1, 60) name!: string;
  @IsInt() @Min(0) @Max(86_400) graceSeconds!: number; // the minimum is enforced by validatePolicy so the message names it
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => StepDto) steps!: StepDto[];
  @IsInt() @Min(1) @Max(20) maxRecipientsPerIncident!: number;
  @IsBoolean() stopOnAcknowledgement!: boolean;
  @IsBoolean() resumeOnUnacknowledge!: boolean;
  @IsBoolean() promptEmergencyNumberOnFailure!: boolean;
  @IsInt() @Min(1) @Max(86_400) deviationGraceSeconds!: number;
}

/**
 * The user's escalation plan, shown BEFORE it runs (RES-4): a person who cannot predict what their app will do cannot trust
 * it. Login only; the emergency token has no business here.
 */
@Controller('api/v1/escalation-policy')
@UseGuards(JwtAuthGuard)
export class EscalationPolicyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly escalation: EscalationService,
    private readonly contacts: TrustedContactsService,
  ) {}

  private async describe(userId: string, policy: EscalationPolicy) {
    const list = await this.contacts.list(this.prisma, userId);
    const names = Object.fromEntries(list.map(c => [c.id, c.name]));
    return describePolicy(policy, names);
  }

  @Get()
  async get(@Request() req: any) {
    const { policy, stored } = await this.escalation.policyFor(this.prisma, req.user.id);
    return { stored, policy, description: await this.describe(req.user.id, policy) };
  }

  @Put()
  @HttpCode(200)
  async put(@Request() req: any, @Body() body: PolicyDto) {
    const userId: string = req.user.id;
    const policy: EscalationPolicy = { id: 'new', ...body, steps: body.steps.map(s => ({ ...s, recipients: s.recipients })) };

    const issues = validatePolicy(policy);
    if (issues.length > 0) throw new BadRequestException({ message: issues.map(i => i.message), issues });

    // Only the person's own, current contacts can be named: an id from another account is not honoured.
    const own = new Set((await this.contacts.list(this.prisma, userId)).map(c => c.id));
    const foreign = body.steps.flatMap(s => s.recipients).filter(r => !own.has(r.id));
    if (foreign.length > 0) throw new BadRequestException('A step names someone who is not one of your contacts.');

    await this.prisma.$transaction(async tx => {
      await tx.escalationPolicy.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      await tx.escalationPolicy.create({
        data: {
          userId, isDefault: true, name: body.name, graceSeconds: body.graceSeconds, steps: JSON.parse(JSON.stringify(policy.steps)),
          maxRecipientsPerIncident: body.maxRecipientsPerIncident, stopOnAcknowledgement: body.stopOnAcknowledgement,
          resumeOnUnacknowledge: body.resumeOnUnacknowledge, promptEmergencyNumberOnFailure: body.promptEmergencyNumberOnFailure,
          deviationGraceSeconds: body.deviationGraceSeconds,
        },
      });
    });
    return this.get(req);
  }
}
