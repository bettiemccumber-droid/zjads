import { Module } from '@nestjs/common';
import { ChannelAccountsModule } from '../channel-accounts/channel-accounts.module';
import { CollectorsModule } from '../collectors/collectors.module';
import { AlertsModule } from '../alerts/alerts.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [ChannelAccountsModule, CollectorsModule, AlertsModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
