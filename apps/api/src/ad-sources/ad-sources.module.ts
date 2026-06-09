import { Module } from '@nestjs/common';
import { AdSourcesController } from './ad-sources.controller';
import { AdSourcesService } from './ad-sources.service';

@Module({
  controllers: [AdSourcesController],
  providers: [AdSourcesService],
  exports: [AdSourcesService],
})
export class AdSourcesModule {}
