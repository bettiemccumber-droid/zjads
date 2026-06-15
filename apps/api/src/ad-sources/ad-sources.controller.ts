import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsDateString, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../common/ownership.util';
import { AdSourcesService } from './ad-sources.service';

class CreateAdDataSourceBody {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsUrl()
  @MaxLength(500)
  sheetUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mainTab?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class ImportQuery {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

class PurgeImportedQuery {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** 管理员可指定员工 */
  @IsOptional()
  userId?: number;
}

class RemoveQuery {
  /** 为 true 时同时清空该账号下全部已导入广告日数据 */
  @IsOptional()
  purgeImported?: string;
}

@Controller('ad-sources')
@UseGuards(AuthGuard('jwt'))
export class AdSourcesController {
  constructor(private readonly adSources: AdSourcesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return ok(await this.adSources.list(user));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateAdDataSourceBody) {
    return ok(await this.adSources.create(user, body));
  }

  @Post('purge-imported')
  async purgeImported(@CurrentUser() user: AuthUser, @Query() q: PurgeImportedQuery) {
    return ok(
      await this.adSources.purgeImportedCampaignData(user, {
        startDate: q.startDate,
        endDate: q.endDate,
        userId: q.userId != null ? Number(q.userId) : undefined,
      }),
      '已清空导入的广告数据',
    );
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() q: RemoveQuery,
  ) {
    const purgeImported = q.purgeImported === '1' || q.purgeImported === 'true';
    return ok(await this.adSources.remove(user, id, purgeImported));
  }

  @Post(':id/import')
  async import(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() q: ImportQuery,
  ) {
    return ok(await this.adSources.importFromSource(user, id, q.startDate, q.endDate));
  }
}
