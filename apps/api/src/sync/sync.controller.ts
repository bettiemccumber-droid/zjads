import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString } from 'class-validator';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { SyncService } from './sync.service';

class CreateSyncJobDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  /** 是否采集联盟点击（默认否，可节省数分钟） */
  @IsOptional()
  @IsBoolean()
  includeClicks?: boolean;

  /** 管理员代指定员工采集 */
  @IsOptional()
  @IsInt()
  targetUserId?: number;

  /** 仅采集指定渠道账号；不传则采集全部已启用账号 */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  channelAccountIds?: number[];

  /** 仅采集指定平台 code（如 linkbux）；与 channelAccountIds 同时传时以账号列表为准 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platformCodes?: string[];
}

@Controller('sync')
@UseGuards(AuthGuard('jwt'))
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('jobs')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSyncJobDto) {
    try {
      const filter = {
        channelAccountIds: dto.channelAccountIds,
        platformCodes: dto.platformCodes,
      };
      const job =
        isAdmin(user) && dto.targetUserId
          ? await this.sync.createJobForOwner(
              dto.targetUserId,
              dto.startDate,
              dto.endDate,
              dto.includeClicks ?? false,
              filter,
            )
          : await this.sync.createJob(
              user,
              dto.startDate,
              dto.endDate,
              dto.includeClicks ?? false,
              filter,
            );
      return ok(job, '采集任务已创建');
    } catch (e) {
      const message = e instanceof Error ? e.message : '创建失败';
      return { success: false, data: null, message };
    }
  }

  @Post('jobs/:id/cancel')
  async cancelJob(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return ok(await this.sync.cancelJob(user, id), '任务已取消');
  }

  @Get('jobs/recent')
  async listRecent(
    @CurrentUser() user: AuthUser,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    const ownerUserId =
      userId && isAdmin(user) ? parseInt(userId, 10) : undefined;
    const n = limit ? Math.min(parseInt(limit, 10) || 5, 20) : 5;
    return ok(await this.sync.listRecentJobs(user, n, ownerUserId));
  }

  @Get('jobs/:id')
  async getJob(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return ok(await this.sync.getJob(user, id));
  }
}
