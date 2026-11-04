import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IsDateString, IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../common/ownership.util';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportsService } from './reports.service';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementMonthlyReportService } from './settlement-monthly-report.service';

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
}

class SettlementYearlyQuery {
  @IsOptional()
  year?: string;

  @IsOptional()
  userId?: string;
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

@Controller('reports')
@UseGuards(AuthGuard('jwt'))
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly settlementMonthlyReport: SettlementMonthlyReportService,
    private readonly settlementActualCommission: SettlementActualCommissionService,
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
      ),
    );
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
