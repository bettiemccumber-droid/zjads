import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ok } from '../common/api-response';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChannelAccountsService } from './channel-accounts.service';
import { AffiliateClicksService } from './affiliate-clicks.service';

class ImportClickRowBody {
  @IsString()
  merchantId!: string;

  @IsString()
  clickDate!: string;

  @IsInt()
  @Min(0)
  clicks!: number;

  @IsOptional()
  @IsString()
  merchantName?: string;
}

class ImportClicksBody {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportClickRowBody)
  rows!: ImportClickRowBody[];
}

class CreateChannelAccountBody {
  @IsInt()
  platformId!: number;

  @IsString()
  displayName!: string;

  @IsString()
  apiToken!: string;

  @IsOptional()
  @IsString()
  externalChannelId?: string;

  @IsOptional()
  @IsString()
  affiliateAlias?: string;
}

class UpdateChannelAccountBody {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  externalChannelId?: string;

  @IsOptional()
  @IsString()
  affiliateAlias?: string;

  @IsOptional()
  @IsString()
  apiToken?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Controller('channel-accounts')
@UseGuards(AuthGuard('jwt'))
export class ChannelAccountsController {
  constructor(
    private readonly service: ChannelAccountsService,
    private readonly affiliateClicks: AffiliateClicksService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('userId') userId?: string) {
    const filterId = userId && isAdmin(user) ? parseInt(userId, 10) : undefined;
    return ok(await this.service.list(user, filterId));
  }

  @Get('by-platform')
  async listByPlatform(@CurrentUser() user: AuthUser, @Query('userId') userId?: string) {
    const filterId = userId && isAdmin(user) ? parseInt(userId, 10) : undefined;
    return ok(await this.service.listGroupedByPlatform(user, filterId));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateChannelAccountBody) {
    if (user.role === UserRole.VIEWER) {
      return { success: false, data: null, message: '只读账号无法添加平台账号' };
    }
    const data = await this.service.create(user, body);
    return ok(data, '添加成功');
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateChannelAccountBody,
  ) {
    if (user.role === UserRole.VIEWER) {
      return { success: false, data: null, message: '只读账号无法修改' };
    }
    const data = await this.service.update(user, id, body);
    return ok(data, '修改成功');
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    if (user.role === UserRole.VIEWER) {
      return { success: false, data: null, message: '只读账号无法删除' };
    }
    return ok(await this.service.remove(user, id), '删除成功');
  }

  /**
   * 手动导入联盟点击校准（LB 后台导出 → CSV/JSON，历史数据补齐）
   */
  @Post(':id/clicks/import')
  async importClicks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ImportClicksBody,
  ) {
    if (user.role === UserRole.VIEWER) {
      return { success: false, data: null, message: '只读账号无法导入' };
    }
    const data = await this.affiliateClicks.importManualClicks(user, id, body.rows);
    return ok(data, `已导入 ${data.imported} 条，合计 ${data.totalClicks} 次点击`);
  }
}
