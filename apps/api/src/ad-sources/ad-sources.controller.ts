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

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return ok(await this.adSources.remove(user, id));
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
