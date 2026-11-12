import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ok } from '../common/api-response';
import { AuthUser } from '../common/ownership.util';
import { AdDraft, AdKeyword, AdSitelink } from './ads-automation.util';
import { AdsAutomationService } from './ads-automation.service';

class KeywordBody implements AdKeyword {
  @IsString()
  text!: string;

  @IsIn(['BROAD', 'PHRASE', 'EXACT'])
  matchType!: 'BROAD' | 'PHRASE' | 'EXACT';
}

class SitelinkBody implements AdSitelink {
  @IsString()
  linkText!: string;

  @IsString()
  description1!: string;

  @IsString()
  description2!: string;

  @IsString()
  finalUrl!: string;

  @IsBoolean()
  verified!: boolean;
}

class DraftPatchBody implements Partial<AdDraft> {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  headlines?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  descriptions?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeywordBody)
  keywords?: AdKeyword[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeywordBody)
  negativeKeywords?: AdKeyword[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SitelinkBody)
  sitelinks?: AdSitelink[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  callouts?: string[];

  @IsOptional()
  @IsString()
  merchantUrl?: string;

  @IsOptional()
  @IsString()
  finalUrlSuffix?: string;

  @IsOptional()
  @IsIn(['MAXIMIZE_CLICKS', 'MANUAL_CPC'])
  bidding?: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';

  @IsOptional()
  @IsString()
  dailyBudgetUsd?: string;

  @IsOptional()
  @IsString()
  cpcBidCeilingUsd?: string;

  @IsOptional()
  @IsString()
  languageCode?: string;

  @IsOptional()
  @IsString()
  geoTargetId?: string;
}

class ArticlePublishBody {
  @Type(() => Number)
  @IsInt()
  channelAccountId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  siteId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  catalogMerchantId?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  mid?: string;

  @IsString()
  merchantUrl!: string;

  @IsString()
  countryCode!: string;

  @IsString()
  languageCode!: string;
}

/**
 * 内容站、收款方式、商家、任务和本地系列。
 * 路由都是新的，不替换现有报表和渠道账号接口。
 */
@Controller()
@UseGuards(AuthGuard('jwt'))
export class AdsAutomationController {
  constructor(private readonly ads: AdsAutomationService) {}

  @Get('publish-sites')
  async listSites() {
    return ok(await this.ads.listSites());
  }

  @Post('publish-sites')
  async createSite(
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; domain: string; publishUrl?: string; token?: string },
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('只有管理员可以添加内容站');
    }
    return ok(
      await this.ads.createSite(user.id, body.name, body.domain, body.publishUrl, body.token),
      '内容站已添加',
    );
  }

  @Patch('publish-sites/:id')
  async updateSite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { publishUrl?: string; token?: string },
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('只有管理员可以修改内容站');
    }
    return ok(await this.ads.updateSite(id, body), '内容站已更新');
  }

  @Get('payment-methods')
  async listPaymentMethods(@CurrentUser() user: AuthUser) {
    return ok(await this.ads.listPaymentMethods(user.id));
  }

  @Post('payment-methods')
  async createPaymentMethod(@CurrentUser() user: AuthUser, @Body() body: { name: string }) {
    this.assertWriter(user);
    return ok(await this.ads.createPaymentMethod(user.id, body.name), '收款方式已添加');
  }

  @Get('catalog-merchants')
  async listMerchants(@CurrentUser() user: AuthUser) {
    return ok(await this.ads.listMerchants(user.id));
  }

  /** 已经投过广告的商家。 */
  @Get('catalog-merchants/advertised')
  async listAdvertisedMerchants(@CurrentUser() user: AuthUser) {
    return ok(await this.ads.listAdvertisedMerchants(user.id));
  }

  /** 从联盟商家库翻页查找，结果里带商家网址。 */
  @Get('catalog-merchants/discover')
  async discoverMerchants(
    @CurrentUser() user: AuthUser,
    @Query('channelAccountId') channelAccountId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.ads.discoverMerchants(user.id, {
        channelAccountId: channelAccountId ? Number(channelAccountId) : undefined,
        q,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Delete('catalog-merchants/:id')
  async releaseMerchant(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.assertWriter(user);
    return ok(await this.ads.releaseMerchant(user.id, id), '已取消领取');
  }

  @Post('catalog-merchants')
  async createMerchant(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      channelAccountId: number;
      mid: string;
      name: string;
      merchantUrl: string;
      countryCode: string;
      blockReason?: string;
    },
  ) {
    this.assertWriter(user);
    return ok(await this.ads.createMerchant(user.id, body));
  }

  @Post('google-ads/connections')
  async createConnection(@CurrentUser() user: AuthUser, @Body() body: { mccCustomerId: string }) {
    this.assertWriter(user);
    return ok(await this.ads.createConnection(user.id, body.mccCustomerId));
  }

  @Get('google-ads/accounts')
  async listAccountBoard(@CurrentUser() user: AuthUser) {
    return ok(await this.ads.listAccountBoard(user.id));
  }

  @Get('articles')
  async listArticles(@CurrentUser() user: AuthUser) {
    return ok(await this.ads.listArticles(user.id));
  }

  @Get('article-publish/merchants')
  async searchArticleMerchants(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return ok(await this.ads.searchArticleMerchants(user.id, q ?? ''));
  }

  @Get('article-publish/merchant-profile')
  async lookupArticleMerchant(
    @CurrentUser() user: AuthUser,
    @Query('channelAccountId') channelAccountId?: string,
    @Query('mid') mid?: string,
  ) {
    return ok(
      await this.ads.lookupArticleMerchant(user.id, Number(channelAccountId) || 0, mid ?? ''),
    );
  }

  @Post('article-publish/preview')
  async previewComposedArticle(@CurrentUser() user: AuthUser, @Body() body: ArticlePublishBody) {
    this.assertWriter(user);
    return ok(await this.ads.previewComposedArticle(user.id, body));
  }

  @Post('article-publish/publish')
  async publishComposedArticle(@CurrentUser() user: AuthUser, @Body() body: ArticlePublishBody) {
    this.assertWriter(user);
    return ok(await this.ads.publishComposedArticle(user.id, body), '文章已保存');
  }

  @Post('articles/:id/publish')
  async publishArticle(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.assertWriter(user);
    return ok(await this.ads.publishArticle(user.id, id), '已提交到内容站');
  }

  @Delete('articles/:id')
  async deleteArticle(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.assertWriter(user);
    return ok(await this.ads.deleteArticle(user.id, id), '文章已删除');
  }

  @Get('google-ads/customers')
  async listCustomers(@CurrentUser() user: AuthUser, @Query('mccCustomerId') mccCustomerId: string) {
    return ok(await this.ads.listCustomers(user.id, mccCustomerId));
  }

  @Post('google-ads/customers')
  async createCustomer(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      mccCustomerId: string;
      customerId: string;
      googleStatus?: string;
      availability?: string;
      currencyCode?: string;
      timeZone?: string;
      activeCampaignCount?: number;
    },
  ) {
    this.assertWriter(user);
    return ok(await this.ads.createCustomer(user.id, body));
  }

  @Get('ad-jobs')
  async listJobs(@CurrentUser() user: AuthUser) {
    return ok(await this.ads.listJobs(user.id));
  }

  @Post('ad-jobs')
  async claim(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      catalogMerchantId: number;
      mccCustomerId: string;
      targetCountry: string;
      languageCode?: string;
      bidding?: 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';
      dailyBudgetUsd?: string;
      cpcBidCeilingUsd?: string;
    },
  ) {
    this.assertWriter(user);
    return ok(await this.ads.claim(user.id, body), '已开始生成');
  }

  @Get('ad-jobs/:id')
  async getJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return ok(await this.ads.getJob(user.id, id));
  }

  @Patch('ad-jobs/:id/draft')
  async patchDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: DraftPatchBody,
  ) {
    this.assertWriter(user);
    return ok(await this.ads.patchDraft(user.id, id, body));
  }

  @Post('ad-jobs/:id/publish')
  async publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { customerId?: string },
  ) {
    this.assertWriter(user);
    return ok(await this.ads.publish(user.id, id, body.customerId), '已写入待提交队列');
  }

  @Get('ad-campaigns')
  async listCampaigns(@CurrentUser() user: AuthUser) {
    return ok(await this.ads.listCampaigns(user.id));
  }

  @Patch('ad-campaigns/:id/status')
  async updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: 'ENABLED' | 'PAUSED' },
  ) {
    this.assertWriter(user);
    return ok(await this.ads.updateStatus(user.id, id, body.status));
  }

  @Patch('ad-campaigns/:id/budget')
  async updateBudget(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { dailyBudgetUsd: string },
  ) {
    this.assertWriter(user);
    return ok(await this.ads.updateBudget(user.id, id, body.dailyBudgetUsd));
  }

  /**
   * 只读账号不能写入。
   */
  private assertWriter(user: AuthUser) {
    if (user.role === UserRole.VIEWER) {
      throw new ForbiddenException('只读账号无法修改');
    }
  }
}
