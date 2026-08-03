import { Module } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

@Module({
  controllers: [MerchantsController],
  providers: [MerchantsService, CryptoService],
})
export class MerchantsModule {}
