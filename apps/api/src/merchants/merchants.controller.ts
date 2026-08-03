import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { MerchantsService } from './merchants.service';
import { MerchantQueryItem } from './merchant-status.types';

class MerchantQueryItemBody {
  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  mcid?: string;

  @IsOptional()
  @IsString()
  domain?: string;
}

class MerchantStatusQueryBody {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MerchantQueryItemBody)
  items!: MerchantQueryItem[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  channelAccountIds?: number[];

  @IsOptional()
  @IsInt()
  targetUserId?: number;
}

class MerchantStatusSummaryBody {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MerchantQueryItemBody)
  items!: MerchantQueryItem[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  userIds?: number[];
}

class ParseQueryTextBody {
  @IsString()
  text!: string;
}

@Controller('merchants/status')
@UseGuards(AuthGuard('jwt'))
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  /** 列出可用于商家状态查询的渠道账号 */
  @Get('accounts')
  async listAccounts(@CurrentUser() user: AuthUser, @Query('userId') userId?: string) {
    const targetUserId = userId && isAdmin(user) ? parseInt(userId, 10) : undefined;
    return ok(await this.merchants.listQueryableAccounts(user, targetUserId));
  }

  /** 解析批量粘贴文本 */
  @Post('parse-text')
  async parseText(@Body() body: ParseQueryTextBody) {
    return ok(this.merchants.parseQueryText(body.text));
  }

  /** 查询商家状态（员工自查 / 管理员代查） */
  @Post('query')
  async query(@CurrentUser() user: AuthUser, @Body() body: MerchantStatusQueryBody) {
    const result = await this.merchants.queryStatus(user, body);
    return ok(result);
  }

  /** 管理员：跨员工汇总各平台通过数 */
  @Post('summary')
  async summary(@CurrentUser() user: AuthUser, @Body() body: MerchantStatusSummaryBody) {
    const result = await this.merchants.queryAdminSummary(user, body);
    return ok(result);
  }
}
