import { Module } from '@nestjs/common';
import { CollectorsService } from './collectors.service';

@Module({
  providers: [CollectorsService],
  exports: [CollectorsService],
})
export class CollectorsModule {}
