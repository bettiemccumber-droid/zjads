import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../common/ownership.util';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportsService } from './reports.service';

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

@Controller('reports')
@UseGuards(AuthGuard('jwt'))
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

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
