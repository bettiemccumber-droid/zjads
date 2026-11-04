import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementMonthlyReportService } from './settlement-monthly-report.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, SettlementActualCommissionService, SettlementMonthlyReportService],
  exports: [ReportsService, SettlementActualCommissionService, SettlementMonthlyReportService],
})
export class ReportsModule {}
