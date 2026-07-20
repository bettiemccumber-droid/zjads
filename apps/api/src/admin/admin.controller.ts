import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString } from 'class-validator';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../common/ownership.util';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminService } from './admin.service';

class AdminDateQuery {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

class BatchSyncDto extends AdminDateQuery {
  @IsOptional()
  @IsBoolean()
  includeClicks?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  userIds?: number[];
}

class BatchImportDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  userIds?: number[];
}

class PurgeSyncJobsDto {
  /** 每位员工保留最近 N 条已完成/失败记录（默认 30） */
  @IsOptional()
  @IsInt()
  keepPerUser?: number;

  /** 仅清理指定员工 */
  @IsOptional()
  @IsInt()
  userId?: number;
}

class MerchantAnalysisQuery extends AdminDateQuery {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  /** 为 true 时返回全部商家（用于 Excel 导出） */
  @IsOptional()
  @IsString()
  all?: string;
}

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  async overview(@Query() q: AdminDateQuery) {
    return ok(await this.admin.platformOverview(q));
  }

  @Get('merchant-analysis')
  async merchantAnalysis(@Query() q: MerchantAnalysisQuery) {
    return ok(
      await this.admin.merchantAnalysis(q, {
        search: q.search,
        page: q.page ? parseInt(q.page, 10) : 1,
        pageSize: q.pageSize ? parseInt(q.pageSize, 10) : 10,
        exportAll: q.all === '1' || q.all === 'true',
      }),
    );
  }

  @Get('users/summary')
  async usersSummary(@Query() q: AdminDateQuery) {
    return ok(await this.admin.usersSummary(q));
  }

  @Get('users/:id/detail')
  async userDetail(@Param('id', ParseIntPipe) id: number, @Query() q: AdminDateQuery) {
    const data = await this.admin.userDetail(id, q);
    if (!data) return { success: false, data: null, message: '用户不存在' };
    return ok(data);
  }

  @Get('users/:id/sync-jobs')
  async userSyncJobs(@Param('id', ParseIntPipe) id: number, @Query('limit') limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10) || 10, 30) : 10;
    return ok(await this.admin.userSyncJobs(id, n));
  }

  @Get('collection-status')
  async collectionStatus() {
    return ok(await this.admin.collectionStatus());
  }

  @Post('sync/batch')
  async batchSync(@CurrentUser() user: AuthUser, @Body() dto: BatchSyncDto) {
    return ok(
      await this.admin.batchSyncOrders(user, dto, {
        includeClicks: dto.includeClicks,
        userIds: dto.userIds,
      }),
      '批量采集任务已创建',
    );
  }

  @Post('import/sheets/batch')
  async batchImportSheets(@CurrentUser() user: AuthUser, @Body() dto: BatchImportDto) {
    const result = await this.admin.batchImportSheets(user, dto.startDate, dto.endDate, dto.userIds);
    const msg =
      dto.userIds?.length === 1
        ? result.byUser[0]?.ok
          ? `已导入 ${result.sheetSuccess}/${result.byUser[0]?.sheetCount ?? 0} 个 Sheet`
          : result.byUser[0]?.message ?? 'Sheet 导入失败'
        : `批量 Sheet 导入：${result.userSuccess} 人成功，共 ${result.sheetSuccess} 个 Sheet`;
    return ok(result, msg);
  }

  @Post('sync-jobs/purge')
  async purgeSyncJobs(@Body() dto: PurgeSyncJobsDto) {
    const result = await this.admin.purgeSyncJobHistory({
      keepPerUser: dto.keepPerUser,
      userId: dto.userId,
    });
    return ok(
      result,
      `已清理 ${result.deletedJobs} 条历史采集记录（每人保留最近 ${result.keepPerUser} 条，进行中任务不删）`,
    );
  }
}
