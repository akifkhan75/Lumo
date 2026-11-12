import { Module } from '@nestjs/common';
import { HazardReportsController } from './hazard-reports.controller';
import { HazardReportsService } from './hazard-reports.service';

@Module({
  controllers: [HazardReportsController],
  providers: [HazardReportsService],
  exports: [HazardReportsService],
})
export class HazardReportsModule {}
