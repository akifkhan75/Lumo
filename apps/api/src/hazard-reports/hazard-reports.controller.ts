import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateHazardReportDto } from './dto/create-hazard-report.dto';
import { HazardReportsService } from './hazard-reports.service';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/hazard-reports')
export class HazardReportsController {
  constructor(private readonly hazardReportsService: HazardReportsService) {}

  @Get()
  async findAll(@Query('take', new DefaultValuePipe(50), ParseIntPipe) take: number) {
    return this.hazardReportsService.findAll({ take });
  }

  @Post()
  async create(@Request() req: any, @Body() body: CreateHazardReportDto) {
    // The coordinates come from the request and are validated as real
    // latitude and longitude. The predecessor generated them here with
    // Math.random() against a background image, which meant every report in
    // the database described a place nobody had been to.
    return this.hazardReportsService.create(body, req.user.id);
  }

  @Post(':id/confirm')
  async confirm(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.hazardReportsService.confirm(id, req.user.id);
  }
}
