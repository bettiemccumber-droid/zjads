import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { AdsAutomationController } from './ads-automation.controller';
import { AdsAutomationService, ArticlePublisher } from './ads-automation.service';

/**
 * 自动化投放框架。Google Ads 请求写入待提交队列，不改现有报表模块。
 */
@Module({
  imports: [MerchantsModule],
  controllers: [AdsAutomationController],
  providers: [AdsAutomationService, ArticlePublisher],
})
export class AdsAutomationModule {}
