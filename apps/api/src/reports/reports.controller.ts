import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../common/ownership.util';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportsService } from './reports.service';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementAdSpendService } from './settlement-ad-spend.service';
import { SettlementMonthlyReportService } from './settlement-monthly-report.service';
import { SettlementPayoutInfoService } from './settlement-payout-info.service';
import { SettlementReceivableCommissionService } from './settlement-receivable-commission.service';
import { SettlementRewardooPaymentsSyncService } from './settlement-rewardoo-payments-sync.service';

class DateRangeQuery {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  userId?: string;
}

class CampaignSummaryQuery extends DateRangeQuery {
  /** all | active | paused */
  @IsOptional()
  @IsIn(['all', 'active', 'paused'])
  statusMode?: string;

  /** @deprecated 请用 statusMode */
  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  enabledOnly?: string;

  /** @deprecated 请用 statusMode */
  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  hideIdlePaused?: string;
}

class SettlementMonthlyQuery {
  @IsOptional()
  month?: string;

  @IsOptional()
  userId?: string;

  /** 为 1/true 时强制刷新 USD/CNY 实时汇率 */
  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  refreshFx?: string;
}

class SettlementYearlyQuery {
  @IsOptional()
  year?: string;

  @IsOptional()
  userId?: string;

  @IsOptional()
  @IsIn(['true', 'false', '1', '0'])
  refreshFx?: string;
}

function parseRefreshFx(raw?: string): boolean {
  return raw === 'true' || raw === '1';
}

class SaveSettlementActualCommissionDto {
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  @IsOptional()
  @IsString()
  userId?: string;

  /** @deprecated 使用 halfValues */
  @IsOptional()
  @IsObject()
  values?: Record<string, number>;

  @IsOptional()
  @IsObject()
  halfValues?: Record<string, { usdH1: number; usdH2: number }>;
}

class SettlementAdSpendLineDto {
  @IsNumber()
  adSourceId!: number;

  @IsNumber()
  adjustmentUsd!: number;

  @IsNumber()
  spendUsd!: number;
}

class SaveSettlementAdSpendDto {
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettlementAdSpendLineDto)
  lines!: SettlementAdSpendLineDto[];

  @IsNumber()
  rebateAdSpendUsd!: number;
}

class SettlementPayoutLineDto {
  @IsNumber()
  channelAccountId!: number;

  @IsString()
  payeeName!: string;

  @IsString()
  bankAccount!: string;
}

class SaveSettlementPayoutInfoDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettlementPayoutLineDto)
  lines!: SettlementPayoutLineDto[];
}

@Controller('reports')
@UseGuards(AuthGuard('jwt'))
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly settlementMonthlyReport: SettlementMonthlyReportService,
    private readonly settlementActualCommission: SettlementActualCommissionService,
    private readonly settlementAdSpend: SettlementAdSpendService,
    private readonly settlementPayoutInfo: SettlementPayoutInfoService,
    private readonly settlementReceivableCommission: SettlementReceivableCommissionService,
    private readonly settlementRewardooPaymentsSync: SettlementRewardooPaymentsSyncService,
  ) {}

  @Get('merchant-summary')
  async merchantSummary(@CurrentUser() user: AuthUser, @Query() q: DateRangeQuery) {
    return ok(
      await this.reports.merchantSummary(user, {
        startDate: q.startDate,
        endDate: q.endDate,
        userId: q.userId ? parseInt(q.userId, 10) : undefined,
      }),
    );
  }

  @Get('campaign-summary')
  async campaignSummary(@CurrentUser() user: AuthUser, @Query() q: CampaignSummaryQuery) {
    return ok(
      await this.reports.campaignSummary(user, this.parseCampaignQuery(q)),
    );
  }

  @Get('campaign-daily')
  async campaignDaily(@CurrentUser() user: AuthUser, @Query() q: CampaignSummaryQuery) {
    return ok(await this.reports.campaignDaily(user, this.parseCampaignQuery(q)));
  }

  @Get('ad-spend-coverage')
  async adSpendCoverage(@CurrentUser() user: AuthUser, @Query() q: DateRangeQuery) {
    return ok(
      await this.reports.adSpendCoverage(user, {
        startDate: q.startDate,
        endDate: q.endDate,
        userId: q.userId ? parseInt(q.userId, 10) : undefined,
      }),
    );
  }

  private parseCampaignQuery(q: CampaignSummaryQuery): {
    startDate: string;
    endDate: string;
    userId?: number;
    statusMode?: 'all' | 'active' | 'paused';
    enabledOnly: boolean;
    hideIdlePaused: boolean;
  } {
    const statusMode: 'all' | 'active' | 'paused' | undefined =
      q.statusMode === 'all' || q.statusMode === 'active' || q.statusMode === 'paused'
        ? q.statusMode
        : undefined;
    const enabledOnly = q.enabledOnly === 'true' || q.enabledOnly === '1';
    const hideIdlePaused =
      q.hideIdlePaused === undefined || q.hideIdlePaused === 'true' || q.hideIdlePaused === '1';
    return {
      startDate: q.startDate,
      endDate: q.endDate,
      userId: q.userId ? parseInt(q.userId, 10) : undefined,
      statusMode,
      enabledOnly,
      hideIdlePaused,
    };
  }

  /** 月度结算报表（MVP：广告费 MCC + 联盟序号佣金矩阵） */
  @Get('settlement-monthly')
  async settlementMonthly(@CurrentUser() user: AuthUser, @Query() q: SettlementMonthlyQuery) {
    const month =
      q.month?.trim() ||
      new Date().toISOString().slice(0, 7);
    return ok(
      await this.settlementMonthlyReport.build(
        user,
        month,
        q.userId ? parseInt(q.userId, 10) : undefined,
        parseRefreshFx(q.refreshFx),
      ),
    );
  }

  /** 从 Rewardoo Payments API 同步 RW 列应收/实收 */
  @Post('settlement-monthly/sync-rewardoo-payments')
  async syncSettlementRewardooPayments(
    @CurrentUser() user: AuthUser,
    @Body() body: SaveSettlementActualCommissionDto,
  ) {
    const queryUserId = body.userId ? parseInt(body.userId, 10) : undefined;
    const result = await this.settlementRewardooPaymentsSync.syncForMonth(
      user,
      body.month,
      queryUserId,
    );
    return ok(result);
  }

  /** 保存月度应收佣金（各平台后台口径，按渠道账号列） */
  @Put('settlement-monthly/receivable-commission')
  async saveSettlementReceivableCommission(
    @CurrentUser() user: AuthUser,
    @Body() body: SaveSettlementActualCommissionDto,
  ) {
    const queryUserId = body.userId ? parseInt(body.userId, 10) : undefined;
    if (!body.halfValues || Object.keys(body.halfValues).length === 0) {
      return ok({ halfValues: {} });
    }
    const halfValues = await this.settlementReceivableCommission.saveHalves(
      user,
      body.month,
      body.halfValues,
      queryUserId,
    );
    return ok({ halfValues });
  }

  /** 保存月度实收佣金（按报表 scope + 联盟序号列） */
  @Put('settlement-monthly/actual-commission')
  async saveSettlementActualCommission(
    @CurrentUser() user: AuthUser,
    @Body() body: SaveSettlementActualCommissionDto,
  ) {
    const queryUserId = body.userId ? parseInt(body.userId, 10) : undefined;
    if (body.halfValues && Object.keys(body.halfValues).length > 0) {
      const halfValues = await this.settlementActualCommission.saveHalves(
        user,
        body.month,
        body.halfValues,
        queryUserId,
      );
      return ok({ halfValues });
    }
    const values = await this.settlementActualCommission.save(
      user,
      body.month,
      body.values ?? {},
      queryUserId,
    );
    return ok({ values });
  }

  /** 保存月度广告费（补充 / 可改 / 应返） */
  @Put('settlement-monthly/ad-spend')
  async saveSettlementAdSpend(@CurrentUser() user: AuthUser, @Body() body: SaveSettlementAdSpendDto) {
    const queryUserId = body.userId ? parseInt(body.userId, 10) : undefined;
    const saved = await this.settlementAdSpend.save(
      user,
      body.month,
      body.lines,
      body.rebateAdSpendUsd,
      queryUserId,
    );
    return ok(saved);
  }

  /** 保存结算收款人 / 卡号（写入各渠道账号） */
  @Put('settlement-monthly/payout-info')
  async saveSettlementPayoutInfo(
    @CurrentUser() user: AuthUser,
    @Body() body: SaveSettlementPayoutInfoDto,
  ) {
    const queryUserId = body.userId ? parseInt(body.userId, 10) : undefined;
    await this.settlementPayoutInfo.saveLines(user, body.lines, queryUserId);
    return ok({ saved: true });
  }

  /** 年度结算报表（12 个月趋势 + 整年 MCC / 佣金矩阵） */
  @Get('settlement-yearly')
  async settlementYearly(@CurrentUser() user: AuthUser, @Query() q: SettlementYearlyQuery) {
    const year =
      q.year?.trim() ||
      String(new Date().getUTCFullYear());
    return ok(
      await this.settlementMonthlyReport.buildYearly(
        user,
        year,
        q.userId ? parseInt(q.userId, 10) : undefined,
        parseRefreshFx(q.refreshFx),
      ),
    );
  }

  @Get('company-dashboard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async companyDashboard(@Query() q: DateRangeQuery) {
    return ok(
      await this.reports.companyDashboard({
        startDate: q.startDate,
        endDate: q.endDate,
      }),
    );
  }
}
