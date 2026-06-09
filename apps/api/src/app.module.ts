import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    AdminModule,
  ],
})
export class AppModule {}
