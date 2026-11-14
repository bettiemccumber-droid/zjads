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
import { AuthUser, resolveOwnerUserId } from '../common/ownership.util';
import { AdDraft, AdKeyword, AdSitelink } from './ads-automation.util';
import { AdsAutomationService } from './ads-automation.service';
import { AiPersonaService, PersonaScope } from './ai-persona.service';
import {
  MerchantOpsImportMode,
  MerchantOpsListService,
  MerchantOpsListType,
} from './merchant-ops-list.service';

class CreatePersonaBody {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsIn(['ads', 'article', 'both'])
  scope?: PersonaScope;

  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}

class MerchantOpsListRowBody {
  @IsString()
  platformCode!: string;

  @IsString()
  mid!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  merchantUrl?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class ImportMerchantOpsListBody {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MerchantOpsListRowBody)
  rows!: MerchantOpsListRowBody[];

  /** merge 合并；replace_platforms 只覆盖本次平台；replace_all 整表替换 */
  @IsOptional()
  @IsIn(['merge', 'replace_platforms', 'replace_all'])
  mode?: MerchantOpsImportMode;
}

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}

/**
 * 内容站、收款方式、商家、任务和本地系列。
 * 路由都是新的，不替换现有报表和渠道账号接口。
 */
@Controller()
@UseGuards(AuthGuard('jwt'))
export class AdsAutomationController {
  constructor(
    private readonly ads: AdsAutomationService,
    private readonly personas: AiPersonaService,
    private readonly merchantLists: MerchantOpsListService,
  ) {}

  /** 违规/推荐运营名单。员工只读。 */
  @Get('merchant-ops-lists/:listType')
  async listMerchantOps(
    @CurrentUser() user: AuthUser,
    @Param('listType') listType: MerchantOpsListType,
  ) {
    return ok(await this.merchantLists.list(user.organizationId, listType));
  }

  /** 管理员导入违规或推荐名单。默认合并，可多次按平台上传。 */
  @Post('merchant-ops-lists/:listType/import')
  async importMerchantOps(
    @CurrentUser() user: AuthUser,
    @Param('listType') listType: MerchantOpsListType,
    @Body() body: ImportMerchantOpsListBody,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('只有管理员可以上传名单');
    }
    const mode = body.mode ?? 'merge';
    const data = await this.merchantLists.importRows(
      user.organizationId,
      listType,
      body.rows ?? [],
      mode,
    );
    const tip =
      mode === 'merge'
        ? `已合并导入 ${data.imported} 条`
        : mode === 'replace_platforms'
          ? `已覆盖平台 ${data.platforms.join('、')}，共 ${data.imported} 条`
          : `已整表替换为 ${data.imported} 条`;
    return ok(data, tip);
  }

  /** 兼容旧前端：整表替换。 */
  @Post('merchant-ops-lists/:listType/replace')
  async replaceMerchantOps(
    @CurrentUser() user: AuthUser,
    @Param('listType') listType: MerchantOpsListType,
    @Body() body: ImportMerchantOpsListBody,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('只有管理员可以上传名单');
    }
    return ok(
      await this.merchantLists.importRows(
        user.organizationId,
        listType,
        body.rows ?? [],
        body.mode ?? 'replace_all',
      ),
      '名单已更新',
    );
  }

  /** 清空名单，或只清某个平台。 */
  @Delete('merchant-ops-lists/:listType')
  async clearMerchantOps(
    @CurrentUser() user: AuthUser,
    @Param('listType') listType: MerchantOpsListType,
    @Query('platformCode') platformCode?: string,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('只有管理员可以清空名单');
    }
    return ok(
      await this.merchantLists.clear(user.organizationId, listType, platformCode),
      platformCode ? `已清空平台 ${platformCode}` : '名单已清空',
    );
  }

  /** 当前员工可见的 AI 人设库。 */
  @Get('ai-personas')
  async listPersonas(@CurrentUser() user: AuthUser) {
    return ok(await this.personas.listForUser(user.id));
  }

  /** 新建人设；默认创建后激活。提示词可空，空则继承 Adrian。 */
  @Post('ai-personas')
  async createPersona(@CurrentUser() user: AuthUser, @Body() body: CreatePersonaBody) {
    this.assertWriter(user);
    const activate = body.activate !== false;
    return ok(
      await this.personas.create(user.id, {
        name: body.name,
        summary: body.summary,
        tags: body.tags ?? [],
        systemPrompt: body.systemPrompt,
        scope: body.scope,
        activate,
      }),
      activate ? '人设已创建并激活' : '人设已创建',
    );
  }

  /** 激活人设，之后生成广告/文章会带上其提示词。 */
  @Post('ai-personas/:id/activate')
  async activatePersona(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.assertWriter(user);
    return ok(await this.personas.activate(user.id, id), '已激活');
  }

  /** 删除自己建的人设。 */
  @Delete('ai-personas/:id')
  async removePersona(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    this.assertWriter(user);
    return ok(await this.personas.remove(user.id, id), '人设已删除');
  }

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
  async listMerchants(@CurrentUser() user: AuthUser, @Query('userId') userId?: string) {
    const ownerUserId = resolveOwnerUserId(user, userId ? Number(userId) : undefined, 'read');
    return ok(await this.ads.listMerchants(ownerUserId));
  }

  /**
   * 已经投过广告的商家。管理员可以带 userId 查看某位员工。
   * logos=1 时再向联盟补商标，默认只读缓存，让列表先返回。
   */
  @Get('catalog-merchants/advertised')
  async listAdvertisedMerchants(
    @CurrentUser() user: AuthUser,
    @Query('userId') userId?: string,
    @Query('logos') logos?: string,
  ) {
    const ownerUserId = resolveOwnerUserId(user, userId ? Number(userId) : undefined, 'read');
    return ok(await this.ads.listAdvertisedMerchants(ownerUserId, logos === '1'));
  }

  /** 从联盟商家库翻页查找，结果里带商家网址。 */
  @Get('catalog-merchants/discover')
  async discoverMerchants(
    @CurrentUser() user: AuthUser,
    @Query('channelAccountId') channelAccountId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('userId') userId?: string,
  ) {
    const ownerUserId = resolveOwnerUserId(user, userId ? Number(userId) : undefined, 'read');
    return ok(
      await this.ads.discoverMerchants(ownerUserId, {
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

  @Get('google-ads/setup')
  async googleAdsSetup(@CurrentUser() user: AuthUser) {
    return ok(await this.ads.googleAdsSetup(user.id));
  }

  @Post('google-ads/connections')
  async createConnection(
    @CurrentUser() user: AuthUser,
    @Body() body: { mccCustomerId: string; loginCustomerId?: string; refreshToken?: string },
  ) {
    this.assertWriter(user);
    return ok(await this.ads.createConnection(user.id, body));
  }

  @Post('google-ads/sync')
  async syncGoogleAds(@CurrentUser() user: AuthUser) {
    this.assertWriter(user);
    return ok(await this.ads.syncGoogleAds(user.id), '已从 Google Ads 同步子账号');
  }

  /**
   * 子账号列表。配好 Google Ads 后返回 MCC 当前子账号；否则仍读日报。
   */
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

  @Get('article-publish/images')
  async crawlArticleImages(@CurrentUser() user: AuthUser, @Query('merchantUrl') merchantUrl?: string) {
    this.assertWriter(user);
    return ok(await this.ads.crawlArticleImages(merchantUrl ?? ''));
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
