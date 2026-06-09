import { Module } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { ChannelAccountsController } from './channel-accounts.controller';
import { ChannelAccountsService } from './channel-accounts.service';

import { AffiliateClicksService } from './affiliate-clicks.service';

@Module({
  controllers: [ChannelAccountsController],
  providers: [ChannelAccountsService, AffiliateClicksService, CryptoService],
  exports: [ChannelAccountsService, AffiliateClicksService, CryptoService],
})
export class ChannelAccountsModule {}
