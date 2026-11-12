import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SafetyChatDto } from './dto/safety-chat.dto';

@Controller('api/v1/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @UseGuards(JwtAuthGuard)
  @Get('fake-call-script')
  async getFakeCallScript() {
    return this.aiService.getFakeCallScript();
  }

  @UseGuards(JwtAuthGuard)
  @Get('self-defense-tips')
  async getSelfDefenseTips() {
    return this.aiService.getSelfDefenseTips();
  }

  @UseGuards(JwtAuthGuard)
  @Post('safety-chat')
  async safetyChat(@Body() body: SafetyChatDto) {
    return this.aiService.safetyChat(body.message, body.history);
  }
}
