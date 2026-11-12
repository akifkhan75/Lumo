import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { DangerZonesService } from './danger-zones.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateDangerZoneDto } from './dto/create-danger-zone.dto';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/danger-zones')
export class DangerZonesController {
  constructor(private readonly dangerZonesService: DangerZonesService) {}

  @Get()
  async findAll() {
    return this.dangerZonesService.findAll();
  }

  @Post()
  async create(
    @Request() req: any,
    @Body() body: CreateDangerZoneDto,
  ) {
    // DEMO DATA: these are CSS percentages against a static background image,
    // scattered at random near the centre. They are not coordinates and the
    // map is not a map. Real geography arrives with HazardReport; until then
    // the UI labels this feature as a demo rather than implying it knows
    // where anything is.
    const top = `${48 + Math.random() * 4}%`;
    const left = `${48 + Math.random() * 4}%`;
    
    return this.dangerZonesService.create({
      top,
      left,
      severity: body.severity,
      type: body.type,
      description: body.description,
      userId: req.user.id,
    });
  }
}
