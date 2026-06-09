import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../common/ownership.util';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AlertsService } from './alerts.service';

class SaveRuleDto {
  @IsBoolean()
  isEnabled!: boolean;

  @IsNumber()
  windowDays!: number;

  @IsNumber()
  rejectedAmountThreshold!: number;

  @IsNumber()
  rejectedRateThreshold!: number;

  @IsOptional()
  @IsNumber()
  minRejectedOrders?: number;

  @IsOptional()
  @IsNumber()
  minOrdersForRate?: number;

  @IsOptional()
  @IsNumber()
  minRejectedForRate?: number;

  @IsOptional()
  @IsBoolean()
  autoCheckOnSync?: boolean;
}

class CheckAlertsDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  platformCode?: string;

  /** 管理员可指定员工，仅对该员工同步告警 */
  @IsOptional()
  @IsNumber()
  userId?: number;
}

@Controller('commission-alerts')
@UseGuards(AuthGuard('jwt'))
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('rule')
  async getRule(@CurrentUser() user: AuthUser) {
    return ok(await this.alerts.getOrCreateRule(user.id));
  }

  @Post('rule')
  async saveRule(@CurrentUser() user: AuthUser, @Body() dto: SaveRuleDto) {
    return ok(await this.alerts.saveRule(user.id, dto), '已保存');
  }

  @Get('admin/company-summary')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async companySummary() {
    return ok(await this.alerts.companyAlertSummary());
  }

  @Get('overview')
  async overview(
    @CurrentUser() user: AuthUser,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('platformCode') platformCode?: string,
    @Query('userId') userId?: string,
  ) {
    return ok(
      await this.alerts.getOverview(
        user,
        startDate,
        endDate,
        platformCode,
        userId ? parseInt(userId, 10) : undefined,
      ),
    );
  }

  @Post('check')
  async check(@CurrentUser() user: AuthUser, @Body() dto: CheckAlertsDto) {
    return ok(
      await this.alerts.runCheckForScope(
        user,
        {
          startDate: dto.startDate,
          endDate: dto.endDate,
          platformCode: dto.platformCode,
        },
        dto.userId,
      ),
    );
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('platformCode') platformCode?: string,
  ) {
    return ok(
      await this.alerts.listAlerts(user, {
        userId: userId ? parseInt(userId, 10) : undefined,
        status,
        limit: limit ? parseInt(limit, 10) : 50,
        startDate,
        endDate,
        platformCode,
      }),
    );
  }

  @Post(':id/ack')
  async ack(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return ok(await this.alerts.ackAlert(user, id));
  }
}
