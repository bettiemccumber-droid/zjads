import { Module } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { MerchantsModule } from '../merchants/merchants.module';
import { AdsAutomationController } from './ads-automation.controller';
import { AdsAutomationService, ArticlePublisher } from './ads-automation.service';
import { AiPersonaService } from './ai-persona.service';

/**
 * 自动化投放框架。Google Ads 请求写入待提交队列，不改现有报表模块。
 */
@Module({
  imports: [MerchantsModule],
  controllers: [AdsAutomationController],
  providers: [AdsAutomationService, ArticlePublisher, CryptoService, AiPersonaService],
  exports: [AiPersonaService],
})
export class AdsAutomationModule {}
