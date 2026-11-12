import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PlatformsModule } from './platforms/platforms.module';
import { ChannelAccountsModule } from './channel-accounts/channel-accounts.module';
import { SyncModule } from './sync/sync.module';
import { OrdersModule } from './orders/orders.module';
import { ReportsModule } from './reports/reports.module';
import { AlertsModule } from './alerts/alerts.module';
import { PrismaModule } from './prisma/prisma.module';
import { CollectorsModule } from './collectors/collectors.module';
import { AdSourcesModule } from './ad-sources/ad-sources.module';
import { MerchantsModule } from './merchants/merchants.module';
import { AdsAutomationModule } from './ads-automation/ads-automation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CollectorsModule,
    AuthModule,
    UsersModule,
    PlatformsModule,
    ChannelAccountsModule,
    SyncModule,
    OrdersModule,
    ReportsModule,
    AlertsModule,
    AdSourcesModule,
    MerchantsModule,
    AdsAutomationModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  /**
   * 文章配图会以压缩后的图片数据放进请求体，默认 100KB 装不下。
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(json({ limit: '8mb' }), urlencoded({ extended: true, limit: '8mb' })).forRoutes('*');
  }
}
