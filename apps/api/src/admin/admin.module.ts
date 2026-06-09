import { Module } from '@nestjs/common';
import { AdSourcesModule } from '../ad-sources/ad-sources.module';
import { ReportsModule } from '../reports/reports.module';
import { SyncModule } from '../sync/sync.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ReportsModule, SyncModule, AdSourcesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
