import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DevicesService } from './devices.service';

export class RegisterDeviceDto {
  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  osVersion!: string;

  // An Expo push token: ExponentPushToken[...] or ExpoPushToken[...].
  @IsString()
  @Matches(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/, { message: 'pushToken must be an Expo push token' })
  pushToken!: string;
}

@Controller('api/v1/devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @HttpCode(201)
  async register(@Request() req: any, @Body() body: RegisterDeviceDto) {
    return this.devices.register(req.user.id, body); // the token is never echoed back
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.devices.revoke(req.user.id, id);
  }
}
