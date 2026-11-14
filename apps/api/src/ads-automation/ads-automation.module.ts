import { Module } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { MerchantsModule } from '../merchants/merchants.module';
import { AdsAutomationController } from './ads-automation.controller';
import { AdsAutomationService, ArticlePublisher } from './ads-automation.service';
import { AiPersonaService } from './ai-persona.service';
import { GoogleAdsClient } from './google-ads.client';
import { MerchantOpsListService } from './merchant-ops-list.service';

/**
 * 自动化投放。配好 Google Ads API 后，确认发布会直接创建搜索广告。
 */
@Module({
  imports: [MerchantsModule],
  controllers: [AdsAutomationController],
  providers: [AdsAutomationService, ArticlePublisher, CryptoService, AiPersonaService, MerchantOpsListService, GoogleAdsClient],
  exports: [AiPersonaService, MerchantOpsListService],
})
export class AdsAutomationModule {}
