import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementAdSpendService } from './settlement-ad-spend.service';
import { SettlementMonthlyReportService } from './settlement-monthly-report.service';
import { SettlementPayoutInfoService } from './settlement-payout-info.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { SettlementRewardooPaymentsSyncService } from './settlement-rewardoo-payments-sync.service';
import { SettlementUsdCnyRateService } from './settlement-usd-cny-rate.service';
import { CryptoService } from '../common/crypto.service';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    SettlementActualCommissionService,
    SettlementAdSpendService,
    SettlementUsdCnyRateService,
    SettlementPayoutInfoService,
    SettlementReceivableCommissionService,
    SettlementRewardooPaymentsSyncService,
    CryptoService,
    SettlementMonthlyReportService,
  ],
  exports: [
    ReportsService,
    SettlementActualCommissionService,
    SettlementAdSpendService,
    SettlementUsdCnyRateService,
    SettlementPayoutInfoService,
    SettlementReceivableCommissionService,
    SettlementMonthlyReportService,
  ],
})
export class ReportsModule {}
